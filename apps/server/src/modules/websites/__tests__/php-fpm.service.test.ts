import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../database/schema';
import { PhpFpmService, normalizeExternalUpstream } from '../php-fpm.service';
import type Dockerode from 'dockerode';

type Db = BetterSQLite3Database<typeof schema>;

function setupDb(): Db {
  const sqlite = new Database(':memory:');
  // PhpFpmService doesn't touch sites in the test paths covered here,
  // but scheduleIdleStop counts php rows — add the table.
  sqlite.exec(`
    CREATE TABLE sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      primary_domain TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      managed_by_dinopanel INTEGER NOT NULL DEFAULT 1,
      orphaned INTEGER NOT NULL DEFAULT 0,
      external_conf_path TEXT,
      cert_paths TEXT,
      cert_expires_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  return drizzle(sqlite, { schema });
}

interface MakeOpts {
  envSocketPath?: string;
  inspectImpl?: () => unknown;
  createImpl?: ReturnType<typeof vi.fn>;
  startImpl?: ReturnType<typeof vi.fn>;
}

function makeService(db: Db, opts: MakeOpts = {}): {
  svc: PhpFpmService;
  inspect: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
} {
  const inspect = vi.fn(async () => {
    if (opts.inspectImpl) return opts.inspectImpl();
    const err = new Error('not found') as Error & { statusCode: number };
    err.statusCode = 404;
    throw err;
  });
  const start = opts.startImpl ?? vi.fn(async () => undefined);
  const create = opts.createImpl ?? vi.fn(async () => ({
    start: vi.fn(async () => undefined),
  }));
  const docker = {
    getContainer: () => ({ inspect, start, stop: vi.fn(), restart: vi.fn() }),
    createContainer: create,
  } as unknown as Dockerode;
  const config = {
    get: () => ({
      env: {
        PHP_FPM_SOCKET_PATH: opts.envSocketPath ?? '',
        WEBSITES_ROOT: '/opt/dinopanel',
      },
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  const logger = {
    debug: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { svc: new PhpFpmService(db, docker, config, logger), inspect, create, start };
}

describe('PhpFpmService — auto-provision', () => {
  it('first PHP site triggers createContainer when no existing container', async () => {
    const db = setupDb();
    const { svc, create } = makeService(db);
    await svc.ensureRunning();
    expect(create).toHaveBeenCalledTimes(1);
    const spec = create.mock.calls[0]![0] as { name: string; Image: string };
    expect(spec.name).toBe('dinopanel-php-fpm');
    expect(spec.Image).toBe('php:8.3-fpm');
    expect(svc.getUpstream()).toBe('127.0.0.1:9000');
  });

  it('second ensureRunning call is idempotent when container already running', async () => {
    const db = setupDb();
    const { svc, create } = makeService(db, {
      inspectImpl: () => ({ State: { Running: true } }),
    });
    await svc.ensureRunning();
    expect(create).not.toHaveBeenCalled(); // already running, no-op
  });

  it('skips auto-provision when PHP_FPM_SOCKET_PATH env is set (external mode)', async () => {
    const db = setupDb();
    const { svc, create } = makeService(db, {
      envSocketPath: '/run/php-fpm/operator.sock',
    });
    await svc.ensureRunning();
    expect(create).not.toHaveBeenCalled();
    expect(svc.isExternalMode()).toBe(true);
    expect(svc.getUpstream()).toBe('unix:/run/php-fpm/operator.sock');
  });
});

describe('normalizeExternalUpstream', () => {
  it('returns null for empty (auto-provision mode)', () => {
    expect(normalizeExternalUpstream('')).toBeNull();
    expect(normalizeExternalUpstream('   ')).toBeNull();
  });

  it('strips tcp:// prefix to bare host:port', () => {
    expect(normalizeExternalUpstream('tcp://127.0.0.1:9000')).toBe('127.0.0.1:9000');
  });

  it('passes through unix: prefix and bare path → unix:', () => {
    expect(normalizeExternalUpstream('unix:/run/php.sock')).toBe('unix:/run/php.sock');
    expect(normalizeExternalUpstream('/run/php.sock')).toBe('unix:/run/php.sock');
  });
});
