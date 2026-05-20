import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../database/schema';
import { resolveWebsitesPaths, type WebsitesPaths } from '../paths';
import { SitesService } from '../sites.service';
import type { NginxService } from '../nginx.service';
import type { SiteCreate } from '@dinopanel/shared';

type Db = BetterSQLite3Database<typeof schema>;

function setupDb(): Db {
  const sqlite = new Database(':memory:');
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

function makeFakeNginx(paths: WebsitesPaths): NginxService {
  return {
    getPaths: () => paths,
    siteRoot: (name: string) => join(paths.sitesDir, name),
    siteConfPath: (name: string) => join(paths.nginxConfDir, `${name}.conf`),
    acmeRoot: () => paths.acmeDir,
    acmeCertDir: (id: number) => join(paths.acmeCertsDir, String(id)),
    validate: () => Promise.resolve(),
    reload: () => Promise.resolve(),
    probeSudo: () => Promise.resolve(true),
    isSudoOk: () => true,
    onApplicationBootstrap: () => Promise.resolve(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as NginxService;
}

function makeService(
  db: Db,
  paths: WebsitesPaths,
  overrides: { hostNginxConfdDir?: string } = {},
): SitesService {
  const logger = {
    debug: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    trace: () => undefined,
    fatal: () => undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  const config = {
    get: () => ({
      env: {
        PHP_FPM_SOCKET_PATH: '/run/php-fpm/test.sock',
        HOST_NGINX_CONFD_DIR: overrides.hostNginxConfdDir ?? '/etc/nginx/conf.d',
        WEBSITES_ROOT: paths.root,
        WEBSITES_NGINX_INCLUDE_PATH: '/etc/nginx/conf.d/00-dinopanel.conf',
      },
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  const phpFpm = {
    getUpstream: () => 'unix:/run/php-fpm/test.sock',
    ensureRunning: () => Promise.resolve(),
    scheduleIdleStop: () => Promise.resolve(),
    isExternalMode: () => true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return new SitesService(db, config, makeFakeNginx(paths), phpFpm, logger);
}

const sampleCreate: SiteCreate = {
  name: 'blog',
  primaryDomain: 'blog.example.com',
  payload: { type: 'static', indexFiles: ['index.html'] },
};

describe('SitesService.reconcile', () => {
  let tmp: string;
  let paths: WebsitesPaths;
  let db: Db;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'dp-reconcile-'));
    paths = resolveWebsitesPaths(tmp);
    await fs.mkdir(paths.nginxConfDir, { recursive: true });
    await fs.mkdir(paths.sitesDir, { recursive: true });
    await fs.mkdir(paths.acmeDir, { recursive: true });
    db = setupDb();
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('empty conf dir + empty DB returns all zeros', async () => {
    const service = makeService(db, paths, {
      hostNginxConfdDir: join(tmp, 'no-such-dir'),
    });
    const result = await service.reconcile();
    expect(result).toMatchObject({
      scanned: 0,
      imported: 0,
      orphaned: 0,
      external: 0,
      serverNameConflicts: [],
    });
  });

  it('files match DB rows: no orphans, no imports', async () => {
    const service = makeService(db, paths, {
      hostNginxConfdDir: join(tmp, 'no-such-dir'),
    });
    await service.create(sampleCreate);
    const result = await service.reconcile();
    expect(result).toMatchObject({
      scanned: 1,
      imported: 0,
      orphaned: 0,
      external: 0,
    });
    const row = (await db.select().from(schema.sites))[0]!;
    expect(row.orphaned).toBe(false);
  });

  it('DB row whose file is missing gets marked orphaned', async () => {
    const service = makeService(db, paths, {
      hostNginxConfdDir: join(tmp, 'no-such-dir'),
    });
    const created = await service.create(sampleCreate);

    // Operator yanks the conf file out from under DinoPanel
    await fs.unlink(join(paths.nginxConfDir, 'blog.conf'));

    const result = await service.reconcile();
    expect(result.orphaned).toBe(1);
    expect(result.scanned).toBe(0);

    const rows = await db.select().from(schema.sites);
    expect(rows[0]!.orphaned).toBe(true);
    expect(rows[0]!.id).toBe(created.id);
  });

  it('legacy: conf file inside managed dir with no DB row is logged but NOT imported', async () => {
    const service = makeService(db, paths, {
      hostNginxConfdDir: join(tmp, 'no-such-dir'),
    });

    // Operator dropped a hand-rolled conf with no DinoPanel involvement
    await fs.writeFile(
      join(paths.nginxConfDir, 'legacy.conf'),
      'server { listen 80; server_name legacy.example.com; }\n',
    );

    const result = await service.reconcile();
    expect(result.scanned).toBe(1);
    expect(result.imported).toBe(0); // managed-tree extras are not imported (only /etc/nginx/conf.d external)
    expect(result.orphaned).toBe(0);

    const rows = await db.select().from(schema.sites);
    expect(rows).toHaveLength(0); // truly didn't import
  });
});
