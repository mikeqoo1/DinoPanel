import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { request as httpsRequest, type RequestOptions as HttpsRequestOptions } from 'node:https';
import { request as httpRequest } from 'node:http';
import { eq } from 'drizzle-orm';
import { DRIZZLE_DB, type Db } from '../../database/db.module';
import { settings } from '../../database/schema';

const PMM_URL_KEY = 'monitoring.pmm_url';
const PMM_API_TOKEN_KEY = 'monitoring.pmm_api_token';
const PMM_TLS_SKIP_VERIFY_KEY = 'monitoring.pmm_tls_skip_verify';
const PROBE_TIMEOUT_MS = 5_000;
const PROBE_PATH = '/v1/readyz';

export interface PmmConfig {
  url: string | null;
}

export interface PmmCredentialsView {
  // Whether a token is stored in settings (never the token itself).
  // Env-set tokens (MONITORING_PMM_API_TOKEN) are not reflected here —
  // the UI only reports its own knowledge of the settings table.
  tokenSet: boolean;
  // null = use env-resolved default; true / false = explicit override.
  // UI surfaces this as "Use default / Skip verify / Enforce verify".
  tlsSkipVerify: boolean | null;
}

export interface PmmCredentialsUpdate {
  // null = no change to the stored token; '' = clear stored token;
  // any other string = replace stored token. (UI gives "Clear" button
  // for the explicit-clear path so the operator can't accidentally
  // erase by typing nothing into the input.)
  apiToken: string | null;
  // null = clear setting (fall back to env default); true / false =
  // explicit override stored in settings.
  tlsSkipVerify: boolean | null;
}

export interface PmmStatus {
  ok: boolean;
  latencyMs: number | null;
  lastChecked: string;
}

@Injectable()
export class MonitoringService {
  // Observer registry so cache-holding services (DbMetricsService,
  // ExternalPmmService) can flush themselves when URL / token / TLS
  // change. Avoids a MonitoringModule → DatabasesModule import cycle.
  private readonly changeListeners = new Set<() => void>();

  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  onCredentialsChange(listener: () => void): void {
    this.changeListeners.add(listener);
  }

  private notifyChange(): void {
    for (const listener of this.changeListeners) {
      try {
        listener();
      } catch {
        // A misbehaving listener must not block the mutation path.
      }
    }
  }

  async getConfig(): Promise<PmmConfig> {
    const rows = await this.db
      .select()
      .from(settings)
      .where(eq(settings.key, PMM_URL_KEY))
      .limit(1);
    return { url: rows[0]?.value ?? null };
  }

  async setConfig(url: string | null): Promise<PmmConfig> {
    if (url !== null && !/^https?:\/\/[^\s]+$/i.test(url)) {
      throw new BadRequestException({
        code: 'MONITORING_INVALID_URL',
        message: 'PMM URL must start with http:// or https://',
      });
    }

    if (url === null) {
      await this.db.delete(settings).where(eq(settings.key, PMM_URL_KEY));
      this.notifyChange();
      return { url: null };
    }

    const trimmed = url.trim().replace(/\/$/, '');
    await this.db
      .insert(settings)
      .values({ key: PMM_URL_KEY, value: trimmed })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: trimmed, updatedAt: Date.now() },
      });
    this.notifyChange();
    return { url: trimmed };
  }

  async getCredentialsView(): Promise<PmmCredentialsView> {
    const token = await this.readKey(PMM_API_TOKEN_KEY);
    const tls = await this.readKey(PMM_TLS_SKIP_VERIFY_KEY);
    return {
      tokenSet: token !== null && token !== '',
      tlsSkipVerify:
        tls === 'true' ? true : tls === 'false' ? false : null,
    };
  }

  /**
   * Mutates two settings keys + returns the updated view. Caller is
   * responsible for invalidating any PMM-client caches keyed on token
   * or TLS posture (DbMetricsService, ExternalPmmService).
   */
  async setCredentials(
    update: PmmCredentialsUpdate,
  ): Promise<PmmCredentialsView> {
    if (update.apiToken === '') {
      await this.db
        .delete(settings)
        .where(eq(settings.key, PMM_API_TOKEN_KEY));
    } else if (update.apiToken !== null) {
      await this.upsertSetting(PMM_API_TOKEN_KEY, update.apiToken.trim());
    }
    if (update.tlsSkipVerify === null) {
      await this.db
        .delete(settings)
        .where(eq(settings.key, PMM_TLS_SKIP_VERIFY_KEY));
    } else {
      await this.upsertSetting(
        PMM_TLS_SKIP_VERIFY_KEY,
        update.tlsSkipVerify ? 'true' : 'false',
      );
    }
    this.notifyChange();
    return this.getCredentialsView();
  }

  async getPmmStatus(): Promise<PmmStatus> {
    const lastChecked = new Date().toISOString();
    const config = await this.getConfig();
    if (!config.url) {
      return { ok: false, latencyMs: null, lastChecked };
    }
    const probed = await this.probe(config.url);
    return { ok: probed.ok, latencyMs: probed.latencyMs, lastChecked };
  }

  /**
   * Hit `${url}/v1/readyz` with a 5s timeout. HTTPS certs are NOT verified
   * — see decisions.md §2: the URL is set by a panel admin (privileged
   * actor), PMM ships with self-signed certs, and a stricter posture
   * would require either pinned fingerprints or upstream Let's Encrypt
   * issuance, neither of which fits the link-card scope.
   */
  private probe(rawUrl: string): Promise<{ ok: boolean; latencyMs: number | null }> {
    return new Promise((resolve) => {
      let parsed: URL;
      try {
        parsed = new URL(PROBE_PATH, rawUrl);
      } catch {
        resolve({ ok: false, latencyMs: null });
        return;
      }

      const start = performance.now();
      const isHttps = parsed.protocol === 'https:';
      const requestFn = isHttps ? httpsRequest : httpRequest;
      const port = parsed.port ? Number(parsed.port) : isHttps ? 443 : 80;

      const opts: HttpsRequestOptions = {
        method: 'GET',
        hostname: parsed.hostname,
        port,
        path: parsed.pathname + parsed.search,
        timeout: PROBE_TIMEOUT_MS,
        rejectUnauthorized: false,
      };

      const req = requestFn(opts, (res) => {
        // Drain the response so the socket frees promptly
        res.resume();
        const latencyMs = Math.round(performance.now() - start);
        resolve({ ok: res.statusCode === 200, latencyMs });
      });
      req.on('error', () => resolve({ ok: false, latencyMs: null }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, latencyMs: null });
      });
      req.end();
    });
  }

  private async readKey(key: string): Promise<string | null> {
    const rows = await this.db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, key))
      .limit(1);
    return rows[0]?.value ?? null;
  }

  private async upsertSetting(key: string, value: string): Promise<void> {
    await this.db
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value, updatedAt: Date.now() },
      });
  }
}
