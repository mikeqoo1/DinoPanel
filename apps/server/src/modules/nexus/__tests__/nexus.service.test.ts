import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NexusService } from '../nexus.service';

// ---------------------------------------------------------------------------
// Minimal drizzle mock: settings KV (real storage) + nexus_samples (recorded calls)
// ---------------------------------------------------------------------------

function makeDb(initialJson?: string) {
  const state = {
    kv: (initialJson ?? null) as string | null,
    inserted: [] as Record<string, unknown>[],
    deletes: 0,
    samples: [] as Record<string, unknown>[],
  };
  const db = {
    _state: state,
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(state.kv !== null ? [{ value: state.kv }] : []),
          orderBy: () => Promise.resolve(state.samples),
        }),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown> | Record<string, unknown>[]) => {
        const rows = Array.isArray(v) ? v : [v];
        for (const row of rows) {
          if (typeof row.key === 'string') state.kv = row.value as string;
          else state.inserted.push(row);
        }
        return {
          onConflictDoUpdate: () => Promise.resolve(undefined),
          then: (res: (v: undefined) => void) => Promise.resolve(undefined).then(res),
        };
      },
    }),
    delete: () => ({ where: () => { state.deletes++; return Promise.resolve(undefined); } }),
  };
  return db;
}

const logger = { warn: vi.fn(), log: vi.fn(), error: vi.fn(), debug: vi.fn() };
const config = { get: () => ({ env: { JWT_SECRET: 'nexus-test-secret-'.repeat(3) }, isDev: true }) };

function makeService(initialJson?: string) {
  const db = makeDb(initialJson);
  return { svc: new NexusService(db as never, logger as never, config as never), db };
}

const INPUT = { name: 'dev1', url: 'http://192.168.198.121:18081', username: '110084', password: 'Aa123456' };

const USAGE_JSON = JSON.stringify({
  usage: [
    {
      component_total_count: 16458,
      unique_users_last_30d: 3,
      requests_per_last_24h: 195563,
      request_rates: { peak_requests_per_minute_1d: 7440, peak_requests_per_day_30d: 353057 },
    },
  ],
});

/** fetch stub routing by URL path: prometheus vs usage-metrics. */
function fetchRouter(opts: { prom?: string; usage?: string | number } = {}) {
  return vi.fn((url: string) => {
    if (url.includes('/metrics/prometheus')) {
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(opts.prom ?? PROM) });
    }
    if (url.includes('/usage-metrics')) {
      if (typeof opts.usage === 'number') {
        return Promise.resolve({ ok: false, status: opts.usage, text: () => Promise.resolve('') });
      }
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(opts.usage ?? USAGE_JSON) });
    }
    return Promise.reject(new Error(`unexpected url ${url}`));
  });
}

const PROM = `org_eclipse_jetty_ee10_webapp_WebAppContext_requests_count 15802.0
org_eclipse_jetty_ee10_webapp_WebAppContext_2xx_responses_total 15607.0
org_eclipse_jetty_ee10_webapp_WebAppContext_3xx_responses_total 187.0
org_eclipse_jetty_ee10_webapp_WebAppContext_4xx_responses_total 8.0
org_eclipse_jetty_ee10_webapp_WebAppContext_5xx_responses_total 0.0
bytes_downloaded_by_format_npm 3.26405912E9
`;

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('NexusService instance storage', () => {
  it('add() encrypts the password; list() exposes hasPassword but never the password', async () => {
    const { svc, db } = makeService();
    const list = await svc.add(INPUT);
    expect(list[0]).toMatchObject({ name: 'dev1', username: '110084', hasPassword: true });
    expect(JSON.stringify(list)).not.toContain('Aa123456');
    expect(db._state.kv).toContain('passwordEnc');
    expect(db._state.kv).not.toContain('Aa123456');
    expect(JSON.stringify(await svc.list())).not.toContain('passwordEnc');
  });

  it('add() rejects a duplicate url', async () => {
    const { svc } = makeService();
    await svc.add(INPUT);
    await expect(svc.add(INPUT)).rejects.toMatchObject({ response: { code: 'NEXUS_DUPLICATE' } });
  });

  it('remove() drops the instance and its samples', async () => {
    const { svc, db } = makeService();
    const list = await svc.add(INPUT);
    await svc.remove(list[0]!.id);
    expect(await svc.list()).toEqual([]);
    expect(db._state.deletes).toBeGreaterThan(0);
  });

  it('a corrupted KV blob yields an empty list instead of throwing', async () => {
    const { svc } = makeService('not json at all');
    expect(await svc.list()).toEqual([]);
  });
});

