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
