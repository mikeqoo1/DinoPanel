import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ShellTaskRunner } from '../runners/shell.runner';
import { BackupFilesTaskRunner } from '../runners/backup-files.runner';
import { CleanLogsTaskRunner } from '../runners/clean-logs.runner';
import { RestartServiceTaskRunner } from '../runners/restart-service.runner';
import { HttpRequestTaskRunner } from '../runners/http-request.runner';
import { PurgeTaskRunner } from '../runners/purge.runner';
import { SchedulerService } from '../scheduler.service';

const noopLogger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() };

// ---------------------------------------------------------------------------
// ShellTaskRunner
// ---------------------------------------------------------------------------

describe('ShellTaskRunner', () => {
  it('returns success when the command exits 0', async () => {
    const runner = new ShellTaskRunner();
    const result = await runner.run({ command: 'echo hi' });
    expect(result.status).toBe('success');
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('hi');
  });

  it('returns failed when the command exits non-zero', async () => {
    const runner = new ShellTaskRunner();
    const result = await runner.run({ command: 'exit 7' });
    expect(result.status).toBe('failed');
    expect(result.exitCode).toBe(7);
  });

  it('rejects invalid payload schema', async () => {
    const runner = new ShellTaskRunner();
    const result = await runner.run({ wrong: 'field' });
    expect(result.status).toBe('failed');
    expect(result.output).toContain('Invalid shell payload');
  });
});

// ---------------------------------------------------------------------------
// BackupFilesTaskRunner
// ---------------------------------------------------------------------------

describe('BackupFilesTaskRunner', () => {
  it('delegates to FilesService.compressToDisk and returns the dest path', async () => {
    const compressToDisk = vi.fn().mockResolvedValue(undefined);
    const runner = new BackupFilesTaskRunner({ compressToDisk } as never);
    const result = await runner.run({ sources: ['/etc/hostname'], targetDir: '/tmp' });
    expect(result.status).toBe('success');
    expect(compressToDisk).toHaveBeenCalledTimes(1);
    const [paths, dest, fmt] = compressToDisk.mock.calls[0]!;
    expect(paths).toEqual(['/etc/hostname']);
    expect(fmt).toBe('tar.gz');
    expect(dest).toMatch(/^\/tmp\/backup-.+\.tar\.gz$/);
  });

  it('returns failed when compressToDisk throws', async () => {
    const compressToDisk = vi.fn().mockRejectedValue(new Error('permission denied'));
    const runner = new BackupFilesTaskRunner({ compressToDisk } as never);
    const result = await runner.run({ sources: ['/etc/hostname'], targetDir: '/tmp' });
    expect(result.status).toBe('failed');
    expect(result.output).toContain('permission denied');
  });
});

// ---------------------------------------------------------------------------
// CleanLogsTaskRunner
// ---------------------------------------------------------------------------

describe('CleanLogsTaskRunner', () => {
  let work: string;
  const config = {
    get: vi.fn().mockReturnValue({ env: { DATA_DIR: '/var/lib/dinopanel' } }),
  };

  beforeEach(async () => {
    work = await fs.mkdtemp(join(tmpdir(), 'cleanlogs-'));
  });

  afterEach(async () => {
    await fs.rm(work, { recursive: true, force: true });
  });

  it('rejects paths outside the allowlist', () => {
    const runner = new CleanLogsTaskRunner(config as never);
    try {
      runner.assertPathAllowed('/home/mike/foo');
      throw new Error('expected to throw');
    } catch (err: unknown) {
      const response = (err as { getResponse?: () => unknown }).getResponse?.();
      expect((response as { code?: string } | undefined)?.code).toBe(
        'CLEAN_LOGS_PATH_NOT_ALLOWED',
      );
    }
  });

  it('accepts /var/log and /tmp prefixes', () => {
    const runner = new CleanLogsTaskRunner(config as never);
    expect(() => runner.assertPathAllowed('/var/log/syslog')).not.toThrow();
    expect(() => runner.assertPathAllowed('/tmp/anything')).not.toThrow();
  });

  it('deletes files older than the cutoff and leaves fresh ones alone', async () => {
    const old = join(work, 'old.log');
    const fresh = join(work, 'fresh.log');
    await fs.writeFile(old, 'old');
    await fs.writeFile(fresh, 'fresh');
    const twoDaysAgo = Date.now() - 2 * 86_400_000;
    await fs.utimes(old, twoDaysAgo / 1000, twoDaysAgo / 1000);
    // Allow the work dir by pointing DATA_DIR at the work parent
    const altConfig = {
      get: vi.fn().mockReturnValue({ env: { DATA_DIR: tmpdir() } }),
    };
    const runner = new CleanLogsTaskRunner(altConfig as never);
    const result = await runner.run({ path: work, olderThanDays: 1 });
    expect(result.status).toBe('success');
    expect(result.output).toContain('deleted=1');
    expect(await exists(old)).toBe(false);
    expect(await exists(fresh)).toBe(true);
  });
});

