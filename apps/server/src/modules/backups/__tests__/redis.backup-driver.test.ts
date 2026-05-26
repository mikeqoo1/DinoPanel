import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type Dockerode from 'dockerode';
import type { DbInstance } from '../../../database/schema';
import { RedisBackupDriver } from '../drivers/redis.backup-driver';
import { collect, frame, makeFakeContainer } from '../__fixtures__/dockerode-fakes';

function asContainer(c: ReturnType<typeof makeFakeContainer>): Dockerode.Container {
  return c as unknown as Dockerode.Container;
}

function makeInstance(dataDir: string): DbInstance {
  return {
    id: 4,
    name: 'cache',
    engine: 'redis',
    imageTag: 'redis:7.4-alpine',
    port: 49_030,
    username: 'default',
    password: 'redispw',
    dataDir,
    containerName: 'dinopanel-redis-cache',
    status: 'running',
    lastError: null,
    pmmRegistered: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('RedisBackupDriver.dump', () => {
  it('runs LASTSAVE → BGSAVE → LASTSAVE (incremented) → cat /data/dump.rdb', async () => {
    let lastsaveCallCount = 0;
    const fake = makeFakeContainer({
      dispatch: ({ Cmd }) => {
        if (Cmd[0] === 'redis-cli' && Cmd[1] === 'LASTSAVE') {
          lastsaveCallCount++;
          // Pre-save returns T=100; post-BGSAVE returns T=101 on the
          // very first poll so the loop returns without sleeping.
          const ts = lastsaveCallCount === 1 ? 100 : 101;
          return { output: [frame(1, `${ts}\n`)], exitCode: 0 };
        }
        if (Cmd[0] === 'redis-cli' && Cmd[1] === 'BGSAVE') {
          return { output: [frame(1, 'Background saving started\n')], exitCode: 0 };
        }
        if (Cmd[0] === 'cat' && Cmd[1] === '/data/dump.rdb') {
          return {
            output: [frame(1, Buffer.from([0x52, 0x45, 0x44, 0x49, 0x53]))], // "REDIS"
            exitCode: 0,
          };
        }
        return { output: [], exitCode: 1 };
      },
    });
    const driver = new RedisBackupDriver();
    const stream = await driver.dump({
      container: asContainer(fake),
      instance: makeInstance('/tmp/unused'),
    });
    const buf = await collect(stream);
    expect(buf.toString('utf8')).toBe('REDIS');
    // Sequence assertion: LASTSAVE (pre), BGSAVE, LASTSAVE (post=101), cat
    const cmds = fake.calls.map((c) => c.Cmd.join(' '));
    expect(cmds).toEqual([
      'redis-cli LASTSAVE',
      'redis-cli BGSAVE',
      'redis-cli LASTSAVE',
      'cat /data/dump.rdb',
    ]);
  });

  it('throws when BGSAVE fails (non-zero redis-cli exit)', async () => {
    const fake = makeFakeContainer({
      dispatch: ({ Cmd }) => {
        if (Cmd[1] === 'LASTSAVE') {
          return { output: [frame(1, '100\n')], exitCode: 0 };
        }
        if (Cmd[1] === 'BGSAVE') {
          return { output: [frame(2, 'ERR Background save already in progress')], exitCode: 1 };
        }
        return { output: [], exitCode: 1 };
      },
    });
    const driver = new RedisBackupDriver();
    await expect(
      driver.dump({
        container: asContainer(fake),
        instance: makeInstance('/tmp/unused'),
      }),
    ).rejects.toThrow(/BGSAVE/i);
  });
});

describe('RedisBackupDriver.restore', () => {
  it('stops container, writes dump.rdb (mode 0600), restarts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'redis-restore-'));
    const fake = makeFakeContainer({ scripts: [] });
    const driver = new RedisBackupDriver();
    const payload = Buffer.from('REDIS-RDB-PAYLOAD');
    await driver.restore({
      container: asContainer(fake),
      instance: makeInstance(dir),
      stream: Readable.from([payload]),
    });
    const written = readFileSync(join(dir, 'dump.rdb'));
    expect(written.equals(payload)).toBe(true);
    expect(fake.stop).toHaveBeenCalled();
    expect(fake.start).toHaveBeenCalled();
    // stop must precede start (call ordering)
    const stopOrder = fake.stop.mock.invocationCallOrder[0];
    const startOrder = fake.start.mock.invocationCallOrder[0];
    expect(stopOrder).toBeDefined();
    expect(startOrder).toBeDefined();
    expect(stopOrder!).toBeLessThan(startOrder!);
    // mode 0600 — bottom 9 bits
    const mode = statSync(join(dir, 'dump.rdb')).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('tolerates "container already stopped" (304) and proceeds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'redis-restore-stopped-'));
    const fake = makeFakeContainer({ scripts: [] });
    fake.stop.mockRejectedValueOnce(Object.assign(new Error('already stopped'), { statusCode: 304 }));
    const driver = new RedisBackupDriver();
    await driver.restore({
      container: asContainer(fake),
      instance: makeInstance(dir),
      stream: Readable.from([Buffer.from('payload')]),
    });
    expect(fake.start).toHaveBeenCalled();
  });
});
