import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, eq, gte, lt } from 'drizzle-orm';
import { Logger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  nexusInstanceSchema,
  nexusRepositorySchema,
  CE_COMPONENTS_LIMIT,
  CE_REQUESTS_PER_DAY_LIMIT,
  type CreateNexusInstanceInput,
  type NexusInstance,
  type NexusMetrics,
  type NexusRange,
  type NexusRepository,
  type NexusSeries,
  type NexusCommunityState,
  type NexusUsage,
  type UpdateNexusLimits,
} from '@dinopanel/shared';
import type { AppConfig } from '../../config/configuration';
import { decryptSecret, deriveSecretsKey, encryptSecret } from '../../common/secrets/secrets';
import { DRIZZLE_DB, type Db } from '../../database/db.module';
import { nexusSamples, settings } from '../../database/schema';
import {
  bucketMsForRange,
  enforcementFromSamples,
  extractNexusMetrics,
  parseCommunityState,
  parsePrometheusText,
  parseUsageMetrics,
  toSeries,
  type NexusSample,
} from './metrics';

const NEXUS_KEY = 'nexus.list';
const POLL_INTERVAL_MS = 60_000;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
/** Cap on a scrape body — Nexus 3.96 emits ~400 kB; 8 MB is a hostile-endpoint guard. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

const METRICS_PATH = '/service/rest/metrics/prometheus';
const REPOSITORIES_PATH = '/service/rest/v1/repositories';
/** Internal UI endpoint behind Nexus's own usage centre — the community quota counter. */
const USAGE_PATH = '/service/rest/internal/ui/usage-metrics';
/** The state blob Nexus's own UI runs on — the only source for the enforced limits. */
const STATE_PATH = '/service/extdirect/poll/rapture_State_get';

/**
 * What actually sits in the KV blob: the public instance + the encrypted password.
 * The limits are optional here even though they are required on the wire — rows written
 * before v0.6.10 have neither, and readList() drops whatever fails to parse. Making them
 * required here would silently hide every pre-existing instance.
 */
const storedInstanceSchema = nexusInstanceSchema
  .omit({ hasPassword: true, requestsPerDayLimit: true, componentsLimit: true })
  .extend({
    passwordEnc: z.string().optional(),
    requestsPerDayLimit: z.number().int().positive().optional(),
    componentsLimit: z.number().int().positive().optional(),
  });
type StoredInstance = z.infer<typeof storedInstanceSchema>;

function toPublic(i: StoredInstance): NexusInstance {
  const { passwordEnc, ...rest } = i;
  return {
    ...rest,
    requestsPerDayLimit: rest.requestsPerDayLimit ?? CE_REQUESTS_PER_DAY_LIMIT,
    componentsLimit: rest.componentsLimit ?? CE_COMPONENTS_LIMIT,
    hasPassword: passwordEnc !== undefined,
  };
}

