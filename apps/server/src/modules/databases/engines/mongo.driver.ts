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
 * MongoDB 7.0 (default). Replica-set lag metric only appears when the
 * instance is part of a replica set — PMM empty vector maps to null
 * for standalone deployments.
 */
@Injectable()
export class MongoDriver implements DbEngineDriver {
  readonly engine = 'mongodb' as const;
  readonly defaultImage = 'mongo:7.0';
  readonly defaultPort = 27017;
  readonly dataDirInContainer = '/data/db';

  buildContainerSpec(_input: BuildContainerSpecInput): Dockerode.ContainerCreateOptions {
    throw new Error(DB_DRIVER_PHASE2_ERROR);
  }

  healthProbe(_container: Dockerode.Container): Promise<DbHealth> {
    throw new Error(DB_DRIVER_PHASE2_ERROR);
  }

  promqlBundle(serviceName: string): PromqlBundle {
    const s = serviceName;
    return {
      qps: `rate(mongodb_op_counters_total{service_name="${s}"}[5m])`,
      connections: `mongodb_connections{service_name="${s}",state="current"}`,
      uptimeSeconds: `mongodb_instance_uptime_seconds{service_name="${s}"}`,
      replicationLagSeconds: `mongodb_mongod_replset_member_replication_lag{service_name="${s}"}`,
    };
  }
}
