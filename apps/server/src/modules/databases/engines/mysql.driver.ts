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
 * MySQL 8.4 (default). Uses the mysqld_exporter PMM metric names —
 * MariaDB driver reuses the same exporter on the PMM side (decisions
 * Q5).
 */
@Injectable()
export class MysqlDriver implements DbEngineDriver {
  readonly engine = 'mysql' as const;
  readonly defaultImage = 'mysql:8.4';
  readonly defaultPort = 3306;
  readonly dataDirInContainer = '/var/lib/mysql';

  buildContainerSpec(_input: BuildContainerSpecInput): Dockerode.ContainerCreateOptions {
    throw new Error(DB_DRIVER_PHASE2_ERROR);
  }

  healthProbe(_container: Dockerode.Container): Promise<DbHealth> {
    throw new Error(DB_DRIVER_PHASE2_ERROR);
  }

  promqlBundle(serviceName: string): PromqlBundle {
    const s = serviceName;
    return {
      qps: `rate(mysql_global_status_questions{service_name="${s}"}[5m])`,
      connections: `mysql_global_status_threads_connected{service_name="${s}"}`,
      uptimeSeconds: `mysql_global_status_uptime{service_name="${s}"}`,
      replicationLagSeconds: `mysql_slave_lag_seconds{service_name="${s}"}`,
    };
  }
}
