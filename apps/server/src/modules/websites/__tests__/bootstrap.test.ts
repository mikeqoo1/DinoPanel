import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveWebsitesPaths } from '../paths';
import { WebsitesService } from '../websites.service';
import type { NginxService } from '../nginx.service';

/**
 * Construct a WebsitesService bound to a tmp root, with all the
 * injected dependencies stubbed. Phase 1 bootstrap only touches the
 * filesystem and `settings`; the DB is mocked with the smallest
 * surface that `clearDegradedFlag` / `persistDegradedFlag` need.
 */
function makeService(opts: {
  root: string;
  includePath: string;
  /** If true, `persistDegradedFlag`'s DB write rejects (still must not crash). */
  failDbWrite?: boolean;
}): {
  service: WebsitesService;
  recordedSettings: Map<string, string>;
} {
  const recordedSettings = new Map<string, string>();
  const stubDb = {
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () =>
          opts.failDbWrite
            ? Promise.reject(new Error('db down'))
            : Promise.resolve(),
      }),
    }),
    delete: () => ({
      where: () => Promise.resolve(),
    }),
  } as unknown;
  const stubConfig = {
    get: () => ({
      env: {
        WEBSITES_ROOT: opts.root,
        WEBSITES_NGINX_INCLUDE_PATH: opts.includePath,
        WEBSITES_REQUIRE_SUDO: false,
      },
    }),
  } as unknown as ConstructorParameters<typeof WebsitesService>[1];
  const stubLogger = {
    debug: () => undefined,
    error: () => undefined,
    warn: () => undefined,
    info: () => undefined,
  } as unknown as ConstructorParameters<typeof WebsitesService>[2];
  const stubNginx = {} as NginxService;
  const service = new WebsitesService(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stubDb as any,
    stubConfig,
    stubLogger,
    stubNginx,
  );
  return { service, recordedSettings };
}

describe('WebsitesService bootstrap — directories', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'dp-websites-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('creates every directory listed in resolveWebsitesPaths, idempotently', async () => {
    const root = join(tmp, 'root');
    const include = join(tmp, 'nginx-include.conf');
    const { service } = makeService({ root, includePath: include });

    await service.ensureDirectories();
    await service.ensureDirectories(); // idempotent second run

    const paths = resolveWebsitesPaths(root);
    await expect(fs.stat(paths.sitesDir)).resolves.toBeDefined();
    await expect(fs.stat(paths.nginxConfDir)).resolves.toBeDefined();
    await expect(fs.stat(paths.acmeDir)).resolves.toBeDefined();
    await expect(fs.stat(paths.acmeCertsDir)).resolves.toBeDefined();
    await expect(fs.stat(paths.acmeChallengeDir)).resolves.toBeDefined();
  });

  it('writes the nginx include glue file with the expected content', async () => {
    const root = join(tmp, 'root');
    const include = join(tmp, 'nginx', '00-dinopanel.conf');
    const { service } = makeService({ root, includePath: include });

    await service.ensureNginxInclude();
    const written = await fs.readFile(include, 'utf8');
    const paths = resolveWebsitesPaths(root);
    expect(written).toContain(`include ${paths.nginxConfDir}/*.conf;`);
    expect(written).toContain('Managed by DinoPanel');
  });

  it('marks degraded and does not crash when bootstrap step fails', async () => {
    // Force failure by pointing the include path at a location that
    // cannot be created (under /proc which is read-only on Linux).
    // On macOS / sandboxes that allow this, fall back to a path with a
    // file blocking the parent directory.
    const root = join(tmp, 'root');
    const blockFile = join(tmp, 'blocker');
    await fs.writeFile(blockFile, '');
    // includePath now expects 'blocker' to be a directory — write will EEXIST
    const include = join(blockFile, '00-dinopanel.conf');
    const { service } = makeService({ root, includePath: include });

    await service.onApplicationBootstrap();

    const status = service.getStatus();
    expect(status.degraded).toBe(true);
    expect(status.reason).toBeTruthy();
  });
});
