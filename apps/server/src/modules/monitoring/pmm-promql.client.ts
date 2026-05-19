import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import type { AppConfig } from '../../config/configuration';
import { DRIZZLE_DB, type Db } from '../../database/db.module';
import { settings } from '../../database/schema';

const PMM_URL_KEY = 'monitoring.pmm_url';
const PMM_API_TOKEN_KEY = 'monitoring.pmm_api_token';
const PMM_TLS_SKIP_VERIFY_KEY = 'monitoring.pmm_tls_skip_verify';

/**
 * Per-query result. Never throws — every error path collapses to
 * `{ ok: false }` so the orchestrator (`MonitoringService.summaryFor`,
 * Phase 3) can `Promise.allSettled` without try/catch noise.
 */
export type PromqlResult =
  | { ok: true; value: number; timestamp: number }
  | { ok: false; reason: PromqlFailureReason };

export type PromqlFailureReason =
  | 'not_configured' // monitoring.pmm_url not set
  | 'not_implemented' // Phase 1 stub
  | 'auth' // 401 / 403
  | 'unreachable' // network / DNS / TLS
  | 'empty_vector' // 200 OK but no series matched
  | 'bad_response'; // 200 OK but not the Prometheus vector shape

/**
 * Reads `monitoring.pmm_url` from settings + `pmm_api_token` /
 * `pmm_tls_skip_verify` (settings, falling back to
 * `MONITORING_PMM_API_TOKEN` / `MONITORING_PMM_TLS_SKIP_VERIFY` env).
 *
 * Phase 1: `query()` returns `{ ok: false, reason: 'not_implemented' }`
 * for any non-empty query. The settings-resolution path IS implemented
 * so the orchestrator can already detect "PMM not configured" and the
 * Phase 3 implementation only fills the HTTP layer.
 */
@Injectable()
export class PmmPromqlClient {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Db,
    @Inject(ConfigService)
    private readonly config: ConfigService<{ app: AppConfig }>,
  ) {}

  async resolveConfig(): Promise<PmmClientConfig> {
    const url = await this.readSetting(PMM_URL_KEY);
    const tokenFromSettings = await this.readSetting(PMM_API_TOKEN_KEY);
    const tlsFromSettings = await this.readSetting(PMM_TLS_SKIP_VERIFY_KEY);
    const app = this.config.get<AppConfig>('app', { infer: true });
    if (!app) throw new Error('App config missing');
    return {
      url: url?.trim().replace(/\/$/, '') ?? null,
      apiToken:
        tokenFromSettings?.trim() ||
        app.env.MONITORING_PMM_API_TOKEN.trim() ||
        null,
      tlsSkipVerify:
        tlsFromSettings === 'true' || app.env.MONITORING_PMM_TLS_SKIP_VERIFY,
    };
  }

  async query(promql: string): Promise<PromqlResult> {
    const config = await this.resolveConfig();
    if (!config.url) {
      return { ok: false, reason: 'not_configured' };
    }
    if (!promql) {
      return { ok: false, reason: 'bad_response' };
    }
    // Phase 3 fills this in: fetch(`${url}/prometheus/api/v1/query`)
    // with bearer token + optional TLS skip, parse vector result,
    // return { ok: true, value, timestamp }.
    return { ok: false, reason: 'not_implemented' };
  }

  private async readSetting(key: string): Promise<string | null> {
    const rows = await this.db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, key))
      .limit(1);
    return rows[0]?.value ?? null;
  }
}

export interface PmmClientConfig {
  url: string | null;
  apiToken: string | null;
  tlsSkipVerify: boolean;
}
