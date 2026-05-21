import { Inject, Injectable } from '@nestjs/common';
import {
  request as httpRequest,
  type RequestOptions as HttpRequestOptions,
} from 'node:http';
import {
  request as httpsRequest,
  type RequestOptions as HttpsRequestOptions,
} from 'node:https';
import {
  PmmPromqlClient,
  type PmmClientConfig,
} from './pmm-promql.client';

const QUERY_TIMEOUT_MS = 5_000;
// PMM 3.x inventory API — GET /v1/inventory/services returns the same
// per-engine bucketed shape that PMM 2.x's POST /v1/inventory/Services/List
// did. The original v0.4.3 implementation targeted the 2.x path; surfaced
// as 404 → 'unreachable' on Rocky 234 (PMM 3.5.0). PMM 2.x deployments are
// in long-tail by now (PMM 3 GA was Q1 2025) — supporting both would need
// a /v1/server/version probe + branching; keep simple and require 3.x.
const INVENTORY_PATH = '/v1/inventory/services';

export type PmmServiceEngine =
  | 'mysql'
  | 'postgresql'
  | 'mongodb'
  | 'redis'
  | 'mariadb'
  | 'unknown';

export interface PmmService {
  serviceId: string;
  serviceName: string;
  engine: PmmServiceEngine;
  nodeId: string;
  address: string | null;
  port: number | null;
}

export type InventoryResult =
  | { ok: true; services: PmmService[] }
  | { ok: false; reason: InventoryFailureReason };

export type InventoryFailureReason =
  | 'not_configured'
  | 'auth'
  | 'unreachable'
  | 'bad_response';

@Injectable()
export class PmmInventoryClient {
  constructor(
    @Inject(PmmPromqlClient) private readonly promql: PmmPromqlClient,
  ) {}

  async listServices(): Promise<InventoryResult> {
    const config = await this.promql.resolveConfig();
    if (!config.url) {
      return { ok: false, reason: 'not_configured' };
    }
    return executeInventoryList(config);
  }
}

export function executeInventoryList(
  config: PmmClientConfig,
): Promise<InventoryResult> {
  if (!config.url) {
    return Promise.resolve({ ok: false, reason: 'not_configured' });
  }
  let target: URL;
  try {
    target = new URL(INVENTORY_PATH, config.url);
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
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (config.apiToken) {
      headers.Authorization = `Bearer ${config.apiToken}`;
    }
    const opts: HttpsRequestOptions & HttpRequestOptions = {
      method: 'GET',
      hostname: target.hostname,
      port,
      path: target.pathname,
      headers,
      timeout: QUERY_TIMEOUT_MS,
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
        resolve(parseInventoryResponse(raw));
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
 * PMM 2.x inventory response shape (POST /v1/inventory/Services/List with {}):
 * {
 *   mysql:      [{ service_id, service_name, node_id, address, port, ... }],
 *   postgresql: [...],
 *   mongodb:    [...],
 *   proxysql:   [...],
 *   haproxy:    [...],
 *   external:   [...]
 * }
 * Any of the per-type arrays may be missing. We flatten + normalize.
 */
function parseInventoryResponse(raw: string): InventoryResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'bad_response' };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, reason: 'bad_response' };
  }
  const services: PmmService[] = [];
  const buckets = parsed as Record<string, unknown>;
  for (const [bucketKey, rows] of Object.entries(buckets)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const normalized = normalizeRow(bucketKey, row);
      if (normalized) services.push(normalized);
    }
  }
  return { ok: true, services };
}

function normalizeRow(bucketKey: string, raw: unknown): PmmService | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const serviceId = typeof row.service_id === 'string' ? row.service_id : null;
  const serviceName =
    typeof row.service_name === 'string' ? row.service_name : null;
  const nodeId = typeof row.node_id === 'string' ? row.node_id : null;
  if (!serviceId || !serviceName || !nodeId) return null;
  const address = typeof row.address === 'string' ? row.address : null;
  const portRaw = row.port;
  const port =
    typeof portRaw === 'number' && Number.isFinite(portRaw) ? portRaw : null;
  return {
    serviceId,
    serviceName,
    engine: mapEngine(bucketKey, serviceName),
    nodeId,
    address,
    port,
  };
}

function mapEngine(bucketKey: string, serviceName: string): PmmServiceEngine {
  switch (bucketKey) {
    case 'mysql':
      return 'mysql';
    case 'postgresql':
      return 'postgresql';
    case 'mongodb':
      return 'mongodb';
    case 'external':
      return /redis/i.test(serviceName) ? 'redis' : 'unknown';
    default:
      return 'unknown';
  }
}