async function exists(p: string): Promise<boolean> {
  return fs
    .stat(p)
    .then(() => true)
    .catch(() => false);
}

// ---------------------------------------------------------------------------
// RestartServiceTaskRunner — only exercise payload validation; real
// `systemctl` is unavailable in CI.
// ---------------------------------------------------------------------------

describe('RestartServiceTaskRunner', () => {
  it('rejects unit names beginning with . or ..', async () => {
    const runner = new RestartServiceTaskRunner();
    const result = await runner.run({ unit: '..' });
    expect(result.status).toBe('failed');
    expect(result.output).toContain('Invalid restart_service payload');
  });
});

// ---------------------------------------------------------------------------
// HttpRequestTaskRunner — stub global fetch
// ---------------------------------------------------------------------------

describe('HttpRequestTaskRunner', () => {
  it('returns success on 2xx', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: () => Promise.resolve('pong'),
    }) as unknown as typeof fetch;
    try {
      const runner = new HttpRequestTaskRunner();
      const result = await runner.run({ url: 'https://example.com/ping', method: 'GET' });
      expect(result.status).toBe('success');
      expect(result.exitCode).toBe(200);
      expect(result.output).toContain('pong');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns failed on 4xx/5xx', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      text: () => Promise.resolve('upstream dead'),
    }) as unknown as typeof fetch;
    try {
      const runner = new HttpRequestTaskRunner();
      const result = await runner.run({ url: 'https://example.com/x', method: 'GET' });
      expect(result.status).toBe('failed');
      expect(result.exitCode).toBe(502);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ---------------------------------------------------------------------------
// PurgeTaskRunner — uses two select-then-delete cycles
// ---------------------------------------------------------------------------

describe('PurgeTaskRunner', () => {
  it('reports deleted count using before/after row counts', async () => {
    const settingsRead = {
      from: () => ({
        where: () => ({ limit: () => Promise.resolve([{ value: '14' }]) }),
      }),
    };
    const mockDb = {
      select: vi
        .fn()
        .mockImplementationOnce(() => settingsRead)
        .mockImplementationOnce(() => ({ from: () => Promise.resolve([{ n: 10 }]) }))
        .mockImplementationOnce(() => ({ from: () => Promise.resolve([{ n: 7 }]) })),
      delete: vi.fn(() => ({ where: () => Promise.resolve() })),
    };
    const runner = new PurgeTaskRunner(mockDb as never);
    const result = await runner.run({ table: 'operation_log' });
    expect(result.status).toBe('success');
    expect(result.output).toContain('retention=14d');
    expect(result.output).toContain('deleted=3');
    expect(result.output).toContain('kept=7');
  });
});

// ---------------------------------------------------------------------------
// SchedulerService cron helpers
// ---------------------------------------------------------------------------

describe('SchedulerService cron helpers', () => {
  it('validateCron accepts a real expression', () => {
    const service = makeService();
    expect(() => service.validateCron('15 3 * * *')).not.toThrow();
  });

  it('validateCron throws on a malformed expression', () => {
    const service = makeService();
    expect(() => service.validateCron('not a cron')).toThrow();
  });

  it('nextRunAt returns a future timestamp for valid expr, null for invalid', () => {
    const service = makeService();
    const next = service.nextRunAt('* * * * *');
    expect(next).not.toBeNull();
    expect(next!).toBeGreaterThan(Date.now() - 60_000);
    expect(service.nextRunAt('nope')).toBeNull();
  });
});

function makeService(): SchedulerService {
  return new SchedulerService(
    {} as never,
    noopLogger as never,
    new ShellTaskRunner(),
    new BackupFilesTaskRunner({ compressToDisk: vi.fn() } as never),
    new CleanLogsTaskRunner({ get: vi.fn() } as never),
    new RestartServiceTaskRunner(),
    new HttpRequestTaskRunner(),
    new PurgeTaskRunner({} as never),
  );
}
