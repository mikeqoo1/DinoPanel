import { Injectable, Logger } from '@nestjs/common';
import { createWriteStream } from 'node:fs';
import { chmod, rename, unlink } from 'node:fs/promises';
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
const LASTSAVE_POLL_TIMEOUT_HUMAN = '5 minutes';

const RDB_CONTAINER_PATH = '/data/dump.rdb';
const RDB_HOST_FILENAME = 'dump.rdb';
const RDB_HOST_TMP_SUFFIX = '.restore-tmp';

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
 *   2. write the (already-gunzipped) RDB stream to a `.restore-tmp`
 *      file on the bind-mount, mode 0600
 *   3. `rename()` the tmp file to `dump.rdb` — atomic on the same fs,
 *      so a partial-write failure never replaces the existing rdb
 *   4. `container.start()` — redis loads dump.rdb at startup
 *
 * The whole sequence runs inside `try/finally` so a write or rename
 * failure still restarts the container. The original `dump.rdb`
 * survives any partial-write failure thanks to the rename step.
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
      // dockerode surfaces 304 when the container is already stopped.
      // That is a benign "nothing to do" — every other code path is a
      // genuine failure and bubbles up.
      const status = (err as { statusCode?: number } | null)?.statusCode;
      if (status !== 304) throw err;
    }

    const hostFile = join(args.instance.dataDir, RDB_HOST_FILENAME);
    const tmpFile = `${hostFile}${RDB_HOST_TMP_SUFFIX}`;
    let writeError: unknown = null;
    try {
      // createWriteStream `mode` honours the host umask; the explicit
      // chmod after is authoritative. Belt-and-suspenders on purpose
      // — we never want the tmp file to be world-readable, even for
      // the brief moment between open and the chmod call.
      const sink = createWriteStream(tmpFile, { mode: 0o600 });
      await pipeline(args.stream, sink);
      await chmod(tmpFile, 0o600);
      // Atomic on the same fs — replaces the existing dump.rdb only
      // after the new one is fully on disk.
      await rename(tmpFile, hostFile);
    } catch (err) {
      writeError = err;
      // Best-effort cleanup of the partial tmp file; tolerate ENOENT
      // (rename already consumed it) and any other error since the
      // primary failure is what we want to surface.
      await unlink(tmpFile).catch(() => undefined);
    }

    // Always restart — leaving the container stopped after a failed
    // restore would take the redis instance offline indefinitely
    // with no UI surface. On the success path this is the normal
    // post-restore restart; on the failure path the operator gets a
    // running container with the original (untouched) dump.rdb.
    let startError: unknown = null;
    try {
      await args.container.start();
    } catch (err) {
      startError = err;
    }

    if (writeError) {
      if (startError) {
        // Surface the start failure in logs but keep the write error
        // as the thrown one — the write failure is the root cause.
        this.logger.warn(
          `redis restore: container.start() failed after write error: ${
            startError instanceof Error ? startError.message : String(startError)
          }`,
        );
      }
      throw writeError;
    }
    if (startError) throw startError;

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
      `redis BGSAVE did not finish within ${LASTSAVE_POLL_TIMEOUT_HUMAN}`,
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
