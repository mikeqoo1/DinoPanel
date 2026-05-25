import type { DbEngine } from '@dinopanel/shared';
import type Dockerode from 'dockerode';
import type { DbInstance } from '../../database/schema';

/**
 * Per-engine backup driver shape (spec.md §BackupDriver). Phase 1
 * pins the interface + per-engine constants (engine, alreadyGzipped,
 * extension); dump / restore land in Phase 2 and throw
 * BACKUP_DRIVER_PHASE2_ERROR until then.
 *
 * Output convention (decisions.md D6): dump() returns a stream of
 * raw bytes that the service layer pipes through zlib.gzip into
 * `<ts>-<source>.<ext>.gz`. Exception: mongo sets `alreadyGzipped:
 * true` and writes the stream straight to disk — `mongodump
 * --archive --gzip` already produces a gzipped archive.
 *
 * Restore reverses: file → gunzip (skipped for mongo) → exec stdin
 * → engine-specific restore command. Driver owns the restore command
 * choice; service owns the orchestration (drop existing DB, stream,
 * verify exit code).
 */
export interface BackupDriver {
  /** Engine this driver handles. */
  readonly engine: DbEngine;
  /**
   * True when dump() output is already gzipped. Only mongo today.
   * Service uses this to decide whether to wrap dump() in zlib.gzip
   * and whether to wrap restore input in zlib.gunzip.
   */
  readonly alreadyGzipped: boolean;
  /**
   * Extension before the `.gz` suffix. `sql` for mysql / mariadb /
   * postgresql / redis (we ship redis RDB as `.rdb.gz` — see
   * redis driver — but the extension constant stays uniform at
   * driver level for the file-naming helper; redis overrides at
   * write time). `archive` for mongo.
   */
  readonly extension: string;
  /** Streams a backup from a running container. Throws on dump failure. */
  dump(args: {
    container: Dockerode.Container;
    instance: DbInstance;
  }): Promise<NodeJS.ReadableStream>;
  /**
   * Restores from a stream into the running container. Throws on
   * restore failure. Idempotent at the engine level — the driver
   * may drop + recreate the target DB before applying the stream.
   */
  restore(args: {
    container: Dockerode.Container;
    instance: DbInstance;
    stream: NodeJS.ReadableStream;
  }): Promise<void>;
}

export const BACKUP_DRIVER_PHASE2_ERROR = 'NOT_IMPLEMENTED_YET (phase: 2)';
