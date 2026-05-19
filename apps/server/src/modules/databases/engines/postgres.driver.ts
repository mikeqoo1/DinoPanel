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

  buildContainerSpec(input: BuildContainerSpecInput): Dockerode.ContainerCreateOptions {
    // PGDATA points at the dataSubdir so the entrypoint can own the
    // subdir instead of the bind-mount root (decisions Q2 BLOCK-2).
    const pgdata = `${this.dataDirInContainer}/${this.dataSubdir}`;
    return {
      name: input.containerName,
      Image: input.imageTag || this.defaultImage,
      Env: [
        `POSTGRES_USER=${input.username}`,
        `POSTGRES_PASSWORD=${input.password}`,
        `PGDATA=${pgdata}`,
      ],
      ExposedPorts: { '5432/tcp': {} },
      Healthcheck: {
        // pg_isready needs the username to know which DB to probe; no
        // password required for local socket — spec WARN-1.
        Test: ['CMD-SHELL', `pg_isready -U ${input.username}`],
        Interval: 10_000_000_000,
        Timeout: 3_000_000_000,
        Retries: 6,
        StartPeriod: 30_000_000_000,
      },
      Labels: managedLabels(this.engine, input),
      HostConfig: {
        Binds: [`${input.hostDataDir}:${this.dataDirInContainer}`],
        PortBindings: {
          '5432/tcp': [{ HostPort: String(input.hostPort) }],
        },
        RestartPolicy: { Name: 'unless-stopped' },
      },
    };
  }

  healthProbe(container: Dockerode.Container): Promise<DbHealth> {
    // pg_isready against the local socket — only checks server
    // readiness, no auth required. No password in cmdline (WARN-1).
    return execHealthProbe(container, ['pg_isready']);
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
