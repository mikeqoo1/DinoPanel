import { Injectable } from '@nestjs/common';
import type Dockerode from 'dockerode';
import type { DbInstance } from '../../../database/schema';
import {
  BACKUP_DRIVER_PHASE2_ERROR,
  type BackupDriver,
} from '../backup-driver';

/**
 * MariaDB backup driver. The mariadb image ships `mysqldump` so Phase 2
 * reuses the mysql code path verbatim (same flags, same restore command).
 * Kept as a separate class so the registry stays 1:1 with DbEngine and
 * a future divergence (e.g. mariadb-only `mariabackup` physical mode)
 * has somewhere to land without breaking the mysql driver.
 */
@Injectable()
export class MariadbBackupDriver implements BackupDriver {
  readonly engine = 'mariadb' as const;
  readonly alreadyGzipped = false;
  readonly extension = 'sql';

  async dump(_args: {
    container: Dockerode.Container;
    instance: DbInstance;
  }): Promise<NodeJS.ReadableStream> {
    throw new Error(BACKUP_DRIVER_PHASE2_ERROR);
  }

  async restore(_args: {
    container: Dockerode.Container;
    instance: DbInstance;
    stream: NodeJS.ReadableStream;
  }): Promise<void> {
    throw new Error(BACKUP_DRIVER_PHASE2_ERROR);
  }
}
