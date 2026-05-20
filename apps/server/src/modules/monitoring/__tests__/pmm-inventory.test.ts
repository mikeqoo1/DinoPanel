import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  executeInventoryList,
  type PmmService,
} from '../pmm-inventory.client';
import type { PmmClientConfig } from '../pmm-promql.client';

interface FakePmmHandler {
  status?: number;
  body?: string;
  captureRequest?: (req: {
    method?: string;
    path?: string;
    auth?: string;
    contentType?: string;
    body?: string;
  }) => void;
}

async function startFakePmm(handler: FakePmmHandler = {}): Promise<{
  config: PmmClientConfig;
  close: () => Promise<void>;
}> {
  const server: Server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
    });
    req.on('end', () => {
      handler.captureRequest?.({
        method: req.method,
        path: req.url,
        auth: req.headers.authorization,
        contentType: req.headers['content-type'],
        body,
      });
      const status = handler.status ?? 200;
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(handler.body ?? '{}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as AddressInfo;
  return {
    config: {
      url: `http://127.0.0.1:${addr.port}`,
      apiToken: 'test-token',
      tlsSkipVerify: false,
    },
    close: () =>
      new Promise<void>((r, j) => {
        server.close((err) => (err ? j(err) : r()));
      }),
  };
}

describe('PmmInventoryClient (executeInventoryList)', () => {
  let close: (() => Promise<void>) | null = null;

  beforeEach(() => {
    close = null;
  });

  afterEach(async () => {
    if (close) {
      await close().catch(() => undefined);
      close = null;
    }
  });

  it('flattens multi-engine response into PmmService[]', async () => {
    const { config, close: c } = await startFakePmm({
      body: JSON.stringify({
        mysql: [
          {
            service_id: 'svc-mysql-1',
            service_name: 'shop-mysql',
            node_id: 'node-a',
            address: '10.0.0.5',
            port: 3306,
          },
        ],
        postgresql: [
          {
            service_id: 'svc-pg-1',
            service_name: 'analytics-pg',
            node_id: 'node-b',
            address: '10.0.0.6',
            port: 5432,
          },
        ],
        mongodb: [
          {
            service_id: 'svc-mongo-1',
            service_name: 'logs-mongo',
            node_id: 'node-c',
            address: '10.0.0.7',
            port: 27017,
          },
        ],
      }),
    });
    close = c;
    const res = await executeInventoryList(config);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unreachable');
    expect(res.services).toHaveLength(3);
    const byEngine = Object.fromEntries(
      res.services.map((s) => [s.engine, s]),
    );
    expect(byEngine.mysql).toMatchObject<Partial<PmmService>>({
      serviceName: 'shop-mysql',
      port: 3306,
      address: '10.0.0.5',
    });
    expect(byEngine.postgresql?.serviceName).toBe('analytics-pg');
    expect(byEngine.mongodb?.serviceName).toBe('logs-mongo');
  });

  it('returns empty services array when PMM has nothing registered', async () => {
    const { config, close: c } = await startFakePmm({ body: '{}' });
    close = c;
    const res = await executeInventoryList(config);
    expect(res).toEqual({ ok: true, services: [] });
  });

  it('maps external service with "redis" in name to engine "redis"', async () => {
    const { config, close: c } = await startFakePmm({
      body: JSON.stringify({
        external: [
          {
            service_id: 'svc-ext-1',
            service_name: 'session-redis',
            node_id: 'node-d',
            address: '10.0.0.8',
            port: 6379,
          },
        ],
      }),
    });
    close = c;
    const res = await executeInventoryList(config);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unreachable');
    expect(res.services).toHaveLength(1);
    expect(res.services[0]!.engine).toBe('redis');
  });

  it('maps other external services (e.g. memcached) to engine "unknown"', async () => {
    const { config, close: c } = await startFakePmm({
      body: JSON.stringify({
        external: [
          {
            service_id: 'svc-ext-2',
            service_name: 'memcached-prod',
            node_id: 'node-e',
            address: '10.0.0.9',
            port: 11211,
          },
        ],
      }),
    });
    close = c;
    const res = await executeInventoryList(config);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unreachable');
    expect(res.services[0]!.engine).toBe('unknown');
  });

  it('drops rows missing required fields (service_id / service_name / node_id)', async () => {
    const { config, close: c } = await startFakePmm({
      body: JSON.stringify({
        mysql: [
          { service_id: 'svc-1', service_name: 'ok', node_id: 'n-1' },
          { service_id: 'svc-2', service_name: 'broken' /* no node_id */ },
          'not-an-object',
        ],
      }),
    });
    close = c;
    const res = await executeInventoryList(config);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unreachable');
    expect(res.services).toHaveLength(1);
    expect(res.services[0]!.serviceName).toBe('ok');
  });

  it('HTTP 401 → { ok: false, reason: "auth" }', async () => {
    const { config, close: c } = await startFakePmm({
      status: 401,
      body: '',
    });
    close = c;
    const res = await executeInventoryList(config);
    expect(res).toEqual({ ok: false, reason: 'auth' });
  });

  it('non-existent host → { ok: false, reason: "unreachable" }', async () => {
    const res = await executeInventoryList({
      url: 'http://127.0.0.1:1',
      apiToken: null,
      tlsSkipVerify: false,
    });
    expect(res).toEqual({ ok: false, reason: 'unreachable' });
  });

  it('200 OK with malformed JSON → { ok: false, reason: "bad_response" }', async () => {
    const { config, close: c } = await startFakePmm({ body: 'not json' });
    close = c;
    const res = await executeInventoryList(config);
    expect(res).toEqual({ ok: false, reason: 'bad_response' });
  });

  it('not_configured when url is null', async () => {
    const res = await executeInventoryList({
      url: null,
      apiToken: null,
      tlsSkipVerify: false,
    });
    expect(res).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('sends POST {} with Bearer token and JSON content-type', async () => {
    const captured: Array<{
      method?: string;
      path?: string;
      auth?: string;
      contentType?: string;
      body?: string;
    }> = [];
    const { config, close: c } = await startFakePmm({
      captureRequest: (req) => captured.push(req),
    });
    close = c;
    await executeInventoryList(config);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.method).toBe('POST');
    expect(captured[0]!.path).toBe('/v1/inventory/Services/List');
    expect(captured[0]!.auth).toBe('Bearer test-token');
    expect(captured[0]!.contentType).toBe('application/json');
    expect(captured[0]!.body).toBe('{}');
  });
});
