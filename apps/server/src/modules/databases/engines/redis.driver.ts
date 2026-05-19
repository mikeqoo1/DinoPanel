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
 * Redis 7.4-alpine (default). `redis_connected_slave_lag_seconds`
 * returns no vector for standalone instances — PMM client maps the
 * empty vector to `null`, UI renders "—".
 */
@Injectable()
export class RedisDriver implements DbEngineDriver {
  readonly engine = 'redis' as const;
  readonly defaultImage = 'redis:7.4-alpine';
  readonly defaultPort = 6379;
  readonly dataDirInContainer = '/data';

  buildContainerSpec(_input: BuildContainerSpecInput): Dockerode.ContainerCreateOptions {
    throw new Error(DB_DRIVER_PHASE2_ERROR);
  }

  healthProbe(_container: Dockerode.Container): Promise<DbHealth> {
    throw new Error(DB_DRIVER_PHASE2_ERROR);
  }

  promqlBundle(serviceName: string): PromqlBundle {
    const s = serviceName;
    return {
      qps: `rate(redis_commands_processed_total{service_name="${s}"}[5m])`,
      connections: `redis_connected_clients{service_name="${s}"}`,
      uptimeSeconds: `redis_uptime_in_seconds{service_name="${s}"}`,
      replicationLagSeconds: `redis_connected_slave_lag_seconds{service_name="${s}"}`,
    };
  }
}
