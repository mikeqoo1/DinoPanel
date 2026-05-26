import { Injectable, Logger } from '@nestjs/common';
import { createWriteStream } from 'node:fs';
import { chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type Dockerode from 'dockerode';
import type { DbInstance } from '../../../database/schema';
import type { BackupDriver } from '../backup-driver';
import {
  bufferingExec,
  streamingDumpExec,
  type ExecError,
} from '../exec-stream';

const LASTSAVE_POLL_INTERVAL_MS = 500;
const LASTSAVE_POLL_TIMEOUT_MS = 5 * 60 * 1000;

const RDB_CONTAINER_PATH = '/data/dump.rdb';
const RDB_HOST_FILENAME = 'dump.rdb';

/**
 * Redis backup driver — the only engine without a streaming dump.
 *
 * Dump sequence (decisions.md D6 + spec.md):
 *   1. `redis-cli LASTSAVE` — capture pre-save timestamp
 *   2. `redis-cli BGSAVE` — kick off background save (returns
 *      immediately, the actual save runs async inside redis)
 *   3. poll `LASTSAVE` until it increments past the pre-save value,
 *      bounded by `LASTSAVE_POLL_TIMEOUT_MS`
 *   4. `cat /data/dump.rdb` — stream the RDB out via docker exec
 *
 * Restore sequence (D4 restore-in-place + this is the only engine
 * that needs a brief downtime — the v0.5 UI surfaces this in the
 * confirm modal):
 *   1. `container.stop()`
 *   2. write the (already-gunzipped) RDB stream to
 *      `<instance.dataDir>/dump.rdb` on the host bind-mount, mode 0600
 *   3. `container.start()` — redis loads dump.rdb at startup
 *
 * Auth: container baked `REDISCLI_AUTH` env at create-time (v0.4
 * RedisDriver), so every redis-cli exec inherits it.
 */
@Injectable()
export class RedisBackupDriver implements BackupDriver {
  private readonly logger = new Logger(RedisBackupDriver.name);

  readonly engine = 'redis' as const;
  readonly alreadyGzipped = false;
  // RDB is binary; file ends up as `<ts>-<source>.rdb.gz` on disk.
  readonly extension = 'rdb';

  async dump(args: {
    container: Dockerode.Container;
    instance: DbInstance;
  }): Promise<NodeJS.ReadableStream> {
    const preSave = await this.readLastsave(args.container);
    await this.runRedisCli(args.container, ['BGSAVE']);
    await this.waitForSave(args.container, preSave);
    return streamingDumpExec({
      container: args.container,
      cmd: ['cat', RDB_CONTAINER_PATH],
    });
  }

  async restore(args: {
    container: Dockerode.Container;
    instance: DbInstance;
    stream: NodeJS.ReadableStream;
  }): Promise<void> {
    try {
      await args.container.stop({ t: 10 });
    } catch (err) {
      // Container already stopped is fine — only re-throw on a hard
      // dockerode failure. dockerode surfaces 304 for "already stopped".
      const status = (err as { statusCode?: number } | null)?.statusCode;
      if (status !== 304) throw err;
    }

    const hostFile = join(args.instance.dataDir, RDB_HOST_FILENAME);
    const sink = createWriteStream(hostFile, { mode: 0o600 });
    await pipeline(args.stream, sink);
    await chmod(hostFile, 0o600);

    await args.container.start();
    this.logger.log(
      `redis restore: wrote ${hostFile} and restarted ${args.instance.containerName}`,
    );
  }

  // ---------------------------------------------------------------------

  private async readLastsave(container: Dockerode.Container): Promise<number> {
    const { stdout } = await this.runRedisCli(container, ['LASTSAVE']);
    const ts = Number.parseInt(stdout.trim(), 10);
    if (!Number.isFinite(ts)) {
      throw new Error(`redis LASTSAVE returned non-numeric output: ${stdout}`);
    }
    return ts;
  }

  private async waitForSave(
    container: Dockerode.Container,
    pre: number,
  ): Promise<void> {
    const deadline = Date.now() + LASTSAVE_POLL_TIMEOUT_MS;
    // Poll-first ordering: a tiny DB can finish BGSAVE before the
    // first sleep would tick, in which case the loop returns
    // immediately. Tests use this to avoid sleeping at all.
    while (Date.now() < deadline) {
      const now = await this.readLastsave(container);
      if (now > pre) return;
      await sleep(LASTSAVE_POLL_INTERVAL_MS);
    }
    throw new Error(
      `redis BGSAVE did not finish within ${LASTSAVE_POLL_TIMEOUT_MS}ms`,
    );
  }

  private async runRedisCli(
    container: Dockerode.Container,
    args: string[],
  ): Promise<{ stdout: string }> {
    try {
      return await bufferingExec({
        container,
        cmd: ['redis-cli', ...args],
      });
    } catch (err) {
      const stderr = (err as ExecError).stderr ?? '';
      throw new Error(
        `redis-cli ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}`,
        { cause: err instanceof Error ? err : new Error(String(err)) },
      );
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
