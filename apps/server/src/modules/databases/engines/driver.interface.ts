import type { DbEngine, DbHealth } from '@dinopanel/shared';
import type Dockerode from 'dockerode';

/**
 * Per-engine driver shape (spec.md §DbEngineRegistry).
 *
 * - `defaultImage` / `defaultPort` / `dataDirInContainer` / `dataSubdir`
 *   are pure data — locked in Phase 1 so the interface is stable
 *   before Phase 2 wires in actual container creation.
 * - `promqlBundle` is fully populated in Phase 1 too: it's pure
 *   string templating over `serviceName`, no dockerode dependency,
 *   and the PMM client stub in Phase 1.4 already wants the shape.
 * - `buildContainerSpec` and `healthProbe` are Phase 2 — drivers
 *   throw `NOT_IMPLEMENTED_YET` until then. The signatures are
 *   declared up front so consumers can compile against the
 *   interface immediately.
 */
export interface DbEngineDriver {
  readonly engine: DbEngine;
  readonly defaultImage: string;
  readonly defaultPort: number;
  readonly dataDirInContainer: string;
  /**
   * Subdir under the bind-mount root where the engine actually keeps
   * its data. Only postgres sets this (`'pgdata'`) — its entrypoint
   * refuses to initialise when `PGDATA` points at a bind-mount root
   * with any pre-existing entries (e.g. ext4 `lost+found`). Other
   * engines leave it undefined and use `dataDirInContainer` as-is.
   */
  readonly dataSubdir?: string;
  buildContainerSpec(input: BuildContainerSpecInput): Dockerode.ContainerCreateOptions;
  healthProbe(container: Dockerode.Container): Promise<DbHealth>;
  promqlBundle(serviceName: string): PromqlBundle;
}

export interface BuildContainerSpecInput {
  /** `dinopanel-<engine>-<name>` — also the PMM service_name. */
  containerName: string;
  /** Resolved image tag (driver default OR caller override). */
  imageTag: string;
  /** Host port to bind. */
  hostPort: number;
  /** Absolute host path for the bind-mount data dir. */
  hostDataDir: string;
  /** Username + password (plaintext per decisions.md Q3). */
  username: string;
  password: string;
}

export interface PromqlBundle {
  /** Queries-per-second equivalent for the engine. */
  qps: string;
  /** Active client connections. */
  connections: string;
  /** Uptime in seconds. */
  uptimeSeconds: string;
  /**
   * Replication lag in seconds. May be `null` for engines/topologies
   * where the metric only exists in replica mode (standalone redis,
   * standalone mongo) — UI shows "—".
   */
  replicationLagSeconds: string;
}

export const DB_DRIVER_PHASE2_ERROR = 'NOT_IMPLEMENTED_YET (phase: 2)';

// ---------------------------------------------------------------------------
// Shared helpers used by multiple drivers.
// ---------------------------------------------------------------------------

/**
 * Run an `exec` inside the container and treat exit code 0 as healthy.
 * stdout/stderr drained but the first non-empty line of stderr (if any)
 * is surfaced via `detail` for the UI to render.
 *
 * Used by every driver's healthProbe. Each driver picks a command that
 * doesn't carry the password on the cmdline — see spec.md §healthProbe
 * (WARN-1 fix).
 */
export async function execHealthProbe(
  container: Dockerode.Container,
  cmd: string[],
  opts: { env?: string[] } = {},
): Promise<DbHealth> {
  try {
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
      ...(opts.env ? { Env: opts.env } : {}),
    });
    const stream = await exec.start({ Detach: false, hijack: true });
    const { stdout, stderr } = await drainExecStream(stream);
    const info = await exec.inspect();
    const ok = info.ExitCode === 0;
    const detail =
      stderr.trim().split('\n')[0] || stdout.trim().split('\n')[0] || null;
    return { ok, detail: detail || null };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * dockerode `exec.start` returns a multiplexed stream — docker frames
 * stdout/stderr together. This minimal demuxer pulls the two apart.
 */
function drainExecStream(
  stream: NodeJS.ReadableStream,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let buffer = Buffer.alloc(0);
    stream.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 8) {
        const streamType = buffer[0];
        const length = buffer.readUInt32BE(4);
        if (buffer.length < 8 + length) break;
        const payload = buffer.subarray(8, 8 + length).toString('utf8');
        if (streamType === 2) stderr += payload;
        else stdout += payload;
        buffer = buffer.subarray(8 + length);
      }
    });
    stream.on('end', () => resolve({ stdout, stderr }));
    stream.on('error', reject);
  });
}

/**
 * MySQL + MariaDB share a near-identical container spec — same volume
 * path, same MYSQL_ROOT_PASSWORD env, same healthcheck endpoint.
 * Factored so the two drivers stay one-liners (decisions Q5: PMM also
 * treats them identically via mysqld_exporter).
 */
export function mysqlFamilySpec(
  engine: 'mysql' | 'mariadb',
  image: string,
  containerDataDir: string,
  input: BuildContainerSpecInput,
): Dockerode.ContainerCreateOptions {
  return {
    name: input.containerName,
    Image: input.imageTag || image,
    Env: [`MYSQL_ROOT_PASSWORD=${input.password}`],
    ExposedPorts: { '3306/tcp': {} },
    Healthcheck: {
      Test: ['CMD-SHELL', 'mysqladmin ping -h localhost'],
      Interval: 10_000_000_000, // 10s in nanoseconds
      Timeout: 3_000_000_000,
      Retries: 6,
      StartPeriod: 30_000_000_000,
    },
    Labels: managedLabels(engine, input),
    HostConfig: {
      Binds: [`${input.hostDataDir}:${containerDataDir}`],
      PortBindings: {
        '3306/tcp': [{ HostPort: String(input.hostPort) }],
      },
      RestartPolicy: { Name: 'unless-stopped' },
    },
  };
}

export function managedLabels(
  engine: string,
  input: BuildContainerSpecInput,
): Record<string, string> {
  // dinopanel.* label namespace lets reconcile filter
  // `listContainers` by managed-by-dinopanel cheaply.
  return {
    'dinopanel.managed': 'true',
    'dinopanel.engine': engine,
    'dinopanel.instance': input.containerName,
  };
}
