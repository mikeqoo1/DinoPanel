import { Injectable } from '@nestjs/common';
import type Dockerode from 'dockerode';
import type { DbHealth } from '@dinopanel/shared';
import {
  DB_DRIVER_PHASE2_ERROR,
  type BuildContainerSpecInput,
  type DbEngineDriver,
  type PromqlBundle,
} from './driver.interface';

/**
 * PostgreSQL 16 (default). The only engine that sets `dataSubdir`:
 * the official image refuses to initialise when `PGDATA` points at a
 * bind-mount root with any pre-existing entries (ext4 `lost+found`,
 * dotfiles, etc.). The documented workaround is to set
 * `PGDATA=<bind-mount>/pgdata` and let the entrypoint own the subdir.
 * `buildContainerSpec` (Phase 2) emits the corresponding `PGDATA` env.
 */
@Injectable()
export class PostgresDriver implements DbEngineDriver {
  readonly engine = 'postgresql' as const;
  readonly defaultImage = 'postgres:16';
  readonly defaultPort = 5432;
  readonly dataDirInContainer = '/var/lib/postgresql/data';
  readonly dataSubdir = 'pgdata';

  buildContainerSpec(_input: BuildContainerSpecInput): Dockerode.ContainerCreateOptions {
    throw new Error(DB_DRIVER_PHASE2_ERROR);
  }

  healthProbe(_container: Dockerode.Container): Promise<DbHealth> {
    throw new Error(DB_DRIVER_PHASE2_ERROR);
  }

  promqlBundle(serviceName: string): PromqlBundle {
    const s = serviceName;
    return {
      qps: `rate(pg_stat_database_xact_commit{service_name="${s}"}[5m])`,
      connections: `pg_stat_database_numbackends{service_name="${s}"}`,
      uptimeSeconds: `time() - pg_postmaster_start_time_seconds{service_name="${s}"}`,
      replicationLagSeconds: `pg_replication_lag{service_name="${s}"}`,
    };
  }
}
