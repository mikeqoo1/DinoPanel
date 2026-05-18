import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { BadRequestException } from '@nestjs/common';

import { MonitoringService } from '../monitoring.service';

// ---------------------------------------------------------------------------
// Lightweight in-memory mock for the settings table.
// The service only calls `select`/`from`/`where`/`limit`, `delete`/`where`,
// and `insert`/`values`/`onConflictDoUpdate` on it — so we can fake those
// in a single object with the same chain shape.
// ---------------------------------------------------------------------------

function makeDb() {
  const rows = new Map<string, { key: string; value: string; updatedAt: number }>();

  const db = {
    _rows: rows,
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(Array.from(rows.values())),
        }),
      }),
    }),
    insert: () => ({
      values: (v: { key: string; value: string }) => {
        rows.set(v.key, { key: v.key, value: v.value, updatedAt: Date.now() });
        return {
          onConflictDoUpdate: (_args: unknown) => Promise.resolve(undefined),
        };
      },
    }),
    delete: () => ({
      where: () => {
        rows.clear();
        return Promise.resolve(undefined);
      },
    }),
  };
  return db;
}

// ---------------------------------------------------------------------------
// Boot a real HTTP server for probe round-trip tests (fakes PMM /v1/readyz)
// ---------------------------------------------------------------------------

let fakePmm: Server | null = null;
let fakePmmStatus = 200;
let fakePmmDelayMs = 0;

beforeEach(async () => {
  fakePmmStatus = 200;
  fakePmmDelayMs = 0;
  fakePmm = createServer((req, res) => {
    setTimeout(() => {
      res.statusCode = req.url === '/v1/readyz' ? fakePmmStatus : 404;
      res.end();
    }, fakePmmDelayMs);
  });
  await new Promise<void>((resolve) => fakePmm!.listen(0, '127.0.0.1', resolve));
});

afterEach(() => {
  fakePmm?.close();
  fakePmm = null;
  vi.restoreAllMocks();
});

function fakePmmUrl(): string {
  const addr = fakePmm!.address() as AddressInfo;
  return `http://127.0.0.1:${addr.port}`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MonitoringService.getConfig / setConfig', () => {
  it('MON-1 — getConfig returns null when no row stored', async () => {
    const db = makeDb();
    const svc = new MonitoringService(db as never);
    expect(await svc.getConfig()).toEqual({ url: null });
  });

  it('MON-2 — setConfig with a valid URL stores it and trims trailing slash', async () => {
    const db = makeDb();
    const svc = new MonitoringService(db as never);
    const out = await svc.setConfig('https://example.test:8443/');
    expect(out).toEqual({ url: 'https://example.test:8443' });
    expect(await svc.getConfig()).toEqual({ url: 'https://example.test:8443' });
  });

  it('MON-3 — setConfig rejects non-http(s) input', async () => {
    const db = makeDb();
    const svc = new MonitoringService(db as never);
    await expect(svc.setConfig('not-a-url')).rejects.toThrow(BadRequestException);
    await expect(svc.setConfig('ftp://example.test')).rejects.toThrow(BadRequestException);
  });

  it('MON-4 — setConfig with null clears the stored URL', async () => {
    const db = makeDb();
    const svc = new MonitoringService(db as never);
    await svc.setConfig('https://example.test');
    await svc.setConfig(null);
    expect(await svc.getConfig()).toEqual({ url: null });
  });
});

describe('MonitoringService.getPmmStatus', () => {
  it('MON-5 — returns ok:true with latency when PMM responds 200', async () => {
    const db = makeDb();
    const svc = new MonitoringService(db as never);
    await svc.setConfig(fakePmmUrl());
    fakePmmStatus = 200;

    const status = await svc.getPmmStatus();
    expect(status.ok).toBe(true);
    expect(status.latencyMs).not.toBeNull();
    expect(status.latencyMs!).toBeGreaterThanOrEqual(0);
    expect(typeof status.lastChecked).toBe('string');
  });

  it('MON-6 — returns ok:false latencyMs:null when no URL configured', async () => {
    const db = makeDb();
    const svc = new MonitoringService(db as never);
    const status = await svc.getPmmStatus();
    expect(status).toMatchObject({ ok: false, latencyMs: null });
  });

  it('MON-7 — returns ok:false when PMM responds non-200', async () => {
    const db = makeDb();
    const svc = new MonitoringService(db as never);
    await svc.setConfig(fakePmmUrl());
    fakePmmStatus = 503;

    const status = await svc.getPmmStatus();
    expect(status.ok).toBe(false);
    expect(status.latencyMs).not.toBeNull();
  });

  it('MON-8 — returns ok:false when target is unreachable', async () => {
    const db = makeDb();
    const svc = new MonitoringService(db as never);
    // Port 1 is reserved / unused — should refuse connection
    await svc.setConfig('http://127.0.0.1:1');

    const status = await svc.getPmmStatus();
    expect(status).toMatchObject({ ok: false, latencyMs: null });
  });
});
