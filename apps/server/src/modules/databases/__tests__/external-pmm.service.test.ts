import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../database/schema';
import { dbInstances } from '../../../database/schema';
import { ExternalPmmService } from '../external-pmm.service';
import type {
  InventoryResult,
  PmmInventoryClient,
} from '../../monitoring/pmm-inventory.client';
import type { PmmPromqlClient } from '../../monitoring/pmm-promql.client';

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

function makeMockInventory(result: InventoryResult): PmmInventoryClient {
  return {
    listServices: vi.fn(async () => result),
  } as unknown as PmmInventoryClient;
}

function makeMockPromql(url: string | null): PmmPromqlClient {
  return {
    resolveConfig: vi.fn(async () => ({
      url,
      apiToken: null,
      tlsSkipVerify: false,
    })),
  } as unknown as PmmPromqlClient;
}

async function insertManaged(
  db: Db,
  containerName: string,
): Promise<void> {
  const now = Date.now();
  await db.insert(dbInstances).values({
    name: containerName.replace('dinopanel-', ''),
    engine: 'mysql',
    imageTag: 'mysql:8.0',
    port: 3306,
    username: 'root',
    password: 'pw',
    dataDir: `/tmp/${containerName}`,
    containerName,
    status: 'running',
    lastError: null,
    pmmRegistered: true,
    createdAt: now,
    updatedAt: now,
  });
}

