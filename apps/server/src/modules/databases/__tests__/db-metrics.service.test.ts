import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../database/schema';
import { dbInstances } from '../../../database/schema';
import { DbMetricsService } from '../db-metrics.service';
import { DbEngineRegistry } from '../db-engine.registry';
import { MariadbDriver } from '../engines/mariadb.driver';
import { MongoDriver } from '../engines/mongo.driver';
import { MysqlDriver } from '../engines/mysql.driver';
import { PostgresDriver } from '../engines/postgres.driver';
import { RedisDriver } from '../engines/redis.driver';
import type { MonitoringService } from '../../monitoring/monitoring.service';
import type { PmmPromqlClient, PromqlResult } from '../../monitoring/pmm-promql.client';

type Db = BetterSQLite3Database<typeof schema>;

function setupDb(): Db {
  const sqlite = new Database(':memory:');
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

function makeMockMonitoring(): MonitoringService {
  return {
    onCredentialsChange: vi.fn(),
  } as unknown as MonitoringService;
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

function makeMockPmm(opts: {
  configured?: boolean;
  queryFn?: () => Promise<PromqlResult>;
}): PmmPromqlClient {
  const queryFn = opts.queryFn ?? (() => Promise.resolve<PromqlResult>({ ok: true, value: 1, timestamp: 0 }));
  return {
    resolveConfig: vi.fn(async () => ({
      url: opts.configured === false ? null : 'http://pmm.test',
      apiToken: 'tok',
      tlsSkipVerify: false,
    })),
    query: vi.fn(queryFn),
  } as unknown as PmmPromqlClient;
}

async function insertInstance(db: Db, name: string, engine: schema.DbInstance['engine']): Promise<number> {
  const now = Date.now();
  const rows = await db
    .insert(dbInstances)
    .values({
      name,
      engine,
      imageTag: 'test',
      port: 33060 + Math.floor(Math.random() * 1000),
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
  return rows[0]!.id;
}

describe('DbMetricsService.summaryFor', () => {
  let db: Db;

  beforeEach(() => {
    db = setupDb();
  });

  it('returns pmmConfigured=false when monitoring.pmm_url is unset', async () => {
    const pmm = makeMockPmm({ configured: false });
    const svc = new DbMetricsService(db, pmm, makeRegistry(), makeMockMonitoring());
    const id = await insertInstance(db, 'shop', 'mysql');
    const res = await svc.summaryFor(id);
    expect(res.pmmConfigured).toBe(false);
    expect(res.qps).toBeNull();
    // Should not have called .query at all when not configured.
    expect((pmm.query as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it('caches the result for 30s — second call hits cache', async () => {
    let invocations = 0;
    const pmm = makeMockPmm({
      queryFn: async () => {
        invocations += 1;
        return { ok: true, value: 42, timestamp: 1 };
      },
    });
    const svc = new DbMetricsService(db, pmm, makeRegistry(), makeMockMonitoring());
    const id = await insertInstance(db, 'shop', 'mysql');
    await svc.summaryFor(id);
    expect(invocations).toBe(4); // 4 PromQL queries
    await svc.summaryFor(id);
    expect(invocations).toBe(4); // unchanged — served from cache
  });

  it('?refresh=true bypasses cache', async () => {
    let invocations = 0;
    const pmm = makeMockPmm({
      queryFn: async () => {
        invocations += 1;
        return { ok: true, value: 1, timestamp: 0 };
      },
    });
    const svc = new DbMetricsService(db, pmm, makeRegistry(), makeMockMonitoring());
    const id = await insertInstance(db, 'shop', 'mysql');
    await svc.summaryFor(id);
    expect(invocations).toBe(4);
    await svc.summaryFor(id, { refresh: true });
    expect(invocations).toBe(8); // 4 more queries on refresh
  });

  it('partial failures (replication lag empty) → null on that field, others populated', async () => {
    const pmm = makeMockPmm({
      queryFn: async () => {
        const callIdx = (pmm.query as ReturnType<typeof vi.fn>).mock.calls.length;
        // bundle order: qps / connections / uptime / replicationLag
        if (callIdx === 4) {
          return { ok: false, reason: 'empty_vector' };
        }
        return { ok: true, value: callIdx, timestamp: 0 };
      },
    });
    const svc = new DbMetricsService(db, pmm, makeRegistry(), makeMockMonitoring());
    const id = await insertInstance(db, 'cache', 'redis');
    const res = await svc.summaryFor(id);
    expect(res.replicationLagSeconds).toBeNull();
    expect(res.qps).toBeTypeOf('number');
    expect(res.connections).toBeTypeOf('number');
    expect(res.uptimeSeconds).toBeTypeOf('number');
    expect(res.pmmConfigured).toBe(true);
  });

  it('invalidate(id) drops the cache entry', async () => {
    let invocations = 0;
    const pmm = makeMockPmm({
      queryFn: async () => {
        invocations += 1;
        return { ok: true, value: 1, timestamp: 0 };
      },
    });
    const svc = new DbMetricsService(db, pmm, makeRegistry(), makeMockMonitoring());
    const id = await insertInstance(db, 'shop', 'mysql');
    await svc.summaryFor(id);
    svc.invalidate(id);
    await svc.summaryFor(id);
    expect(invocations).toBe(8); // both calls hit the network
  });
});
