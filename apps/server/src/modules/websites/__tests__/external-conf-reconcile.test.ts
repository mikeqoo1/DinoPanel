import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../database/schema';
import { SitesService } from '../sites.service';
import {
  extractServerName,
  isUnderTree,
} from '../sites.service';
import type { WebsitesPaths } from '../paths';
import { resolveWebsitesPaths } from '../paths';
import type { NginxService } from '../nginx.service';

// Phase 4.1 — external-conf reconcile tests.

type Db = BetterSQLite3Database<typeof schema>;

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

function makeService(db: Db, paths: WebsitesPaths, hostDir: string): SitesService {
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
        HOST_NGINX_CONFD_DIR: hostDir,
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

describe('SitesService — external-conf reconcile', () => {
  let tmp: string;
  let paths: WebsitesPaths;
  let hostDir: string;
  let db: Db;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'dp-extconf-'));
    paths = resolveWebsitesPaths(join(tmp, 'opt-dinopanel'));
    hostDir = join(tmp, 'etc-nginx-confd');
    await fs.mkdir(paths.nginxConfDir, { recursive: true });
    await fs.mkdir(paths.sitesDir, { recursive: true });
    await fs.mkdir(paths.acmeDir, { recursive: true });
    await fs.mkdir(hostDir, { recursive: true });
    db = setupDb();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('imports an external conf as managed_by_dinopanel=false with externalConfPath set', async () => {
    await fs.writeFile(
      join(hostDir, 'legacy.conf'),
      'server {\n  listen 80;\n  server_name legacy.example.com;\n}\n',
    );
    const service = makeService(db, paths, hostDir);
    const result = await service.reconcile();
    expect(result.imported).toBe(1);
    expect(result.external).toBe(1);
    const rows = await db.select().from(schema.sites);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.managedByDinopanel).toBe(false);
    expect(rows[0]!.externalConfPath).toBe(join(hostDir, 'legacy.conf'));
    expect(rows[0]!.primaryDomain).toBe('legacy.example.com');
  });

  it('skips the v0.3 glue file 00-dinopanel.conf (not a server block)', async () => {
    // Create the glue file under the host dir. Service treats any
    // path that resolves to WEBSITES_NGINX_INCLUDE_PATH as the
    // managed glue and skips it.
    const gluePath = join(hostDir, '00-dinopanel.conf');
    await fs.writeFile(
      gluePath,
      `include ${paths.nginxConfDir}/*.conf;\n`,
    );
    // Point the include env at this exact file so the realpath check
    // matches. We rebuild a service with adjusted include path.
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
          HOST_NGINX_CONFD_DIR: hostDir,
          WEBSITES_ROOT: paths.root,
          WEBSITES_NGINX_INCLUDE_PATH: gluePath,
        },
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const phpFpm = {
      getUpstream: () => 'unix:/run/php-fpm/test.sock',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const service = new SitesService(db, config, makeFakeNginx(paths), phpFpm, logger);
    const result = await service.reconcile();
    expect(result.imported).toBe(0);
    const rows = await db.select().from(schema.sites);
    expect(rows).toHaveLength(0);
  });

  it('skips symlinks whose realpath resolves under the managed tree', async () => {
    // Create a real conf inside the managed tree.
    const realPath = join(paths.nginxConfDir, 'managed.conf');
    await fs.writeFile(
      realPath,
      'server { listen 80; server_name managed.example.com; }\n',
    );
    // Symlink it from /etc/nginx/conf.d → realpath resolves under
    // /opt/dinopanel/, reconcile must skip.
    symlinkSync(realPath, join(hostDir, 'shadow.conf'));
    const service = makeService(db, paths, hostDir);
    const result = await service.reconcile();
    expect(result.imported).toBe(0);
    const rows = await db.select().from(schema.sites);
    // The managed dir's `managed.conf` doesn't auto-import either
    // (managed-tree extras aren't imported, only /etc/nginx/conf.d
    // entries are). So 0 rows.
    expect(rows).toHaveLength(0);
  });

  it('flags server_name conflicts across two external files', async () => {
    await fs.writeFile(
      join(hostDir, 'a.conf'),
      'server { listen 80; server_name dup.example.com; }\n',
    );
    await fs.writeFile(
      join(hostDir, 'b.conf'),
      'server { listen 8080; server_name dup.example.com; }\n',
    );
    const service = makeService(db, paths, hostDir);
    const result = await service.reconcile();
    expect(result.serverNameConflicts).toContain('dup.example.com');
    // Both still get imported as separate rows under their own
    // basenames; conflict surfaces is informational.
    expect(result.imported).toBe(2);
  });
});

describe('extractServerName helper', () => {
  it('extracts the first non-wildcard hostname', () => {
    expect(
      extractServerName(
        '# comment\nserver {\n  server_name foo.example.com bar.example.com;\n}\n',
      ),
    ).toBe('foo.example.com');
  });

  it('falls back to the first token when only wildcards present', () => {
    expect(
      extractServerName(
        'server { server_name *.example.com; }\n',
      ),
    ).toBe('*.example.com');
  });

  it('returns null when no server_name directive exists', () => {
    expect(extractServerName('upstream foo { server 127.0.0.1; }\n')).toBeNull();
  });
});

describe('isUnderTree helper', () => {
  it('detects exact match and descendants, not sibling paths', () => {
    expect(isUnderTree('/opt/dinopanel', '/opt/dinopanel')).toBe(true);
    expect(isUnderTree('/opt/dinopanel/sites/x', '/opt/dinopanel')).toBe(true);
    expect(isUnderTree('/opt/dinopanel-other', '/opt/dinopanel')).toBe(false);
  });
});
