import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Http01Challenger } from '../challengers/http01.challenger';
import {
  resolveWebsitesPaths,
  type WebsitesPaths,
} from '../../websites/paths';
import type { NginxService } from '../../websites/nginx.service';

function makeFakeNginx(paths: WebsitesPaths): NginxService {
  return {
    getPaths: () => paths,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as NginxService;
}

const fakeLogger = {
  debug: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

describe('Http01Challenger', () => {
  let tmp: string;
  let paths: WebsitesPaths;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'dp-http01-'));
    paths = resolveWebsitesPaths(tmp);
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('writes the keyAuthorization at .well-known/acme-challenge/<token>', async () => {
    const c = new Http01Challenger(makeFakeNginx(paths), fakeLogger);
    await c.create('abc-123_TOKEN', 'keyauth.thumb');
    const content = await fs.readFile(
      join(paths.acmeChallengeDir, 'abc-123_TOKEN'),
      'utf8',
    );
    expect(content).toBe('keyauth.thumb');
  });

  it('rejects malicious token (path traversal probe)', async () => {
    const c = new Http01Challenger(makeFakeNginx(paths), fakeLogger);
    await expect(c.create('../etc/passwd', 'x')).rejects.toThrow(/Invalid/);
    await expect(c.create('a/b', 'x')).rejects.toThrow(/Invalid/);
  });

  it('remove() unlinks the file and tolerates missing tokens', async () => {
    const c = new Http01Challenger(makeFakeNginx(paths), fakeLogger);
    await c.create('TOKEN', 'auth');
    await c.remove('TOKEN');
    await expect(
      fs.access(join(paths.acmeChallengeDir, 'TOKEN')),
    ).rejects.toThrow();
    // Idempotent re-remove
    await expect(c.remove('TOKEN')).resolves.toBeUndefined();
  });
});