describe('NexusService scraping', () => {
  it('sends HTTP Basic auth to the prometheus endpoint and returns parsed counters', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve(PROM) });
    vi.stubGlobal('fetch', fetchMock);
    const { svc } = makeService();
    const list = await svc.add(INPUT);
    const m = await svc.scrape(list[0]!.id);
    expect(m.requests).toBe(15802);
    expect(m.bytesDown).toBe(3264059120);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://192.168.198.121:18081/service/rest/metrics/prometheus');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('110084:Aa123456').toString('base64')}`,
    );
  });

  it('maps 401/403 to NEXUS_AUTH_FAILED', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, text: () => Promise.resolve('') }));
    const { svc } = makeService();
    const list = await svc.add(INPUT);
    await expect(svc.scrape(list[0]!.id)).rejects.toMatchObject({ response: { code: 'NEXUS_AUTH_FAILED' } });
  });

  it('maps a network failure to NEXUS_UNREACHABLE', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')));
    const { svc } = makeService();
    const list = await svc.add(INPUT);
    await expect(svc.scrape(list[0]!.id)).rejects.toMatchObject({ response: { code: 'NEXUS_UNREACHABLE' } });
  });

  it('poll() stores one sample per instance and never rejects when a node is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    const { svc, db } = makeService();
    await svc.add(INPUT);
    await expect(svc.poll()).resolves.toBeUndefined();
    expect(db._state.inserted).toHaveLength(0);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve(PROM) }));
    await svc.poll();
    expect(db._state.inserted).toHaveLength(1);
    expect(db._state.inserted[0]).toMatchObject({ requests: 15802, resp4xx: 8, bytesDown: 3264059120 });
    expect(typeof db._state.inserted[0]!.byFormat).toBe('string');
  });
});

describe('NexusService community usage quota', () => {
  it('poll() stores the usage figures alongside the counters', async () => {
    vi.stubGlobal('fetch', fetchRouter());
    const { svc, db } = makeService();
    await svc.add(INPUT);
    await svc.poll();
    expect(db._state.inserted[0]).toMatchObject({
      requests: 15802,
      requests24h: 195563,
      componentCount: 16458,
      uniqueUsers30d: 3,
      peakRequestsPerDay30d: 353057,
    });
  });

  it('a usage endpoint the account cannot read leaves usage null but still stores the sample', async () => {
    vi.stubGlobal('fetch', fetchRouter({ usage: 403 }));
    const { svc, db } = makeService();
    await svc.add(INPUT);
    await svc.poll();
    expect(db._state.inserted).toHaveLength(1);
    expect(db._state.inserted[0]).toMatchObject({ requests: 15802, requests24h: null, componentCount: null });
  });

  it('a malformed usage body is treated as no usage, not a crash', async () => {
    vi.stubGlobal('fetch', fetchRouter({ usage: 'not json' }));
    const { svc, db } = makeService();
    await svc.add(INPUT);
    await svc.poll();
    expect(db._state.inserted[0]).toMatchObject({ requests24h: null });
  });

  it('add() applies the community-edition default limits', async () => {
    const { svc } = makeService();
    const list = await svc.add(INPUT);
    expect(list[0]).toMatchObject({ requestsPerDayLimit: 200_000, componentsLimit: 100_000 });
  });

  it('add() honours explicit limits', async () => {
    const { svc } = makeService();
    const list = await svc.add({ ...INPUT, requestsPerDayLimit: 500_000, componentsLimit: 1 });
    expect(list[0]).toMatchObject({ requestsPerDayLimit: 500_000, componentsLimit: 1 });
  });

  it('updateLimits() changes only the limits and keeps the stored password', async () => {
    const { svc, db } = makeService();
    const list = await svc.add(INPUT);
    const after = await svc.updateLimits(list[0]!.id, { requestsPerDayLimit: 150_000, componentsLimit: 90_000 });
    expect(after).toMatchObject({ requestsPerDayLimit: 150_000, componentsLimit: 90_000, hasPassword: true });
    expect(db._state.kv).toContain('passwordEnc');
    expect(db._state.kv).not.toContain('Aa123456');
  });

  it('updateLimits() on an unknown id is a 404', async () => {
    const { svc } = makeService();
    await expect(svc.updateLimits('nope', { requestsPerDayLimit: 1, componentsLimit: 1 })).rejects.toMatchObject({
      response: { code: 'NEXUS_NOT_FOUND' },
    });
  });
});