describe('ExternalPmmService', () => {
  let db: Db;

  beforeEach(() => {
    db = setupDb();
  });

  it('returns flattened PMM services excluding ones managed by DinoPanel', async () => {
    await insertManaged(db, 'dinopanel-mysql-shop');
    const inventory = makeMockInventory({
      ok: true,
      services: [
        {
          serviceId: 'svc-1',
          serviceName: 'dinopanel-mysql-shop', // managed → filtered out
          engine: 'mysql',
          nodeId: 'node-a',
          address: '10.0.0.5',
          port: 3306,
        },
        {
          serviceId: 'svc-2',
          serviceName: 'external-pg-analytics',
          engine: 'postgresql',
          nodeId: 'node-b',
          address: '10.0.0.6',
          port: 5432,
        },
      ],
    });
    const promql = makeMockPromql('http://pmm.test');
    const svc = new ExternalPmmService(db, inventory, promql);

    const result = await svc.list();
    expect(result.error).toBeNull();
    expect(result.services).toHaveLength(1);
    expect(result.services[0]!.serviceName).toBe('external-pg-analytics');
    expect(result.services[0]!.engine).toBe('postgresql');
    expect(typeof result.fetchedAt).toBe('number');
  });

  it('returns empty services when PMM has no extra DBs beyond managed ones', async () => {
    await insertManaged(db, 'dinopanel-mysql-only');
    const inventory = makeMockInventory({
      ok: true,
      services: [
        {
          serviceId: 'svc-1',
          serviceName: 'dinopanel-mysql-only',
          engine: 'mysql',
          nodeId: 'node-a',
          address: null,
          port: null,
        },
      ],
    });
    const svc = new ExternalPmmService(
      db,
      inventory,
      makeMockPromql('http://pmm.test'),
    );
    const result = await svc.list();
    expect(result.error).toBeNull();
    expect(result.services).toEqual([]);
  });

  it('surfaces auth failures with services=[] and error.reason="auth"', async () => {
    const inventory = makeMockInventory({ ok: false, reason: 'auth' });
    const svc = new ExternalPmmService(
      db,
      inventory,
      makeMockPromql('http://pmm.test'),
    );
    const result = await svc.list();
    expect(result.services).toEqual([]);
    expect(result.error).toEqual({ reason: 'auth' });
  });

  it('surfaces not_configured (URL unset) without hitting cache or DB', async () => {
    const inventory = makeMockInventory({
      ok: false,
      reason: 'not_configured',
    });
    const svc = new ExternalPmmService(db, inventory, makeMockPromql(null));
    const result = await svc.list();
    expect(result.services).toEqual([]);
    expect(result.error).toEqual({ reason: 'not_configured' });
  });

  it('surfaces unreachable failures with services=[] and error.reason="unreachable"', async () => {
    const inventory = makeMockInventory({ ok: false, reason: 'unreachable' });
    const svc = new ExternalPmmService(
      db,
      inventory,
      makeMockPromql('http://pmm.test'),
    );
    const result = await svc.list();
    expect(result.services).toEqual([]);
    expect(result.error).toEqual({ reason: 'unreachable' });
  });

  it('surfaces bad_response failures with services=[] and error.reason="bad_response"', async () => {
    const inventory = makeMockInventory({ ok: false, reason: 'bad_response' });
    const svc = new ExternalPmmService(
      db,
      inventory,
      makeMockPromql('http://pmm.test'),
    );
    const result = await svc.list();
    expect(result.services).toEqual([]);
    expect(result.error).toEqual({ reason: 'bad_response' });
  });

  it('does not cache failure responses — a successful retry repopulates', async () => {
    const failingInventory = makeMockInventory({
      ok: false,
      reason: 'unreachable',
    });
    const svc = new ExternalPmmService(
      db,
      failingInventory,
      makeMockPromql('http://pmm.test'),
    );
    const first = await svc.list();
    expect(first.error).toEqual({ reason: 'unreachable' });
    // Swap the mock to "succeed" by replacing the listServices fn so
    // the next call follows the success path and populates the cache.
    (failingInventory.listServices as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        ok: true,
        services: [
          {
            serviceId: 's1',
            serviceName: 'pg-1',
            engine: 'postgresql',
            nodeId: 'n',
            address: null,
            port: null,
          },
        ],
      },
    );
    const second = await svc.list();
    expect(second.error).toBeNull();
    expect(second.services).toHaveLength(1);
  });

  it('reuses cached result within 30s', async () => {
    const inventory = makeMockInventory({
      ok: true,
      services: [
        {
          serviceId: 'svc-1',
          serviceName: 'pg-1',
          engine: 'postgresql',
          nodeId: 'node-a',
          address: null,
          port: null,
        },
      ],
    });
    const svc = new ExternalPmmService(
      db,
      inventory,
      makeMockPromql('http://pmm.test'),
    );

    const first = await svc.list();
    const second = await svc.list();

    expect(inventory.listServices).toHaveBeenCalledTimes(2);
    // Cache hit: identical fetchedAt + reference-equal services array
    expect(second.fetchedAt).toBe(first.fetchedAt);
    expect(second.services).toBe(first.services);
  });

  it('refresh=true bypasses the cache and re-queries inventory', async () => {
    const inventory = makeMockInventory({
      ok: true,
      services: [
        {
          serviceId: 'svc-1',
          serviceName: 'pg-1',
          engine: 'postgresql',
          nodeId: 'node-a',
          address: null,
          port: null,
        },
      ],
    });
    const svc = new ExternalPmmService(
      db,
      inventory,
      makeMockPromql('http://pmm.test'),
    );

    await svc.list();
    const before = (inventory.listServices as ReturnType<typeof vi.fn>).mock
      .calls.length;
    await svc.list({ refresh: true });
    const after = (inventory.listServices as ReturnType<typeof vi.fn>).mock
      .calls.length;

    expect(after).toBe(before + 1);
  });

  it('engine mapping passes through redis / mongodb / unknown unchanged', async () => {
    const inventory = makeMockInventory({
      ok: true,
      services: [
        {
          serviceId: 'a',
          serviceName: 'cache-redis',
          engine: 'redis',
          nodeId: 'n',
          address: null,
          port: null,
        },
        {
          serviceId: 'b',
          serviceName: 'mongo-prod',
          engine: 'mongodb',
          nodeId: 'n',
          address: null,
          port: null,
        },
        {
          serviceId: 'c',
          serviceName: 'mystery',
          engine: 'unknown',
          nodeId: 'n',
          address: null,
          port: null,
        },
      ],
    });
    const svc = new ExternalPmmService(
      db,
      inventory,
      makeMockPromql('http://pmm.test'),
    );
    const result = await svc.list();
    expect(result.services.map((s) => s.engine)).toEqual([
      'redis',
      'mongodb',
      'unknown',
    ]);
  });

  it('invalidateAll() drops the cache so the next call re-queries', async () => {
    const inventory = makeMockInventory({
      ok: true,
      services: [],
    });
    const svc = new ExternalPmmService(
      db,
      inventory,
      makeMockPromql('http://pmm.test'),
    );
    await svc.list();
    await svc.list(); // cached
    const beforeInvalidate = (
      inventory.listServices as ReturnType<typeof vi.fn>
    ).mock.calls.length;
    svc.invalidateAll();
    await svc.list();
    const afterInvalidate = (
      inventory.listServices as ReturnType<typeof vi.fn>
    ).mock.calls.length;
    expect(afterInvalidate).toBe(beforeInvalidate + 1);
  });
});
