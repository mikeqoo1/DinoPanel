import { Injectable } from '@nestjs/common';
import type Dockerode from 'dockerode';
import type { DbHealth } from '@dinopanel/shared';
import {
  execHealthProbe,
  managedLabels,
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

  buildContainerSpec(input: BuildContainerSpecInput): Dockerode.ContainerCreateOptions {
    return {
      name: input.containerName,
      Image: input.imageTag || this.defaultImage,
      Env: [
        `MONGO_INITDB_ROOT_USERNAME=${input.username}`,
        `MONGO_INITDB_ROOT_PASSWORD=${input.password}`,
      ],
      ExposedPorts: { '27017/tcp': {} },
      Healthcheck: {
        // `ping` is one of the few mongo admin commands that runs
        // WITHOUT authentication — explicitly designed for
        // orchestrators. No password in cmdline (WARN-1).
        Test: [
          'CMD-SHELL',
          "mongosh --quiet --eval \"db.adminCommand({ping:1}).ok\" | grep -q 1",
        ],
        Interval: 10_000_000_000,
        Timeout: 5_000_000_000,
        Retries: 6,
        StartPeriod: 40_000_000_000,
      },
      Labels: managedLabels(this.engine, input),
      HostConfig: {
        Binds: [`${input.hostDataDir}:${this.dataDirInContainer}`],
        PortBindings: {
          '27017/tcp': [{ HostPort: String(input.hostPort) }],
        },
        RestartPolicy: { Name: 'unless-stopped' },
      },
    };
  }

  healthProbe(container: Dockerode.Container): Promise<DbHealth> {
    // Same unauthenticated ping admin command (WARN-1).
    return execHealthProbe(container, [
      'mongosh',
      '--quiet',
      '--eval',
      "db.adminCommand({ping:1}).ok",
    ]);
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
