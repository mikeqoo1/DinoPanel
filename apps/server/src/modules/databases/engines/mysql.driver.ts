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

  buildContainerSpec(input: BuildContainerSpecInput): Dockerode.ContainerCreateOptions {
    // MySQL official image only creates the root account on first init —
    // the spec assumes input.username = 'root' (service layer fills it).
    // Any other username would also need MYSQL_USER + MYSQL_PASSWORD,
    // which v0.4 doesn't expose.
    return mysqlFamilySpec(this.engine, this.defaultImage, this.dataDirInContainer, input);
  }

  healthProbe(container: Dockerode.Container): Promise<DbHealth> {
    // `mysqladmin ping -h localhost` succeeds anonymously on a running
    // server — auth not required for the ping command, so no password
    // ever traverses cmdline / env (spec WARN-1).
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
