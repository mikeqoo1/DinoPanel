import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  executePromqlQuery,
  type PmmClientConfig,
} from '../pmm-promql.client';

// PMM PromQL client matrix — spec.md §verification-gates: ≥ 6 cases.
// Drives the HTTP layer directly via `executePromqlQuery` to avoid
// DI plumbing in unit tests; the @Injectable wrapper is a thin
// settings-resolution shell over this function.

interface FakePmmHandler {
  status?: number;
  body?: string;
  body401?: boolean;
  delayMs?: number;
  captureRequest?: (req: { path?: string; auth?: string }) => void;
}

async function startFakePmm(handler: FakePmmHandler = {}): Promise<{
  config: PmmClientConfig;
  close: () => Promise<void>;
}> {
  const server: Server = createServer((req, res) => {
    handler.captureRequest?.({
      path: req.url,
      auth: req.headers.authorization,
    });
    if (handler.delayMs) {
      setTimeout(() => respond(), handler.delayMs);
    } else {
      respond();
    }
    function respond() {
      const status = handler.status ?? 200;
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      const body =
        handler.body ??
        JSON.stringify({
          status: 'success',
          data: {
            resultType: 'vector',
            result: [
              {
                metric: { __name__: 'test' },
                value: [1_700_000_000, '42'],
              },
            ],
          },
        });
      res.end(body);
    }
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

describe('PmmPromqlClient.query (HTTP)', () => {
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

  it('parses a vector result into { ok: true, value }', async () => {
    const { config, close: c } = await startFakePmm();
    close = c;
    const res = await executePromqlQuery(config, 'up');
    expect(res).toEqual({ ok: true, value: 42, timestamp: 1_700_000_000 });
  });

  it('empty result vector → { ok: false, reason: "empty_vector" }', async () => {
    const { config, close: c } = await startFakePmm({
      body: JSON.stringify({
        status: 'success',
        data: { resultType: 'vector', result: [] },
      }),
    });
    close = c;
    const res = await executePromqlQuery(config, 'redis_slave_lag_seconds');
    expect(res).toEqual({ ok: false, reason: 'empty_vector' });
  });

  it('HTTP 401 → { ok: false, reason: "auth" }', async () => {
    const { config, close: c } = await startFakePmm({ status: 401, body: '' });
    close = c;
    const res = await executePromqlQuery(config, 'up');
    expect(res).toEqual({ ok: false, reason: 'auth' });
  });

  it('non-existent host → { ok: false, reason: "unreachable" }', async () => {
    // Use a port that nothing is listening on. 1 is a privileged port
    // that's guaranteed not to be open from a normal user namespace.
    const res = await executePromqlQuery(
      { url: 'http://127.0.0.1:1', apiToken: null, tlsSkipVerify: false },
      'up',
    );
    expect(res).toEqual({ ok: false, reason: 'unreachable' });
  });

  it('200 with malformed JSON → { ok: false, reason: "bad_response" }', async () => {
    const { config, close: c } = await startFakePmm({ body: 'not json' });
    close = c;
    const res = await executePromqlQuery(config, 'up');
    expect(res).toEqual({ ok: false, reason: 'bad_response' });
  });

  it('encodes the query and attaches Bearer token', async () => {
    const captured: Array<{ path?: string; auth?: string }> = [];
    const { config, close: c } = await startFakePmm({
      captureRequest: (req) => captured.push(req),
    });
    close = c;
    const promql = 'rate(mysql_global_status_questions{service_name="x"}[5m])';
    await executePromqlQuery(config, promql);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.path).toContain('/prometheus/api/v1/query');
    // querystring lib uses + for spaces; encodeURIComponent uses %20.
    // URLSearchParams uses + for space — we use URLSearchParams.set so
    // the wire form has %3D / %22 etc. for special chars and either +
    // or %20 for spaces (no spaces in this query). Just assert the
    // engine-distinguishing token survives the round-trip.
    expect(decodeURIComponent(captured[0]!.path!)).toContain(
      'mysql_global_status_questions',
    );
    expect(captured[0]!.auth).toBe('Bearer test-token');
  });

  it('not_configured when url is null', async () => {
    const res = await executePromqlQuery(
      { url: null, apiToken: null, tlsSkipVerify: false },
      'up',
    );
    expect(res).toEqual({ ok: false, reason: 'not_configured' });
  });
});
