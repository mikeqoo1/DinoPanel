import { Injectable } from '@nestjs/common';
import type Dockerode from 'dockerode';
import type { DbInstance } from '../../../database/schema';
import type { BackupDriver } from '../backup-driver';
import { streamingDumpExec, streamingRestoreExec } from '../exec-stream';

/**
 * PostgreSQL backup driver. Dump:
 *   `pg_dumpall -U <user> --clean --if-exists`
 * via docker exec with `PGPASSWORD` in the exec Env (spec WARN-1).
 *
 * `pg_dumpall` (not `pg_dump`) so the dump is cluster-wide — covers
 * every DB the operator created plus roles. `--clean --if-exists`
 * make restore idempotent: the dump emits `DROP DATABASE IF EXISTS`
 * before each `CREATE DATABASE`, matching the "restore-in-place"
 * decision (D4).
 *
 * Restore: `psql -U <user>` with `PGPASSWORD`, dump piped to stdin.
 * Connects to the default `postgres` admin DB; the `DROP` commands in
 * the dump take care of dropping and recreating the user DBs.
 */
@Injectable()
export class PostgresqlBackupDriver implements BackupDriver {
  readonly engine = 'postgresql' as const;
  readonly alreadyGzipped = false;
  readonly extension = 'sql';

  dump(args: {
    container: Dockerode.Container;
    instance: DbInstance;
  }): Promise<NodeJS.ReadableStream> {
    return streamingDumpExec({
      container: args.container,
      cmd: ['pg_dumpall', '-U', args.instance.username, '--clean', '--if-exists'],
      env: [`PGPASSWORD=${args.instance.password}`],
    });
  }

  restore(args: {
    container: Dockerode.Container;
    instance: DbInstance;
    stream: NodeJS.ReadableStream;
  }): Promise<void> {
    return streamingRestoreExec({
      container: args.container,
      cmd: ['psql', '-U', args.instance.username, '-d', 'postgres'],
      env: [`PGPASSWORD=${args.instance.password}`],
      input: args.stream,
    });
  }
}
