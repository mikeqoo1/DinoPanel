import { Injectable } from '@nestjs/common';
import type Dockerode from 'dockerode';
import type { DbInstance } from '../../../database/schema';
import {
  BACKUP_DRIVER_PHASE2_ERROR,
  type BackupDriver,
} from '../backup-driver';

/**
 * Redis backup driver. No streaming dump — sequence is:
 *   1. `redis-cli BGSAVE` to trigger background save
 *   2. poll `LASTSAVE` until the timestamp increments
 *   3. `cat /data/dump.rdb` to stream the RDB out
 *
 * Restore is destructive + requires a brief downtime:
 *   1. stop container
 *   2. write gunzipped RDB to `/data/dump.rdb` on the bind-mount
 *   3. restart container (redis loads dump.rdb on startup)
 *
 * Extension stays `sql` at the interface level so the file-naming
 * helper is uniform; the driver writes a `.rdb.gz` suffix internally
 * via a service-layer override in Phase 3.
 */
@Injectable()
export class RedisBackupDriver implements BackupDriver {
  readonly engine = 'redis' as const;
  readonly alreadyGzipped = false;
  readonly extension = 'rdb';

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
