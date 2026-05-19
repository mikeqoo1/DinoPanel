import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  request as httpRequest,
  type RequestOptions as HttpRequestOptions,
} from 'node:http';
import {
  request as httpsRequest,
  type RequestOptions as HttpsRequestOptions,
} from 'node:https';
import { eq } from 'drizzle-orm';
import type { AppConfig } from '../../config/configuration';
import { DRIZZLE_DB, type Db } from '../../database/db.module';
import { settings } from '../../database/schema';

const PMM_URL_KEY = 'monitoring.pmm_url';
const PMM_API_TOKEN_KEY = 'monitoring.pmm_api_token';
const PMM_TLS_SKIP_VERIFY_KEY = 'monitoring.pmm_tls_skip_verify';
const QUERY_TIMEOUT_MS = 5_000;

/**
 * Per-query result. Never throws — every error path collapses to
 * `{ ok: false }` so the orchestrator (`MonitoringService.summaryFor`)
 * can `Promise.allSettled` without try/catch noise.
 */
export type PromqlResult =
  | { ok: true; value: number; timestamp: number }
  | { ok: false; reason: PromqlFailureReason };

export type PromqlFailureReason =
  | 'not_configured' // monitoring.pmm_url not set
  | 'auth' // 401 / 403
  | 'unreachable' // network / DNS / TLS / timeout
  | 'empty_vector' // 200 OK but no series matched
  | 'bad_response'; // 200 OK but not the Prometheus vector shape

/**
 * Reads `monitoring.pmm_url` from settings + `pmm_api_token` /
 * `pmm_tls_skip_verify` (settings first, then env override via
 * MONITORING_PMM_API_TOKEN / MONITORING_PMM_TLS_SKIP_VERIFY).
 *
 * Hits `<url>/prometheus/api/v1/query?query=<promql>` and parses the
 * Prometheus instant-vector response. PMM 2.x exposes its embedded
 * Prometheus at this exact path (spec.md Q5 implications).
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
    if (!promql) {
      return { ok: false, reason: 'bad_response' };
    }
    const config = await this.resolveConfig();
    if (!config.url) {
      return { ok: false, reason: 'not_configured' };
    }
    return executePromqlQuery(config, promql);
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

/**
 * Exported so unit tests can drive the HTTP layer with an explicit
 * config (no DI plumbing). The client method is a thin wrapper that
 * resolves config then delegates here.
 */
export function executePromqlQuery(
  config: PmmClientConfig,
  promql: string,
): Promise<PromqlResult> {
  if (!config.url) {
    return Promise.resolve({ ok: false, reason: 'not_configured' });
  }
  let target: URL;
  try {
    target = new URL('/prometheus/api/v1/query', config.url);
    target.searchParams.set('query', promql);
  } catch {
    return Promise.resolve({ ok: false, reason: 'bad_response' });
  }
  return new Promise((resolve) => {
    const isHttps = target.protocol === 'https:';
    const requestFn = isHttps ? httpsRequest : httpRequest;
    const port = target.port
      ? Number(target.port)
      : isHttps
        ? 443
        : 80;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (config.apiToken) {
      headers.Authorization = `Bearer ${config.apiToken}`;
    }
    const opts: HttpsRequestOptions & HttpRequestOptions = {
      method: 'GET',
      hostname: target.hostname,
      port,
      path: target.pathname + target.search,
      headers,
      timeout: QUERY_TIMEOUT_MS,
      // Only applies to https.request; harmless on http.request.
      rejectUnauthorized: !config.tlsSkipVerify,
    };
    const req = requestFn(opts, (res) => {
      const statusCode = res.statusCode ?? 0;
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        raw += chunk;
      });
      res.on('end', () => {
        if (statusCode === 401 || statusCode === 403) {
          resolve({ ok: false, reason: 'auth' });
          return;
        }
        if (statusCode < 200 || statusCode >= 300) {
          resolve({ ok: false, reason: 'unreachable' });
          return;
        }
        resolve(parseVectorResponse(raw));
      });
      res.on('error', () => resolve({ ok: false, reason: 'unreachable' }));
    });
    req.on('error', () => resolve({ ok: false, reason: 'unreachable' }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, reason: 'unreachable' });
    });
    req.end();
  });
}

/**
 * Prometheus instant-vector shape:
 * `{ status: 'success', data: { resultType: 'vector', result: [{ metric, value: [ts, "<n>"] }] } }`
 * — empty result array means the series doesn't exist (e.g. redis
 * replication lag on a standalone instance → no slave → no metric).
 */
function parseVectorResponse(raw: string): PromqlResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'bad_response' };
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as { status?: unknown }).status !== 'success'
  ) {
    return { ok: false, reason: 'bad_response' };
  }
  const data = (parsed as { data?: unknown }).data;
  if (
    typeof data !== 'object' ||
    data === null ||
    (data as { resultType?: unknown }).resultType !== 'vector'
  ) {
    return { ok: false, reason: 'bad_response' };
  }
  const result = (data as { result?: unknown }).result;
  if (!Array.isArray(result) || result.length === 0) {
    return { ok: false, reason: 'empty_vector' };
  }
  const first = result[0] as { value?: [number, string] };
  const value = first.value;
  if (!Array.isArray(value) || value.length < 2) {
    return { ok: false, reason: 'bad_response' };
  }
  const [timestamp, sample] = value;
  const numeric = Number(sample);
  if (typeof timestamp !== 'number' || Number.isNaN(numeric)) {
    return { ok: false, reason: 'bad_response' };
  }
  return { ok: true, value: numeric, timestamp };
}