@Injectable()
export class NexusService implements OnModuleInit, OnApplicationShutdown {
  private readonly secretsKey: Buffer;
  private timer: NodeJS.Timeout | null = null;
  /** Per-instance state from the last poll. Not persisted: it is a current-state answer,
   *  refilled within seconds of boot because onModuleInit polls immediately. */
  private readonly communityState = new Map<string, NexusCommunityState>();

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Db,
    private readonly logger: Logger,
    config: ConfigService<{ app: AppConfig }>,
  ) {
    const app = config.get<AppConfig>('app', { infer: true });
    this.secretsKey = deriveSecretsKey(app!.env.JWT_SECRET);
  }

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.poll();
    }, POLL_INTERVAL_MS);
    void this.poll();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // -------------------------------------------------------------------------
  // Instance storage (settings KV — mirrors the nodes module)
  // -------------------------------------------------------------------------

  private async readList(): Promise<StoredInstance[]> {
    const rows = await this.db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, NEXUS_KEY))
      .limit(1);
    if (!rows[0]?.value) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(rows[0].value);
    } catch {
      this.logger.warn({ key: NEXUS_KEY }, 'nexus.list_parse_error — returning empty');
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      const r = storedInstanceSchema.safeParse(entry);
      if (!r.success) {
        this.logger.warn({ error: r.error.message }, 'nexus.list_invalid_entry — dropped');
        return [];
      }
      return [r.data];
    });
  }

  private async writeList(instances: StoredInstance[]): Promise<void> {
    const value = JSON.stringify(instances);
    await this.db
      .insert(settings)
      .values({ key: NEXUS_KEY, value })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: Date.now() } });
  }

  async list(): Promise<NexusInstance[]> {
    return (await this.readList()).map(toPublic);
  }

  async add(input: CreateNexusInstanceInput): Promise<NexusInstance[]> {
    const instances = await this.readList();
    if (instances.some((i) => i.url === input.url)) {
      throw new HttpException(
        { code: 'NEXUS_DUPLICATE', message: 'An instance with this URL already exists' },
        HttpStatus.CONFLICT,
      );
    }
    const { password, ...rest } = input;
    instances.push({
      id: randomUUID(),
      ...rest,
      requestsPerDayLimit: rest.requestsPerDayLimit ?? CE_REQUESTS_PER_DAY_LIMIT,
      componentsLimit: rest.componentsLimit ?? CE_COMPONENTS_LIMIT,
      passwordEnc: encryptSecret(password, this.secretsKey),
    });
    await this.writeList(instances);
    return instances.map(toPublic);
  }

  /** Quota limits are panel-side configuration (Nexus exposes no limit anywhere),
   *  so they are editable without re-entering the credentials. */
  async updateLimits(id: string, limits: UpdateNexusLimits): Promise<NexusInstance> {
    const instances = await this.readList();
    const instance = this.findInstance(instances, id);
    instance.requestsPerDayLimit = limits.requestsPerDayLimit;
    instance.componentsLimit = limits.componentsLimit;
    await this.writeList(instances);
    return toPublic(instance);
  }

  async remove(id: string): Promise<void> {
    const instances = await this.readList();
    await this.writeList(instances.filter((i) => i.id !== id));
    this.communityState.delete(id);
    await this.db.delete(nexusSamples).where(eq(nexusSamples.instanceId, id));
  }

  private findInstance(instances: StoredInstance[], id: string): StoredInstance {
    const found = instances.find((i) => i.id === id);
    if (!found) {
      throw new HttpException(
        { code: 'NEXUS_NOT_FOUND', message: 'Instance not found' },
        HttpStatus.NOT_FOUND,
      );
    }
    return found;
  }

  // -------------------------------------------------------------------------
  // Scraping
  // -------------------------------------------------------------------------

  private authHeader(instance: StoredInstance): Record<string, string> {
    if (instance.passwordEnc === undefined) return {};
    let password: string;
    try {
      password = decryptSecret(instance.passwordEnc, this.secretsKey);
    } catch {
      throw new HttpException(
        {
          code: 'NEXUS_PASSWORD_UNREADABLE',
          message: 'Stored password cannot be decrypted (JWT_SECRET changed?). Remove and re-add the instance.',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    const basic = Buffer.from(`${instance.username}:${password}`).toString('base64');
    return { Authorization: `Basic ${basic}` };
  }

  /** GET on the instance, mapping transport/auth failures to stable error codes. */
  private async get(instance: StoredInstance, path: string, authenticated: boolean): Promise<string> {
    let res: { ok: boolean; status: number; text: () => Promise<string> };
    try {
      res = await fetch(`${instance.url}${path}`, {
        headers: authenticated ? this.authHeader(instance) : {},
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: 'follow',
      });
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new HttpException(
        { code: 'NEXUS_UNREACHABLE', message: 'Nexus is not reachable' },
        HttpStatus.BAD_GATEWAY,
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new HttpException(
        {
          code: 'NEXUS_AUTH_FAILED',
          message: 'Nexus rejected the credentials (the account needs the nexus:metrics:read privilege)',
        },
        HttpStatus.BAD_GATEWAY,
      );
    }
    if (!res.ok) {
      throw new HttpException(
        { code: 'NEXUS_COMMAND_FAILED', message: `Nexus returned HTTP ${res.status}` },
        HttpStatus.BAD_GATEWAY,
      );
    }
    const body = await res.text();
    if (body.length > MAX_BODY_BYTES) {
      throw new HttpException(
        { code: 'NEXUS_COMMAND_FAILED', message: 'Nexus response too large' },
        HttpStatus.BAD_GATEWAY,
      );
    }
    return body;
  }

  /** Scrape one instance's counters. Used by the poller and by the test endpoint. */
  async scrape(id: string): Promise<NexusMetrics> {
    const instance = this.findInstance(await this.readList(), id);
    return extractNexusMetrics(parsePrometheusText(await this.get(instance, METRICS_PATH, true)));
  }

  /** Community-edition quota counters. Returns null whenever the instance will not
   *  give them up (no access to the internal endpoint, unreachable, malformed body) —
   *  never throws, so a usage failure cannot cost us the traffic sample. */
  private async fetchUsage(instance: StoredInstance): Promise<NexusUsage | null> {
    try {
      return parseUsageMetrics(JSON.parse(await this.get(instance, USAGE_PATH, true)));
    } catch {
      return null;
    }
  }

  /** Nexus's own limits and throttling verdict from the last poll, or null. */
  communityStateFor(id: string): NexusCommunityState | null {
    return this.communityState.get(id) ?? null;
  }

  /** Never throws: an instance that does not serve the internal state endpoint simply
   *  has no verdict, and the traffic sample must not be lost over it. */
  private async refreshCommunityState(instance: StoredInstance): Promise<void> {
    let state: NexusCommunityState | null = null;
    try {
      state = parseCommunityState(JSON.parse(await this.get(instance, STATE_PATH, true)));
    } catch {
      state = null;
    }
    if (state) this.communityState.set(instance.id, state);
    else this.communityState.delete(instance.id);
  }

  /** Repository list — anonymous endpoint, so it works even without metrics rights. */
  async getRepositories(id: string): Promise<NexusRepository[]> {
    const instance = this.findInstance(await this.readList(), id);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await this.get(instance, REPOSITORIES_PATH, false));
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new HttpException(
        { code: 'NEXUS_COMMAND_FAILED', message: 'Nexus returned a malformed repository list' },
        HttpStatus.BAD_GATEWAY,
      );
    }
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      const r = entry as Record<string, unknown>;
      const parsedRepo = nexusRepositorySchema.safeParse({
        name: r['name'],
        format: r['format'],
        type: r['type'],
        online: r['online'] ?? false,
        size: typeof r['size'] === 'number' ? r['size'] : null,
      });
      return parsedRepo.success ? [parsedRepo.data] : [];
    });
  }

  // -------------------------------------------------------------------------
  // Poller + series
  // -------------------------------------------------------------------------

  /** Scrape every instance and store one sample each. Never rejects: a down
   *  instance is an expected state, logged once per poll and skipped. */
  async poll(): Promise<void> {
    const instances = await this.readList().catch(() => []);
    for (const instance of instances) {
      try {
        const m = extractNexusMetrics(
          parsePrometheusText(await this.get(instance, METRICS_PATH, true)),
        );
        const usage = await this.fetchUsage(instance);
        await this.refreshCommunityState(instance);
        await this.db.insert(nexusSamples).values({
          instanceId: instance.id,
          ts: Date.now(),
          requests: m.requests,
          resp2xx: m.resp2xx,
          resp3xx: m.resp3xx,
          resp4xx: m.resp4xx,
          resp5xx: m.resp5xx,
          bytesDown: m.bytesDown,
          bytesUp: m.bytesUp,
          byFormat: JSON.stringify(m.byFormat),
          requests24h: usage?.requests24h ?? null,
          componentCount: usage?.componentCount ?? null,
          uniqueUsers30d: usage?.uniqueUsers30d ?? null,
          peakRequestsPerDay30d: usage?.peakRequestsPerDay30d ?? null,
          peakRequestsPerMinute1d: usage?.peakRequestsPerMinute1d ?? null,
          blockedRequests: m.blockedRequests,
          throttledRequests: m.throttledRequests,
          graceThrottledRequests: m.graceThrottledRequests,
        });
      } catch (err) {
        const code = err instanceof HttpException ? (err.getResponse() as { code?: string }).code : undefined;
        this.logger.warn({ instance: instance.id, code }, 'nexus.scrape_failed');
      }
    }
    await this.db
      .delete(nexusSamples)
      .where(lt(nexusSamples.ts, Date.now() - RETENTION_MS))
      .catch((err: unknown) => this.logger.warn({ err }, 'nexus.prune_failed'));
  }

  async getSeries(id: string, range: NexusRange): Promise<NexusSeries> {
    const instance = this.findInstance(await this.readList(), id);
    const windowMs = { '1h': 3_600_000, '24h': 86_400_000, '7d': 604_800_000 }[range];
    const rows = await this.db
      .select()
      .from(nexusSamples)
      .where(and(eq(nexusSamples.instanceId, instance.id), gte(nexusSamples.ts, Date.now() - windowMs)))
      .orderBy(asc(nexusSamples.ts));
    const samples: NexusSample[] = rows.map((r) => ({
      ts: r.ts,
      requests: r.requests,
      resp2xx: r.resp2xx,
      resp3xx: r.resp3xx,
      resp4xx: r.resp4xx,
      resp5xx: r.resp5xx,
      bytesDown: r.bytesDown,
      bytesUp: r.bytesUp,
      requests24h: r.requests24h,
      blockedRequests: r.blockedRequests,
      throttledRequests: r.throttledRequests,
      graceThrottledRequests: r.graceThrottledRequests,
    }));
    const last = rows[rows.length - 1];
    let latest: NexusMetrics | null = null;
    if (last) {
      let byFormat: NexusMetrics['byFormat'] = {};
      try {
        byFormat = JSON.parse(last.byFormat) as NexusMetrics['byFormat'];
      } catch {
        this.logger.warn({ instance: instance.id }, 'nexus.by_format_parse_error');
      }
      latest = {
        blockedRequests: last.blockedRequests ?? 0,
        throttledRequests: last.throttledRequests ?? 0,
        graceThrottledRequests: last.graceThrottledRequests ?? 0,
        requests: last.requests,
        resp2xx: last.resp2xx,
        resp3xx: last.resp3xx,
        resp4xx: last.resp4xx,
        resp5xx: last.resp5xx,
        bytesDown: last.bytesDown,
        bytesUp: last.bytesUp,
        byFormat,
      };
    }
    return {
      range,
      points: toSeries(samples, bucketMsForRange(range)),
      latest,
      usage:
        last && last.requests24h !== null
          ? {
              requests24h: last.requests24h,
              componentCount: last.componentCount ?? 0,
              uniqueUsers30d: last.uniqueUsers30d ?? 0,
              peakRequestsPerDay30d: last.peakRequestsPerDay30d ?? 0,
              peakRequestsPerMinute1d: last.peakRequestsPerMinute1d ?? 0,
            }
          : null,
      enforcement: enforcementFromSamples(samples),
      community: this.communityStateFor(instance.id),
      latestTs: last ? last.ts : null,
    };
  }
}
