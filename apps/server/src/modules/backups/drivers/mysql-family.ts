import type Dockerode from 'dockerode';
import type { DbInstance } from '../../../database/schema';
import { streamingDumpExec, streamingRestoreExec } from '../exec-stream';

/**
 * Shared dump + restore implementation for the mysql + mariadb
 * drivers. mariadb images ship `mysqldump` and accept the same flags,
 * so the two drivers differ only in `engine` label + image defaults
 * (set in v0.4 db-engine drivers, not here).
 *
 * Auth posture (spec WARN-1):
 *   - Password travels via `MYSQL_PWD` container Env on the exec call,
 *     not on the cmdline. `mysqldump` and `mysql` both honour `MYSQL_PWD`.
 *   - The container itself does not have `MYSQL_PWD` baked in (v0.4
 *     stores plaintext in db_instances.password and only injects it at
 *     create-time via `MYSQL_ROOT_PASSWORD`). Each exec passes Env
 *     fresh.
 *
 * Stream contract:
 *   - dump() returns a Readable of raw SQL bytes (uncompressed). The
 *     service layer pipes through zlib.gzip into the host file.
 *   - restore() consumes a Readable of raw SQL (caller already
 *     gunzipped) and pipes it into `mysql` stdin.
 */
export function mysqlFamilyDump(args: {
  container: Dockerode.Container;
  instance: DbInstance;
}): Promise<NodeJS.ReadableStream> {
  return streamingDumpExec({
    container: args.container,
    cmd: [
      'mysqldump',
      `-u${args.instance.username}`,
      '--all-databases',
      '--single-transaction',
      '--quick',
      // --routines + --events keep stored procs / triggers / scheduled
      // events in the dump, matching the operator's expectation of a
      // "full" backup.
      '--routines',
      '--events',
    ],
    env: [`MYSQL_PWD=${args.instance.password}`],
  });
}

export function mysqlFamilyRestore(args: {
  container: Dockerode.Container;
  instance: DbInstance;
  stream: NodeJS.ReadableStream;
}): Promise<void> {
  return streamingRestoreExec({
    container: args.container,
    cmd: ['mysql', `-u${args.instance.username}`],
    env: [`MYSQL_PWD=${args.instance.password}`],
    input: args.stream,
  });
}
