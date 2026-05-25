import { Injectable } from '@nestjs/common';
import type Dockerode from 'dockerode';
import type { DbInstance } from '../../../database/schema';
import {
  BACKUP_DRIVER_PHASE2_ERROR,
  type BackupDriver,
} from '../backup-driver';

/**
 * MongoDB backup driver — the one exception to the "stdout pipe + host
 * gzip" rule (decisions.md D6). `mongodump --archive --gzip` produces
 * a gzipped archive natively, so:
 *   - `alreadyGzipped: true` tells the service to write dump() output
 *     straight to disk without a `zlib.createGzip()` wrap.
 *   - `extension: 'archive'` makes the file `<ts>-<source>.archive.gz`.
 *   - Restore reverses: file → `docker exec -i` stdin →
 *     `mongorestore --archive --gzip --drop`.
 */
@Injectable()
export class MongodbBackupDriver implements BackupDriver {
  readonly engine = 'mongodb' as const;
  readonly alreadyGzipped = true;
  readonly extension = 'archive';

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
