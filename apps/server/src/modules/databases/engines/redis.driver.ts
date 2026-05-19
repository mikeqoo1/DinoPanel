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

  buildContainerSpec(input: BuildContainerSpecInput): Dockerode.ContainerCreateOptions {
    // Redis has no "user" — auth is purely via requirepass. `Cmd`
    // overrides the image's default ENTRYPOINT to add --requirepass,
    // keeping the password OUT of any persisted layer or label.
    return {
      name: input.containerName,
      Image: input.imageTag || this.defaultImage,
      Cmd: ['redis-server', '--requirepass', input.password],
      ExposedPorts: { '6379/tcp': {} },
      Healthcheck: {
        // REDISCLI_AUTH env stays inside the container's spawned
        // exec — not visible in host `ps` (spec WARN-1). Passing
        // the password via `-a` would leak via cmdline.
        Test: ['CMD-SHELL', 'REDISCLI_AUTH="$REDISCLI_AUTH" redis-cli ping'],
        Interval: 10_000_000_000,
        Timeout: 3_000_000_000,
        Retries: 6,
        StartPeriod: 10_000_000_000,
      },
      Env: [`REDISCLI_AUTH=${input.password}`],
      Labels: managedLabels(this.engine, input),
      HostConfig: {
        Binds: [`${input.hostDataDir}:${this.dataDirInContainer}`],
        PortBindings: {
          '6379/tcp': [{ HostPort: String(input.hostPort) }],
        },
        RestartPolicy: { Name: 'unless-stopped' },
      },
    };
  }

  healthProbe(container: Dockerode.Container): Promise<DbHealth> {
    // Pass the password via env, NOT cmdline (WARN-1). The container
    // already has REDISCLI_AUTH from the spec above; this exec
    // inherits it automatically — no need to re-pass.
    return execHealthProbe(container, ['redis-cli', 'ping']);
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
