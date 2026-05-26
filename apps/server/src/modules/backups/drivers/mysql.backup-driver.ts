import { Injectable } from '@nestjs/common';
import type Dockerode from 'dockerode';
import type { DbInstance } from '../../../database/schema';
import type { BackupDriver } from '../backup-driver';
import { mysqlFamilyDump, mysqlFamilyRestore } from './mysql-family';

/**
 * MySQL backup driver. Dump:
 *   `mysqldump -u<user> --all-databases --single-transaction --quick --routines --events`
 * with `MYSQL_PWD` in the exec env (spec WARN-1: no password on cmdline).
 *
 * Restore: `mysql -u<user>` with `MYSQL_PWD`, gunzipped SQL piped to stdin.
 *
 * The actual work is shared with the mariadb driver (same flags, same
 * client binary), so both delegate to `mysql-family.ts`.
 */
@Injectable()
export class MysqlBackupDriver implements BackupDriver {
  readonly engine = 'mysql' as const;
  readonly alreadyGzipped = false;
  readonly extension = 'sql';

  dump(args: {
    container: Dockerode.Container;
    instance: DbInstance;
  }): Promise<NodeJS.ReadableStream> {
    return mysqlFamilyDump(args);
  }

  restore(args: {
    container: Dockerode.Container;
    instance: DbInstance;
    stream: NodeJS.ReadableStream;
  }): Promise<void> {
    return mysqlFamilyRestore(args);
  }
}
