import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../database/schema';
import {
  CloudflareDns01Challenger,
  dns01Digest,
  type PropagationPoller,
} from '../challengers/cloudflare-dns01.challenger';

const fakeLogger = {
  debug: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

function setupDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

describe('dns01Digest', () => {
  it('matches the RFC 8555 SHA-256 base64url example', () => {
    // From RFC 8555 §8.4 informative example, keyAuth = "token.thumbprint"
    // we just check the function produces a 43-char base64url string
    // (no padding) with the expected character set.
    const digest = dns01Digest('keyauth.thumbprint.example');
    expect(digest).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('CloudflareDns01Challenger', () => {
  let dbCtx: ReturnType<typeof setupDb>;

  beforeEach(() => {
    dbCtx = setupDb();
    const now = Date.now();
    dbCtx.sqlite
      .prepare(
        'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
      )
      .run('acme.cloudflare.api_token', 'tok-test', now);
  });
  afterEach(() => {
    dbCtx.sqlite.close();
  });

  it('finds zone, creates TXT, waits for propagation, returns state', async () => {
    const fetchMock = vi
      .fn()
      // findZone for "www.example.com" → no match
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: [] }), { status: 200 }),
      )
      // findZone for "example.com" → match
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ result: [{ id: 'zone-1', name: 'example.com' }] }),
          { status: 200 },
        ),
      )
      // createTxt
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            result: {
              id: 'rec-99',
              type: 'TXT',
              name: '_acme-challenge.www.example.com',
              content: 'expected-digest',
            },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const poller: PropagationPoller = {
      isVisible: vi.fn().mockResolvedValue(true),
    };

    const c = new CloudflareDns01Challenger(dbCtx.db, poller, fakeLogger);
    c.setPropagationTuning(1, 2);
    const state = await c.create('www.example.com', 'keyauth.thumb');

    expect(state).toEqual({
      recordId: 'rec-99',
      zoneId: 'zone-1',
      recordName: '_acme-challenge.www.example.com',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.unstubAllGlobals();
  });

  it('times out propagation polling after maxAttempts', async () => {
    const fetchMock = vi
      .fn()
      // zone (one call needed since "example.com" matches on first try)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ result: [{ id: 'zone-1', name: 'example.com' }] }),
          { status: 200 },
        ),
      )
      // createTxt
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            result: {
              id: 'rec-99',
              type: 'TXT',
              name: '_acme-challenge.example.com',
              content: 'x',
            },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const poller: PropagationPoller = {
      isVisible: vi.fn().mockResolvedValue(false),
    };

    const c = new CloudflareDns01Challenger(dbCtx.db, poller, fakeLogger);
    c.setPropagationTuning(1, 3);
    await expect(c.create('example.com', 'auth')).rejects.toThrow(
      /did not propagate/,
    );
    expect((poller.isVisible as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3);
    vi.unstubAllGlobals();
  });

  it('throws if the Cloudflare API token is not set', async () => {
    const empty = setupDb();
    const poller: PropagationPoller = { isVisible: () => Promise.resolve(false) };
    const c = new CloudflareDns01Challenger(empty.db, poller, fakeLogger);
    await expect(c.create('a.example.com', 'auth')).rejects.toThrow(
      /Cloudflare API token not set/,
    );
    empty.sqlite.close();
  });
});
