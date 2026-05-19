import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { tmpdir } from 'node:os';
import { mkdtempSync, statSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type Dockerode from 'dockerode';
import * as schema from '../../../database/schema';
import { dbInstances } from '../../../database/schema';
import { DbInstancesService } from '../db-instances.service';
import { DbEngineRegistry } from '../db-engine.registry';
import { MariadbDriver } from '../engines/mariadb.driver';
import { MongoDriver } from '../engines/mongo.driver';
import { MysqlDriver } from '../engines/mysql.driver';
import { PostgresDriver } from '../engines/postgres.driver';
import { RedisDriver } from '../engines/redis.driver';

// SELinux relabel is a no-op shellout — `relabelPath` returns
// `{ ok: false, reason: 'not_installed' }` on hosts without semanage
// (every CI sandbox + dev mac), and the service treats that as
// success. No mock needed.

type Db = BetterSQLite3Database<typeof schema>;

function setupDb(): Db {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  // dbInstances mirrors drizzle migration 0004. Hand-rolled here so
  // tests don't have to apply migrations (matches v0.3 fixture style).
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
  `);
  return drizzle(sqlite, { schema });
}

interface FakeContainer {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  restart: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  exec: ReturnType<typeof vi.fn>;
  inspect: ReturnType<typeof vi.fn>;
}

interface MockDockerOpts {
  startThrows?: boolean;
}

function makeMockDocker(opts: MockDockerOpts = {}): {
  docker: Dockerode;
  containers: Map<string, FakeContainer>;
  createCalls: Array<{ name: string }>;
} {
  const containers = new Map<string, FakeContainer>();
  const createCalls: Array<{ name: string }> = [];
  const docker = {
    async createContainer(spec: { name: string }) {
      createCalls.push({ name: spec.name });
      const fake: FakeContainer = {
        start: vi.fn(async () => {
          if (opts.startThrows) {
            throw new Error('intentional start failure');
          }
        }),
        stop: vi.fn(async () => undefined),
        restart: vi.fn(async () => undefined),
        remove: vi.fn(async () => undefined),
        exec: vi.fn(),
        inspect: vi.fn(),
      };
      containers.set(spec.name, fake);
      return fake;
    },
    getContainer(name: string) {
      return containers.get(name) ?? {
        stop: vi.fn(async () => undefined),
        start: vi.fn(async () => undefined),
        restart: vi.fn(async () => undefined),
        remove: vi.fn(async () => undefined),
      };
    },
    async listContainers() {
      return [];
    },
  } as unknown as Dockerode;
  return { docker, containers, createCalls };
}

function makeRegistry(): DbEngineRegistry {
  return new DbEngineRegistry(
    new MysqlDriver(),
    new MariadbDriver(),
    new PostgresDriver(),
    new RedisDriver(),
    new MongoDriver(),
  );
}

function makeService(
  db: Db,
  docker: Dockerode,
  databasesRoot: string,
): DbInstancesService {
  const config = {
    get: () => ({ env: { DATABASES_ROOT: databasesRoot } }),
  } as unknown as ConstructorParameters<typeof DbInstancesService>[2];
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as ConstructorParameters<typeof DbInstancesService>[4];
  return new DbInstancesService(db, docker, config, makeRegistry(), logger);
}

describe('DbInstancesService.create', () => {
  let db: Db;
  let dataRoot: string;

  beforeEach(() => {
    db = setupDb();
    dataRoot = mkdtempSync(join(tmpdir(), 'dinopanel-db-test-'));
  });

  it('happy path inserts row + starts container + writes data dir', async () => {
    const { docker, createCalls, containers } = makeMockDocker();
    const svc = makeService(db, docker, dataRoot);
    // Cherry-pick a high port to dodge any local clash in CI.
    const port = 49_001;
    const res = await svc.create({
      name: 'shop',
      engine: 'mysql',
      port,
    });
    expect(res.containerName).toBe('dinopanel-mysql-shop');
    expect(res.status).toBe('running');
    expect(res.password.length).toBeGreaterThanOrEqual(32);
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]!.name).toBe('dinopanel-mysql-shop');
    expect(containers.get('dinopanel-mysql-shop')!.start).toHaveBeenCalledTimes(1);
    // Filesystem side-effect — dir actually exists.
    expect(existsSync(join(dataRoot, 'mysql', 'shop'))).toBe(true);
    // Row landed in DB.
    const rows = await db.select().from(dbInstances).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.engine).toBe('mysql');
  });

  it('postgres branch creates the PGDATA subdir', async () => {
    const { docker } = makeMockDocker();
    const svc = makeService(db, docker, dataRoot);
    await svc.create({ name: 'app', engine: 'postgresql', port: 49_002 });
    const subdir = join(dataRoot, 'postgresql', 'app', 'pgdata');
    expect(existsSync(subdir)).toBe(true);
    // 0755 mode — verifies the mkdir call uses the expected mode.
    expect((statSync(subdir).mode & 0o777)).toBe(0o755);
  });

  it('port conflict (DB-side) throws DB_PORT_CONFLICT before touching docker', async () => {
    const { docker, createCalls } = makeMockDocker();
    const svc = makeService(db, docker, dataRoot);
    // Pre-seed a row holding the port.
    await db.insert(dbInstances).values({
      name: 'existing',
      engine: 'redis',
      imageTag: 'redis:7.4-alpine',
      port: 49_003,
      username: 'default',
      password: 'x',
      dataDir: join(dataRoot, 'redis', 'existing'),
      containerName: 'dinopanel-redis-existing',
      status: 'running',
      lastError: null,
      pmmRegistered: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await expect(
      svc.create({ name: 'fresh', engine: 'redis', port: 49_003 }),
    ).rejects.toMatchObject({ response: { code: 'DB_PORT_CONFLICT' } });
    expect(createCalls).toHaveLength(0); // never reached docker
  });

  it('rolls back data dir + container when start() throws', async () => {
    const { docker, containers } = makeMockDocker({ startThrows: true });
    const svc = makeService(db, docker, dataRoot);
    await expect(
      svc.create({ name: 'bad', engine: 'mongodb', port: 49_004 }),
    ).rejects.toMatchObject({ response: { code: 'DB_CREATE_FAILED' } });
    // The container was created then force-removed on the rollback path.
    expect(containers.get('dinopanel-mongodb-bad')!.remove).toHaveBeenCalled();
    // Data dir cleaned up.
    expect(existsSync(join(dataRoot, 'mongodb', 'bad'))).toBe(false);
    // No row persisted.
    const rows = await db.select().from(dbInstances).all();
    expect(rows).toHaveLength(0);
  });

  it('duplicate name throws DB_NAME_TAKEN', async () => {
    const { docker } = makeMockDocker();
    const svc = makeService(db, docker, dataRoot);
    await svc.create({ name: 'shop', engine: 'mysql', port: 49_005 });
    await expect(
      svc.create({ name: 'shop', engine: 'mysql', port: 49_006 }),
    ).rejects.toMatchObject({ response: { code: 'DB_NAME_TAKEN' } });
  });
});

describe('DbInstancesService.remove', () => {
  let db: Db;
  let dataRoot: string;

  beforeEach(() => {
    db = setupDb();
    dataRoot = mkdtempSync(join(tmpdir(), 'dinopanel-db-test-'));
  });

  it('dropData=false keeps the data dir intact', async () => {
    const { docker } = makeMockDocker();
    const svc = makeService(db, docker, dataRoot);
    const inst = await svc.create({ name: 'cache', engine: 'redis', port: 49_007 });
    await svc.remove(inst.id, { dropData: false });
    expect(existsSync(inst.dataDir)).toBe(true);
    expect((await db.select().from(dbInstances).all())).toHaveLength(0);
  });

  it('dropData=true removes the data dir', async () => {
    const { docker } = makeMockDocker();
    const svc = makeService(db, docker, dataRoot);
    const inst = await svc.create({ name: 'cache', engine: 'redis', port: 49_008 });
    await svc.remove(inst.id, { dropData: true });
    expect(existsSync(inst.dataDir)).toBe(false);
  });
});

describe('DbInstancesService.rotatePassword', () => {
  let db: Db;
  let dataRoot: string;

  beforeEach(() => {
    db = setupDb();
    dataRoot = mkdtempSync(join(tmpdir(), 'dinopanel-db-test-'));
  });

  it('replaces the password and recreates the container (brief downtime)', async () => {
    const { docker, createCalls } = makeMockDocker();
    const svc = makeService(db, docker, dataRoot);
    const inst = await svc.create({ name: 'shop', engine: 'mysql', port: 49_009 });
    const before = inst.password;
    const after = await svc.rotatePassword(inst.id);
    expect(after.password).not.toBe(before);
    expect(after.password.length).toBeGreaterThanOrEqual(32);
    // createContainer called twice — once for create, once for rotate.
    expect(createCalls).toHaveLength(2);
  });
});

describe('DbInstancesService.reconcile', () => {
  let db: Db;
  let dataRoot: string;

  beforeEach(() => {
    db = setupDb();
    dataRoot = mkdtempSync(join(tmpdir(), 'dinopanel-db-test-'));
  });

  it('empty docker + empty DB → all zeros', async () => {
    const { docker } = makeMockDocker();
    const svc = makeService(db, docker, dataRoot);
    const res = await svc.reconcile();
    expect(res).toEqual({
      scanned: 0,
      matched: 0,
      missingContainer: 0,
      orphanContainer: 0,
    });
  });

  it('matching container → status synced, matched counter advances', async () => {
    const { docker } = makeMockDocker();
    const svc = makeService(db, docker, dataRoot);
    await svc.create({ name: 'shop', engine: 'mysql', port: 49_010 });
    // Inject a fake `listContainers` result that mirrors what dockerode
    // would return for the just-created container.
    (docker as unknown as { listContainers: () => Promise<unknown> }).listContainers =
      async () => [
        {
          Names: ['/dinopanel-mysql-shop'],
          State: 'running',
        },
      ];
    const res = await svc.reconcile();
    expect(res.scanned).toBe(1);
    expect(res.matched).toBe(1);
    expect(res.missingContainer).toBe(0);
  });

  it('row whose container is missing gets marked error', async () => {
    const { docker } = makeMockDocker();
    const svc = makeService(db, docker, dataRoot);
    const inst = await svc.create({ name: 'gone', engine: 'mysql', port: 49_011 });
    // docker reports no containers.
    (docker as unknown as { listContainers: () => Promise<unknown> }).listContainers =
      async () => [];
    const res = await svc.reconcile();
    expect(res.missingContainer).toBe(1);
    const row = await db
      .select()
      .from(dbInstances)
      .where(eq(dbInstances.id, inst.id))
      .all();
    expect(row[0]!.status).toBe('error');
    expect(row[0]!.lastError).toBe('container_missing');
  });

  it('orphan dinopanel-* container surfaces in counter, no DB write', async () => {
    const { docker } = makeMockDocker();
    const svc = makeService(db, docker, dataRoot);
    (docker as unknown as { listContainers: () => Promise<unknown> }).listContainers =
      async () => [
        {
          Names: ['/dinopanel-redis-stray'],
          State: 'running',
        },
      ];
    const res = await svc.reconcile();
    expect(res.orphanContainer).toBe(1);
    expect(res.scanned).toBe(0); // no rows in DB
  });
});
