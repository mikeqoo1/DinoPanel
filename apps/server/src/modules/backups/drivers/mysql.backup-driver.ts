import { Injectable } from '@nestjs/common';
import type Dockerode from 'dockerode';
import type { DbInstance } from '../../../database/schema';
import {
  BACKUP_DRIVER_PHASE2_ERROR,
  type BackupDriver,
} from '../backup-driver';

/**
 * MySQL backup driver. Phase 2 will run
 * `mysqldump -uroot -p$PASSWORD --all-databases --single-transaction --quick`
 * via `docker exec` and stream stdout. Restore runs `mysql -uroot -p$PASSWORD`
 * with the gunzipped dump piped to stdin.
 */
@Injectable()
export class MysqlBackupDriver implements BackupDriver {
  readonly engine = 'mysql' as const;
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
