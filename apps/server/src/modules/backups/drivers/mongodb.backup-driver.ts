import { Injectable } from '@nestjs/common';
import type Dockerode from 'dockerode';
import type { DbInstance } from '../../../database/schema';
import type { BackupDriver } from '../backup-driver';
import { streamingDumpExec, streamingRestoreExec } from '../exec-stream';

/**
 * MongoDB backup driver — the one engine where dump() already
 * produces gzipped bytes (decisions.md D6 exception).
 *
 * Dump: `mongodump --archive --gzip --username … --password … --authenticationDatabase admin`.
 *   - Output is a binary "archive" format that bundles every DB into
 *     a single stream — what we want.
 *   - `--gzip` makes mongodump compress on the way out, so the
 *     service layer writes the stream straight to disk without an
 *     extra `zlib.gzip` step (`alreadyGzipped: true`).
 *   - File extension is `archive` so the final filename is
 *     `<ts>-<source>.archive.gz`.
 *
 * Restore: `mongorestore --archive --gzip --drop --username … …`.
 *   - `--drop` is collection-scoped: every collection present in the
 *     archive is dropped and recreated, but any collection (or
 *     database) only in the live server is left untouched. For a
 *     single-tenant DinoPanel container that holds only what
 *     `mongodump` wrote, the practical effect matches D4's
 *     restore-in-place posture (no merged residue from before).
 *   - Caller pipes the on-disk `.archive.gz` straight to stdin
 *     (no host gunzip — mongorestore handles `--gzip`).
 *
 * Cmdline caveat: mongodump / mongorestore both lack a
 * password-via-env path. The password ends up in container-internal
 * `ps`, which is acceptable under v0.4's single-tenant container
 * posture (root inside == root outside; same trust boundary).
 */
@Injectable()
export class MongodbBackupDriver implements BackupDriver {
  readonly engine = 'mongodb' as const;
  readonly alreadyGzipped = true;
  readonly extension = 'archive';

  dump(args: {
    container: Dockerode.Container;
    instance: DbInstance;
  }): Promise<NodeJS.ReadableStream> {
    return streamingDumpExec({
      container: args.container,
      cmd: [
        'mongodump',
        '--archive',
        '--gzip',
        '--username',
        args.instance.username,
        '--password',
        args.instance.password,
        '--authenticationDatabase',
        'admin',
      ],
    });
  }

  restore(args: {
    container: Dockerode.Container;
    instance: DbInstance;
    stream: NodeJS.ReadableStream;
  }): Promise<void> {
    return streamingRestoreExec({
      container: args.container,
      cmd: [
        'mongorestore',
        '--archive',
        '--gzip',
        '--drop',
        '--username',
        args.instance.username,
        '--password',
        args.instance.password,
        '--authenticationDatabase',
        'admin',
      ],
      input: args.stream,
    });
  }
}
