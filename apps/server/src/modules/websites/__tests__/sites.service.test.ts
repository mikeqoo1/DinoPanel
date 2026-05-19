import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../database/schema';
import { resolveWebsitesPaths, type WebsitesPaths } from '../paths';
import { SitesService } from '../sites.service';
import { NginxCommandError, type NginxService } from '../nginx.service';
import type { SiteCreate } from '@dinopanel/shared';

type Db = BetterSQLite3Database<typeof schema>;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function setupDb(): Db {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(`
    CREATE TABLE sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      primary_domain TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      managed_by_dinopanel INTEGER NOT NULL DEFAULT 1,
      orphaned INTEGER NOT NULL DEFAULT 0,
      cert_paths TEXT,
      cert_expires_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  return drizzle(sqlite, { schema });
}

interface FakeNginxOptions {
  paths: WebsitesPaths;
  validate?: () => Promise<void>;
  reload?: () => Promise<void>;
}

function makeFakeNginx(opts: FakeNginxOptions): NginxService {
  return {
    getPaths: () => opts.paths,
    siteRoot: (name: string) => join(opts.paths.sitesDir, name),
    siteConfPath: (name: string) =>
      join(opts.paths.nginxConfDir, `${name}.conf`),
    acmeRoot: () => opts.paths.acmeDir,
    acmeCertDir: (id: number) => join(opts.paths.acmeCertsDir, String(id)),
    validate: opts.validate ?? (() => Promise.resolve()),
    reload: opts.reload ?? (() => Promise.resolve()),
    probeSudo: () => Promise.resolve(true),
    isSudoOk: () => true,
    onApplicationBootstrap: () => Promise.resolve(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as NginxService;
}

function makeService(
  db: Db,
  nginx: NginxService,
): { service: SitesService; reloadCount: { n: number } } {
  const reloadCount = { n: 0 };
  const wrapped = makeFakeNginx({
    paths: nginx.getPaths(),
    validate: () => nginx.validate(),
    reload: async () => {
      reloadCount.n++;
      return nginx.reload();
    },
  });
  const logger = {
    debug: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    trace: () => undefined,
    fatal: () => undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return {
    service: new SitesService(db, wrapped, logger),
    reloadCount,
  };
}

const staticCreate: SiteCreate = {
  name: 'blog',
  primaryDomain: 'blog.example.com',
  payload: {
    type: 'static',
    indexFiles: ['index.html', 'index.htm'],
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SitesService', () => {
  let tmp: string;
  let paths: WebsitesPaths;
  let db: Db;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'dp-sites-'));
    paths = resolveWebsitesPaths(tmp);
    await fs.mkdir(paths.nginxConfDir, { recursive: true });
    await fs.mkdir(paths.sitesDir, { recursive: true });
    await fs.mkdir(paths.acmeDir, { recursive: true });
    db = setupDb();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('create() — happy path: writes conf, validates, reloads, inserts row', async () => {
    const nginx = makeFakeNginx({ paths });
    const { service, reloadCount } = makeService(db, nginx);

    const result = await service.create(staticCreate);
    expect(result.id).toBeGreaterThan(0);
    expect(result.name).toBe('blog');
    expect(result.primaryDomain).toBe('blog.example.com');
    expect(result.type).toBe('static');
    expect(result.managedByDinopanel).toBe(true);
    expect(result.orphaned).toBe(false);

    const written = await fs.readFile(
      join(paths.nginxConfDir, 'blog.conf'),
      'utf8',
    );
    expect(written).toContain('server_name blog.example.com;');
    expect(written).toContain(`root ${join(paths.sitesDir, 'blog')}/public;`);

    // public dir auto-created for static type
    const pubStat = await fs.stat(join(paths.sitesDir, 'blog', 'public'));
    expect(pubStat.isDirectory()).toBe(true);

    expect(reloadCount.n).toBe(1);
  });

  it('create() — duplicate name throws SITE_NAME_TAKEN', async () => {
    const nginx = makeFakeNginx({ paths });
    const { service } = makeService(db, nginx);

    await service.create(staticCreate);
    await expect(service.create(staticCreate)).rejects.toMatchObject({
      response: { code: 'SITE_NAME_TAKEN' },
    });
  });

  it('create() — validate failure: rolls back conf file, no DB row inserted', async () => {
    let calls = 0;
    const nginx = makeFakeNginx({
      paths,
      validate: () => {
        calls++;
        return Promise.reject(
          new NginxCommandError(
            'NGINX_VALIDATE_FAILED',
            'nginx -t failed',
            'test stderr',
          ),
        );
      },
    });
    const { service } = makeService(db, nginx);

    await expect(service.create(staticCreate)).rejects.toMatchObject({
      response: { code: 'SITE_CONF_INVALID' },
    });
    expect(calls).toBe(1);

    // Conf file removed (no previous version → unlink path)
    await expect(
      fs.access(join(paths.nginxConfDir, 'blog.conf')),
    ).rejects.toThrow();

    // No DB row
    const rows = await db.select().from(schema.sites);
    expect(rows).toHaveLength(0);
  });

  it('update() — happy path: rewrites conf and updates row', async () => {
    const nginx = makeFakeNginx({ paths });
    const { service, reloadCount } = makeService(db, nginx);

    const created = await service.create(staticCreate);
    expect(reloadCount.n).toBe(1);

    const updated = await service.update(created.id, {
      primaryDomain: 'www.example.com',
    });
    expect(updated.primaryDomain).toBe('www.example.com');

    const written = await fs.readFile(
      join(paths.nginxConfDir, 'blog.conf'),
      'utf8',
    );
    expect(written).toContain('server_name www.example.com;');
    expect(reloadCount.n).toBe(2);
  });

  it('update() — validate failure: restores backup, original conf intact', async () => {
    let validateBehavior: 'ok' | 'fail' = 'ok';
    const nginx = makeFakeNginx({
      paths,
      validate: () =>
        validateBehavior === 'ok'
          ? Promise.resolve()
          : Promise.reject(
              new NginxCommandError(
                'NGINX_VALIDATE_FAILED',
                'fail',
                'fail stderr',
              ),
            ),
    });
    const { service } = makeService(db, nginx);

    const created = await service.create(staticCreate);
    const originalConf = await fs.readFile(
      join(paths.nginxConfDir, 'blog.conf'),
      'utf8',
    );

    validateBehavior = 'fail';
    await expect(
      service.update(created.id, { primaryDomain: 'broken.example.com' }),
    ).rejects.toMatchObject({ response: { code: 'SITE_CONF_INVALID' } });

    // Backup was restored — file content matches original
    const afterFail = await fs.readFile(
      join(paths.nginxConfDir, 'blog.conf'),
      'utf8',
    );
    expect(afterFail).toBe(originalConf);
    expect(afterFail).toContain('server_name blog.example.com;');

    // DB row still reflects the original
    const reread = await service.getById(created.id);
    expect(reread.primaryDomain).toBe('blog.example.com');
  });

  it('remove() — deletes conf + reloads + drops DB row', async () => {
    const nginx = makeFakeNginx({ paths });
    const { service, reloadCount } = makeService(db, nginx);

    const created = await service.create(staticCreate);
    expect(reloadCount.n).toBe(1);

    await service.remove(created.id);
    await expect(
      fs.access(join(paths.nginxConfDir, 'blog.conf')),
    ).rejects.toThrow();

    const rows = await db.select().from(schema.sites);
    expect(rows).toHaveLength(0);
    expect(reloadCount.n).toBe(2);
  });
});
