import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { request as httpsRequest, type RequestOptions as HttpsRequestOptions } from 'node:https';
import { request as httpRequest } from 'node:http';
import { eq } from 'drizzle-orm';
import { DRIZZLE_DB, type Db } from '../../database/db.module';
import { settings } from '../../database/schema';

const PMM_URL_KEY = 'monitoring.pmm_url';
const PROBE_TIMEOUT_MS = 5_000;
const PROBE_PATH = '/v1/readyz';

export interface PmmConfig {
  url: string | null;
}

export interface PmmStatus {
  ok: boolean;
  latencyMs: number | null;
  lastChecked: string;
}

@Injectable()
export class MonitoringService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

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
    return { url: trimmed };
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
}
