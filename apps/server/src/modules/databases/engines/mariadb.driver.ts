import { Injectable } from '@nestjs/common';
import type Dockerode from 'dockerode';
import type { DbHealth } from '@dinopanel/shared';
import {
  execHealthProbe,
  mysqlFamilySpec,
  type BuildContainerSpecInput,
  type DbEngineDriver,
  type PromqlBundle,
} from './driver.interface';

/**
 * MariaDB 11.4 (default). PMM uses the same mysqld_exporter shape
 * as MySQL (decisions Q5) — metric names + service_name filter
 * identical.
 */
@Injectable()
export class MariadbDriver implements DbEngineDriver {
  readonly engine = 'mariadb' as const;
  readonly defaultImage = 'mariadb:11.4';
  readonly defaultPort = 3306;
  readonly dataDirInContainer = '/var/lib/mysql';

  buildContainerSpec(input: BuildContainerSpecInput): Dockerode.ContainerCreateOptions {
    // MariaDB image is API-compatible with MySQL for env + healthcheck.
    return mysqlFamilySpec(this.engine, this.defaultImage, this.dataDirInContainer, input);
  }

  healthProbe(container: Dockerode.Container): Promise<DbHealth> {
    return execHealthProbe(container, ['mysqladmin', 'ping', '-h', 'localhost']);
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
