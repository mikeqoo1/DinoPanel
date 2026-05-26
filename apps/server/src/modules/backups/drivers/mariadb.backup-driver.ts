import { Injectable } from '@nestjs/common';
import type Dockerode from 'dockerode';
import type { DbInstance } from '../../../database/schema';
import type { BackupDriver } from '../backup-driver';
import { mysqlFamilyDump, mysqlFamilyRestore } from './mysql-family';

/**
 * MariaDB backup driver. The mariadb image ships `mysqldump` and
 * accepts the same flags as MySQL's, so dump + restore delegate to
 * `mysql-family.ts`. Kept as a separate class so the registry stays
 * 1:1 with DbEngine and a future divergence (mariadb-only physical
 * `mariabackup`) has somewhere to land without breaking the mysql
 * driver.
 */
@Injectable()
export class MariadbBackupDriver implements BackupDriver {
  readonly engine = 'mariadb' as const;
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
