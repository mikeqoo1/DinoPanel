import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { Readable } from 'node:stream';
import { gunzipSync, gzipSync } from 'node:zlib';
import type Dockerode from 'dockerode';
import * as schema from '../../../database/schema';
import { backups, dbInstances } from '../../../database/schema';
import type { BackupDriver } from '../backup-driver';
import { BackupDriverRegistry } from '../backup-driver.registry';
import { BackupsService } from '../backups.service';

type Db = BetterSQLite3Database<typeof schema>;

function setupDb(): Db {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  // Hand-rolled schemas so tests don't have to apply migrations
  // (mirrors db-instances.service.test.ts fixture style).
  sqlite.exec(`
    CREATE TABLE db_instances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      engine TEXT NOT NULL,
      image_tag TEXT NOT NULL,
      port INTEGER NOT NULL,
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      data_dir TEXT NOT NULL,
      container_name TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      last_error TEXT,
      pmm_registered INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE backups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id INTEGER NOT NULL REFERENCES db_instances(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      source TEXT NOT NULL,
      retention_group TEXT,
      keep_last_n INTEGER,
      status TEXT NOT NULL,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  return drizzle(sqlite, { schema });
}

function seedInstance(db: Db, name = 'shop', engine = 'mysql'): number {
  const now = Date.now();
  const result = db
    .insert(dbInstances)
    .values({
      name,
      engine: engine as 'mysql',
      imageTag: 'mysql:8.4',
      port: 49_001,
      username: 'root',
      password: 'pw',
      dataDir: `/tmp/${name}`,
      containerName: `dinopanel-${engine}-${name}`,
      status: 'running',
      lastError: null,
      pmmRegistered: false,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .all();
  return result[0]!.id;
}

/**
 * A configurable stub driver. Service tests only care about:
 *   - what bytes dump() produces (so we can verify the gzipped file)
 *   - that restore() received the expected bytes (post-gunzip)
 *   - whether the dump throws (failure-path coverage)
 */
function makeStubDriver(opts: {
  engine: 'mysql' | 'mariadb' | 'postgresql' | 'redis' | 'mongodb';
  alreadyGzipped?: boolean;
  extension?: string;
  dumpBytes?: Buffer;
  dumpThrows?: Error;
  onRestore?: (received: Buffer) => void | Promise<void>;
}): BackupDriver {
  return {
    engine: opts.engine,
    alreadyGzipped: opts.alreadyGzipped ?? false,
    extension: opts.extension ?? 'sql',
    async dump() {
      if (opts.dumpThrows) throw opts.dumpThrows;
      const r = new PassThrough();
      setImmediate(() => {
        r.end(opts.dumpBytes ?? Buffer.from('STUB-DUMP-BYTES'));
      });
      return r;
    },
    async restore({ stream }) {
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      if (opts.onRestore) await opts.onRestore(Buffer.concat(chunks));
    },
  };
}

function makeRegistry(driver: BackupDriver): BackupDriverRegistry {
  // Stub each slot with the same configurable driver so tests can
  // pick any engine for their seeded instance.
  const mk = (engine: BackupDriver['engine']): BackupDriver => ({
    ...driver,
    engine,
  });
  return new BackupDriverRegistry(
    mk('mysql') as never,
    mk('mariadb') as never,
    mk('postgresql') as never,
    mk('redis') as never,
    mk('mongodb') as never,
  );
}

function makeDocker(): Dockerode {
  return {
    getContainer: () => ({} as Dockerode.Container),
  } as unknown as Dockerode;
}

function makeConfig(backupsRoot: string): ConstructorParameters<typeof BackupsService>[2] {
  return {
    get: () => ({ env: { BACKUPS_ROOT: backupsRoot } }),
  } as unknown as ConstructorParameters<typeof BackupsService>[2];
}

function makeService(db: Db, root: string, driver: BackupDriver): BackupsService {
  return new BackupsService(db, makeDocker(), makeConfig(root), makeRegistry(driver));
}

describe('BackupsService.create', () => {
  let db: Db;
  let root: string;

  beforeEach(() => {
    db = setupDb();
    root = mkdtempSync(join(tmpdir(), 'backups-test-'));
  });

  it('streams dump → gzip → file, inserts success row, returns response', async () => {
    const id = seedInstance(db);
    const driver = makeStubDriver({ engine: 'mysql', dumpBytes: Buffer.from('-- SQL DUMP') });
    const svc = makeService(db, root, driver);

    const resp = await svc.create({ instanceId: id, source: 'manual' });
    expect(resp.status).toBe('success');
    expect(resp.source).toBe('manual');
    expect(resp.engine).toBe('mysql');
    expect(resp.instanceName).toBe('shop');
    expect(resp.byteSize).toBeGreaterThan(0);
    expect(existsSync(resp.filePath)).toBe(true);
    // File is gzipped — gunzip should give back the original bytes.
    expect(gunzipSync(readFileSync(resp.filePath)).toString('utf8')).toBe('-- SQL DUMP');
    // Row is present in DB.
    const rows = await db.select().from(backups).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('success');
  });

  it('skips host gzip when driver.alreadyGzipped=true (mongo path)', async () => {
    const id = seedInstance(db, 'analytics', 'mongodb');
    const gzipped = gzipSync(Buffer.from('mongo bson archive'));
    const driver = makeStubDriver({
      engine: 'mongodb',
      alreadyGzipped: true,
      extension: 'archive',
      dumpBytes: gzipped,
    });
    const svc = makeService(db, root, driver);

    const resp = await svc.create({ instanceId: id, source: 'manual' });
    expect(resp.filePath.endsWith('.archive.gz')).toBe(true);
    // File on disk is exactly the gzipped bytes the driver produced
    // (no double-gzip — that would change the bytes).
    expect(readFileSync(resp.filePath).equals(gzipped)).toBe(true);
  });

  it('records a failed row + cleans up partial file when driver.dump throws', async () => {
    const id = seedInstance(db);
    const driver = makeStubDriver({
      engine: 'mysql',
      dumpThrows: new Error('connection refused'),
    });
    const svc = makeService(db, root, driver);

    await expect(svc.create({ instanceId: id, source: 'manual' })).rejects.toThrow(
      /connection refused/,
    );
    const rows = await db.select().from(backups).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('failed');
    expect(rows[0]!.error).toContain('connection refused');
    // No leftover file on disk.
    expect(existsSync(rows[0]!.filePath)).toBe(false);
  });

  it('prunes oldest in (instance, retention_group) past keepLastN, leaves manual rows alone', async () => {
    const id = seedInstance(db);
    const driver = makeStubDriver({ engine: 'mysql' });
    const svc = makeService(db, root, driver);

    // Seed 3 existing scheduled rows in the same retention group +
    // 1 manual row that the prune must NOT touch.
    const now = Date.now();
    db.insert(backups)
      .values([
        { instanceId: id, filePath: '/dev/null/old-1', byteSize: 1, durationMs: 1, source: 'scheduled', retentionGroup: 'nightly', keepLastN: 2, status: 'success', error: null, createdAt: now - 30_000, updatedAt: now - 30_000 },
        { instanceId: id, filePath: '/dev/null/old-2', byteSize: 1, durationMs: 1, source: 'scheduled', retentionGroup: 'nightly', keepLastN: 2, status: 'success', error: null, createdAt: now - 20_000, updatedAt: now - 20_000 },
        { instanceId: id, filePath: '/dev/null/old-3', byteSize: 1, durationMs: 1, source: 'scheduled', retentionGroup: 'nightly', keepLastN: 2, status: 'success', error: null, createdAt: now - 10_000, updatedAt: now - 10_000 },
        { instanceId: id, filePath: '/dev/null/manual', byteSize: 1, durationMs: 1, source: 'manual', retentionGroup: null, keepLastN: null, status: 'success', error: null, createdAt: now - 5_000, updatedAt: now - 5_000 },
      ])
      .run();

    await svc.create({
      instanceId: id,
      source: 'scheduled',
      retentionGroup: 'nightly',
      keepLastN: 2,
    });

    // After: 2 newest scheduled remain + the new scheduled one + the manual = 3 total.
    const rows = await db.select().from(backups).all();
    const nightly = rows.filter((r) => r.retentionGroup === 'nightly');
    expect(nightly).toHaveLength(2);
    expect(rows.find((r) => r.source === 'manual')).toBeDefined();
    // Oldest two scheduled (`old-1`, `old-2`) gone.
    expect(rows.find((r) => r.filePath === '/dev/null/old-1')).toBeUndefined();
    expect(rows.find((r) => r.filePath === '/dev/null/old-2')).toBeUndefined();
  });

  it('does not prune when retention_group is null (manual backup exempt)', async () => {
    const id = seedInstance(db);
    const driver = makeStubDriver({ engine: 'mysql' });
    const svc = makeService(db, root, driver);

    const now = Date.now();
    // 5 existing manual backups — none should be pruned by a 6th.
    db.insert(backups)
      .values(
        Array.from({ length: 5 }, (_, i) => ({
          instanceId: id,
          filePath: `/dev/null/m${i}`,
          byteSize: 1,
          durationMs: 1,
          source: 'manual' as const,
          retentionGroup: null,
          keepLastN: null,
          status: 'success' as const,
          error: null,
          createdAt: now - (5 - i) * 1000,
          updatedAt: now - (5 - i) * 1000,
        })),
      )
      .run();

    await svc.create({ instanceId: id, source: 'manual' });
    const rows = await db.select().from(backups).all();
    expect(rows).toHaveLength(6);
  });
});

describe('BackupsService.list', () => {
  it('filters by instanceId, sorts newest first, paginates via cursor', async () => {
    const db = setupDb();
    const root = mkdtempSync(join(tmpdir(), 'backups-list-'));
    const a = seedInstance(db, 'shop', 'mysql');
    const b = seedInstance(db, 'orders', 'postgresql');
    const now = Date.now();
    db.insert(backups)
      .values([
        { instanceId: a, filePath: '/x/a1', byteSize: 1, durationMs: 1, source: 'manual', retentionGroup: null, keepLastN: null, status: 'success', error: null, createdAt: now - 100, updatedAt: now - 100 },
        { instanceId: a, filePath: '/x/a2', byteSize: 1, durationMs: 1, source: 'manual', retentionGroup: null, keepLastN: null, status: 'success', error: null, createdAt: now - 50, updatedAt: now - 50 },
        { instanceId: b, filePath: '/x/b1', byteSize: 1, durationMs: 1, source: 'manual', retentionGroup: null, keepLastN: null, status: 'success', error: null, createdAt: now - 10, updatedAt: now - 10 },
      ])
      .run();

    const svc = makeService(db, root, makeStubDriver({ engine: 'mysql' }));
    const all = await svc.list({ limit: 50 });
    expect(all.items.map((i) => i.filePath)).toEqual(['/x/b1', '/x/a2', '/x/a1']);

    const onlyA = await svc.list({ instanceId: a, limit: 50 });
    expect(onlyA.items.map((i) => i.filePath)).toEqual(['/x/a2', '/x/a1']);

    const first = await svc.list({ limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await svc.list({ limit: 2, cursor: first.nextCursor! });
    expect(second.items).toHaveLength(1);
  });
});

describe('BackupsService.delete', () => {
  it('unlinks the file then drops the row', async () => {
    const db = setupDb();
    const root = mkdtempSync(join(tmpdir(), 'backups-del-'));
    const id = seedInstance(db);
    const filePath = join(root, 'scratch.gz');
    writeFileSync(filePath, 'gzipped-bytes');
    const now = Date.now();
    db.insert(backups)
      .values({
        instanceId: id,
        filePath,
        byteSize: 13,
        durationMs: 1,
        source: 'manual',
        retentionGroup: null,
        keepLastN: null,
        status: 'success',
        error: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const [row] = await db.select().from(backups).all();
    const svc = makeService(db, root, makeStubDriver({ engine: 'mysql' }));

    await svc.delete(row!.id);
    expect(existsSync(filePath)).toBe(false);
    expect(await db.select().from(backups).all()).toHaveLength(0);
  });

  it('tolerates a missing on-disk file (still drops the row)', async () => {
    const db = setupDb();
    const root = mkdtempSync(join(tmpdir(), 'backups-del-missing-'));
    const id = seedInstance(db);
    const now = Date.now();
    db.insert(backups)
      .values({
        instanceId: id,
        filePath: '/dev/null/nope.gz',
        byteSize: 0,
        durationMs: 1,
        source: 'manual',
        retentionGroup: null,
        keepLastN: null,
        status: 'success',
        error: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const [row] = await db.select().from(backups).all();
    const svc = makeService(db, root, makeStubDriver({ engine: 'mysql' }));

    await svc.delete(row!.id);
    expect(await db.select().from(backups).all()).toHaveLength(0);
  });
});

describe('BackupsService.restore', () => {
  it('rejects when confirm does not match the instance name', async () => {
    const db = setupDb();
    const root = mkdtempSync(join(tmpdir(), 'backups-restore-confirm-'));
    const id = seedInstance(db, 'shop');
    const filePath = join(root, 'b.gz');
    writeFileSync(filePath, gzipSync(Buffer.from('whatever')));
    const now = Date.now();
    db.insert(backups)
      .values({
        instanceId: id,
        filePath,
        byteSize: 1,
        durationMs: 1,
        source: 'manual',
        retentionGroup: null,
        keepLastN: null,
        status: 'success',
        error: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const [row] = await db.select().from(backups).all();
    const svc = makeService(db, root, makeStubDriver({ engine: 'mysql' }));

    await expect(
      svc.restore({ backupId: row!.id, confirm: 'NOT_THE_NAME' }),
    ).rejects.toThrow(/confirm string must match/);
  });

  it('gunzips file on host and passes the raw bytes to driver.restore (non-mongo)', async () => {
    const db = setupDb();
    const root = mkdtempSync(join(tmpdir(), 'backups-restore-mysql-'));
    const id = seedInstance(db, 'shop');
    const filePath = join(root, 'b.sql.gz');
    writeFileSync(filePath, gzipSync(Buffer.from('INSERT INTO t VALUES (1);')));
    const now = Date.now();
    db.insert(backups)
      .values({
        instanceId: id,
        filePath,
        byteSize: 1,
        durationMs: 1,
        source: 'manual',
        retentionGroup: null,
        keepLastN: null,
        status: 'success',
        error: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const [row] = await db.select().from(backups).all();

    const restoreCapture = vi.fn();
    const driver = makeStubDriver({ engine: 'mysql', onRestore: (buf) => restoreCapture(buf.toString('utf8')) });
    const svc = makeService(db, root, driver);
    await svc.restore({ backupId: row!.id, confirm: 'shop' });
    expect(restoreCapture).toHaveBeenCalledWith('INSERT INTO t VALUES (1);');
  });

  it('skips gunzip and passes the gzipped file straight to driver.restore (mongo path)', async () => {
    const db = setupDb();
    const root = mkdtempSync(join(tmpdir(), 'backups-restore-mongo-'));
    const id = seedInstance(db, 'analytics', 'mongodb');
    const gzipped = gzipSync(Buffer.from('bson archive'));
    const filePath = join(root, 'b.archive.gz');
    writeFileSync(filePath, gzipped);
    const now = Date.now();
    db.insert(backups)
      .values({
        instanceId: id,
        filePath,
        byteSize: gzipped.length,
        durationMs: 1,
        source: 'manual',
        retentionGroup: null,
        keepLastN: null,
        status: 'success',
        error: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const [row] = await db.select().from(backups).all();

    let captured: Buffer | null = null;
    const driver = makeStubDriver({
      engine: 'mongodb',
      alreadyGzipped: true,
      extension: 'archive',
      onRestore: (buf) => {
        captured = buf;
      },
    });
    const svc = makeService(db, root, driver);
    await svc.restore({ backupId: row!.id, confirm: 'analytics' });
    expect(captured).not.toBeNull();
    expect(captured!.equals(gzipped)).toBe(true);
  });
});

describe('BackupsService.streamFile', () => {
  it('returns a Readable + filename + byteSize for download', async () => {
    const db = setupDb();
    const root = mkdtempSync(join(tmpdir(), 'backups-dl-'));
    const id = seedInstance(db);
    const filePath = join(root, 'b.sql.gz');
    writeFileSync(filePath, 'hello-gz');
    const now = Date.now();
    db.insert(backups)
      .values({
        instanceId: id,
        filePath,
        byteSize: 8,
        durationMs: 1,
        source: 'manual',
        retentionGroup: null,
        keepLastN: null,
        status: 'success',
        error: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const [row] = await db.select().from(backups).all();
    const svc = makeService(db, root, makeStubDriver({ engine: 'mysql' }));

    const dl = await svc.streamFile(row!.id);
    expect(dl.filename).toBe('b.sql.gz');
    expect(dl.byteSize).toBe(8);
    const chunks: Buffer[] = [];
    for await (const c of dl.stream as Readable) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).toString('utf8')).toBe('hello-gz');
  });

  it('throws BACKUP_FILE_MISSING when the on-disk file no longer exists', async () => {
    const db = setupDb();
    const root = mkdtempSync(join(tmpdir(), 'backups-dl-missing-'));
    const id = seedInstance(db);
    const now = Date.now();
    db.insert(backups)
      .values({
        instanceId: id,
        filePath: join(root, 'gone.gz'),
        byteSize: 0,
        durationMs: 1,
        source: 'manual',
        retentionGroup: null,
        keepLastN: null,
        status: 'success',
        error: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const [row] = await db.select().from(backups).all();
    const svc = makeService(db, root, makeStubDriver({ engine: 'mysql' }));

    await expect(svc.streamFile(row!.id)).rejects.toMatchObject({
      response: { code: 'BACKUP_FILE_MISSING' },
    });
  });
});
