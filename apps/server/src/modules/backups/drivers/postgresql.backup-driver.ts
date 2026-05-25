import { Injectable } from '@nestjs/common';
import type Dockerode from 'dockerode';
import type { DbInstance } from '../../../database/schema';
import {
  BACKUP_DRIVER_PHASE2_ERROR,
  type BackupDriver,
} from '../backup-driver';

/**
 * PostgreSQL backup driver. Phase 2 will run
 * `pg_dumpall -U postgres --clean --if-exists` for a cluster-wide dump
 * (multi-DB) and restore via `psql -U postgres` with the dump piped to
 * stdin. PGPASSWORD passed through container Env on the exec.
 */
@Injectable()
export class PostgresqlBackupDriver implements BackupDriver {
  readonly engine = 'postgresql' as const;
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
