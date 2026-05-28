import { createServer } from 'node:net';
import { promises as fs } from 'node:fs';
import { randomBytes } from 'node:crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { eq, sql } from 'drizzle-orm';
import type Dockerode from 'dockerode';
import type {
  CreateDbInstance,
  DbEngine,
  DbInstanceResponse,
  DbInstanceRevealResponse,
  DbReconcileResponse,
  PatchDbInstance,
  RemoveDbInstance,
} from '@dinopanel/shared';
import { UsersService } from '../users/users.service';
import type { AppConfig } from '../../config/configuration';
import { DRIZZLE_DB, type Db } from '../../database/db.module';
import { dbInstances, type DbInstance } from '../../database/schema';
import { DOCKER } from '../containers/docker.token';
import { DbEngineRegistry } from './db-engine.registry';
import { DbMetricsService } from './db-metrics.service';
import {
  assertSafeInstanceName,
  containerNameOf,
  resolveDatabasesPaths,
  type DatabasesPaths,
} from './paths';
import { relabelPath } from './selinux.util';

// How long a revealed password is considered valid by the client (the
// dialog auto-hides after this). Server returns `expiresAt = now + this`;
// the frontend uses the server's expiresAt for the countdown, so this
// constant only controls the wall-clock window the reveal endpoint promises.
const REVEAL_WINDOW_MS = 30_000;

/**
 * v0.4 Phase 2 — full lifecycle for DB instances.
 * `DatabasesService` keeps the bootstrap + degraded-flag concerns;
 * this service owns CRUD + container choreography.
 */
@Injectable()
export class DbInstancesService {
  private readonly paths: DatabasesPaths;

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Db,
    @Inject(DOCKER) private readonly docker: Dockerode,
    @Inject(ConfigService)
    private readonly config: ConfigService<{ app: AppConfig }>,
    private readonly registry: DbEngineRegistry,
    private readonly metrics: DbMetricsService,
    private readonly usersService: UsersService,
    private readonly logger: Logger,
  ) {
    const app = this.config.get<AppConfig>('app', { infer: true });
    if (!app) throw new Error('App config missing');
    this.paths = resolveDatabasesPaths(app.env.DATABASES_ROOT);
  }

  // -------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------

  async list(): Promise<DbInstanceResponse[]> {
    const rows = await this.db.select().from(dbInstances).all();
    return rows.map((r) => this.toResponse(r));
  }

  async get(id: number): Promise<DbInstanceResponse> {
    const row = await this.fetchRow(id);
    return this.toResponse(row);
  }

  // -------------------------------------------------------------------
  // Create — six-step atomic with rollback (spec.md §DbInstancesService)
  // -------------------------------------------------------------------

  async create(input: CreateDbInstance): Promise<DbInstanceResponse> {
    assertSafeInstanceName(input.name);
    const driver = this.registry.get(input.engine);

    // Default username per engine. Service-side here so Phase 5 UI can
    // hide the field when operator doesn't want to customise.
    const username =
      input.customCredentials?.username ?? defaultUsername(input.engine);
    const password =
      input.customCredentials?.password ?? generateStrongPassword();
    const imageTag = input.imageTag ?? driver.defaultImage;
    const containerName = containerNameOf(input.engine, input.name);
    const hostDataDir = this.paths.instanceDir(input.engine, input.name);

    await this.assertPortFree(input.port);
    await this.assertNameAndContainerFree(input.name, containerName);

    // ----- step 2.5: ensure the image is locally available -----
    // Docker daemon's containerCreate API does NOT auto-pull missing
    // images (unlike `docker run`). We pull explicitly BEFORE
    // touching disk so a bad tag / network failure exits cleanly
    // without any rollback work.
    try {
      await this.ensureImage(imageTag);
    } catch (err) {
      throw new InternalServerErrorException({
        code: 'DB_IMAGE_PULL_FAILED',
        message: `Failed to pull ${imageTag}: ${(err as Error).message ?? String(err)}`,
      });
    }

    // ----- step 3: mkdir host data dir + dataSubdir for postgres -----
    let createdDir = false;
    try {
      await fs.mkdir(hostDataDir, { recursive: true, mode: 0o755 });
      createdDir = true;
      if (driver.dataSubdir) {
        await fs.mkdir(`${hostDataDir}/${driver.dataSubdir}`, {
          recursive: true,
          mode: 0o755,
        });
      }
    } catch (err) {
      throw new InternalServerErrorException({
        code: 'DB_DATA_DIR_FAILED',
        message: (err as Error).message,
      });
    }

    // ----- step 4: SELinux relabel (no-op on non-SELinux hosts) -----
    const relabel = await relabelPath(hostDataDir, 'container_file_t');
    if (!relabel.ok && relabel.reason !== 'not_installed') {
      // Roll back the dir before bailing.
      if (createdDir) await this.safeRmrf(hostDataDir);
      throw new InternalServerErrorException({
        code: 'DB_RELABEL_FAILED',
        message: `${relabel.reason}: ${relabel.stderr ?? ''}`,
      });
    }

    // ----- step 5: dockerode create + start -----
    let container: Dockerode.Container | null = null;
    try {
      const spec = driver.buildContainerSpec({
        containerName,
        imageTag,
        hostPort: input.port,
        hostDataDir,
        username,
        password,
      });
      container = await this.docker.createContainer(spec);
      await container.start();
    } catch (err) {
      // Roll back filesystem + (if created) the half-started container.
      if (container) {
        await container.remove({ force: true }).catch(() => undefined);
      }
      if (createdDir) await this.safeRmrf(hostDataDir);
      throw new InternalServerErrorException({
        code: 'DB_CREATE_FAILED',
        message: (err as Error).message ?? String(err),
      });
    }

    // ----- step 6: persist row -----
    const now = Date.now();
    try {
      const inserted = await this.db
        .insert(dbInstances)
        .values({
          name: input.name,
          engine: input.engine,
          imageTag,
          port: input.port,
          username,
          password,
          dataDir: hostDataDir,
          containerName,
          status: 'running',
          lastError: null,
          pmmRegistered: false,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .all();
      const row = inserted[0];
      if (!row) {
        throw new Error('insert returned no row');
      }
      return this.toResponse(row);
    } catch (err) {
      // Roll back container + dir if the row fails (rare but possible
      // under disk-full or readonly-fs).
      if (container) {
        await container.remove({ force: true }).catch(() => undefined);
      }
      if (createdDir) await this.safeRmrf(hostDataDir);
      throw new InternalServerErrorException({
        code: 'DB_PERSIST_FAILED',
        message: (err as Error).message ?? String(err),
      });
    }
  }

  // -------------------------------------------------------------------
  // Update + lifecycle
  // -------------------------------------------------------------------

  async patch(id: number, input: PatchDbInstance): Promise<DbInstanceResponse> {
    const row = await this.fetchRow(id);
    if (!input.imageTag || input.imageTag === row.imageTag) {
      return this.toResponse(row);
    }
    // Image tag change → stop + remove + recreate with same data dir.
    const driver = this.registry.get(row.engine);
    const container = this.docker.getContainer(row.containerName);
    await container.stop().catch(() => undefined);
    await container.remove({ force: true }).catch(() => undefined);

    const spec = driver.buildContainerSpec({
      containerName: row.containerName,
      imageTag: input.imageTag,
      hostPort: row.port,
      hostDataDir: row.dataDir,
      username: row.username,
      password: row.password,
    });
    const fresh = await this.docker.createContainer(spec);
    await fresh.start();

    const now = Date.now();
    await this.db
      .update(dbInstances)
      .set({
        imageTag: input.imageTag,
        status: 'running',
        lastError: null,
        updatedAt: now,
      })
      .where(eq(dbInstances.id, id));
    return this.get(id);
  }

  async start(id: number): Promise<void> {
    const row = await this.fetchRow(id);
    await this.docker
      .getContainer(row.containerName)
      .start()
      .catch((err: { statusCode?: number }) => {
        if (err.statusCode === 304) return; // already running
        throw err;
      });
    await this.markStatus(id, 'running');
  }

  async stop(id: number): Promise<void> {
    const row = await this.fetchRow(id);
    await this.docker
      .getContainer(row.containerName)
      .stop()
      .catch((err: { statusCode?: number }) => {
        if (err.statusCode === 304) return; // already stopped
        throw err;
      });
    await this.markStatus(id, 'stopped');
  }

  async restart(id: number): Promise<void> {
    const row = await this.fetchRow(id);
    await this.docker.getContainer(row.containerName).restart();
    await this.markStatus(id, 'running');
  }

  async remove(id: number, input: RemoveDbInstance): Promise<void> {
    const row = await this.fetchRow(id);
    await this.docker
      .getContainer(row.containerName)
      .remove({ force: true })
      .catch((err: { statusCode?: number }) => {
        // 404 = container already gone, treat as success.
        if (err.statusCode === 404) return;
        throw err;
      });
    if (input.dropData) {
      await this.safeRmrf(row.dataDir);
    }
    await this.db.delete(dbInstances).where(eq(dbInstances.id, id));
    this.metrics.invalidate(id);
  }

  async rotatePassword(id: number): Promise<DbInstanceResponse> {
    const row = await this.fetchRow(id);
    const driver = this.registry.get(row.engine);
    const newPassword = generateStrongPassword();

    // Brief-downtime contract — Drawer's confirm dialog already
    // warned the operator (spec.md §Q3 Implications).
    await this.markStatus(id, 'restarting');
    const container = this.docker.getContainer(row.containerName);
    await container.stop().catch(() => undefined);
    await container.remove({ force: true }).catch(() => undefined);

    const spec = driver.buildContainerSpec({
      containerName: row.containerName,
      imageTag: row.imageTag,
      hostPort: row.port,
      hostDataDir: row.dataDir,
      username: row.username,
      password: newPassword,
    });
    const fresh = await this.docker.createContainer(spec);
    await fresh.start();

    const now = Date.now();
    await this.db
      .update(dbInstances)
      .set({
        password: newPassword,
        status: 'running',
        lastError: null,
        updatedAt: now,
      })
      .where(eq(dbInstances.id, id));
    // Cache contents are still numerically correct (PMM doesn't see
    // passwords), but rotating password is a notable event — bust the
    // cache so the operator can refresh and see fresh metrics post-
    // restart. Cheap.
    this.metrics.invalidate(id);
    return this.get(id);
  }

  async revealPassword(
    instanceId: number,
    requesterUserId: number,
    currentPassword: string,
  ): Promise<DbInstanceRevealResponse> {
    // Resolve the instance BEFORE re-auth so a 404 surfaces without first
    // exposing "your password is correct" as a side-channel — an attacker
    // probing random instanceIds with a known-valid password would
    // otherwise learn auth status before the lookup ran. Both checks
    // are still required; the order matters for the side-channel only.
    const row = await this.fetchRow(instanceId);
    const user = await this.usersService.findById(requesterUserId);
    if (!user) {
      throw new UnauthorizedException({
        code: 'AUTH_RE_VERIFY_FAILED',
        message: 'Re-verification failed',
      });
    }
    const ok = await this.usersService.verifyPassword(user, currentPassword);
    if (!ok) {
      throw new UnauthorizedException({
        code: 'AUTH_RE_VERIFY_FAILED',
        message: 'Re-verification failed',
      });
    }
    const now = Date.now();
    return {
      id: row.id,
      password: row.password,
      revealedAt: now,
      expiresAt: now + REVEAL_WINDOW_MS,
    };
  }

  // -------------------------------------------------------------------
  // Reconcile — boot + manual endpoint
  // -------------------------------------------------------------------

  async reconcile(): Promise<DbReconcileResponse> {
    const rows = await this.db.select().from(dbInstances).all();
    const containers = await this.docker.listContainers({ all: true });
    const byContainerName = new Map(
      containers.flatMap((c) =>
        (c.Names ?? []).map((n) => [n.replace(/^\//, ''), c] as const),
      ),
    );

    let matched = 0;
    let missingContainer = 0;
    let orphanContainer = 0;

    for (const row of rows) {
      const c = byContainerName.get(row.containerName);
      if (!c) {
        await this.db
          .update(dbInstances)
          .set({
            status: 'error',
            lastError: 'container_missing',
            updatedAt: Date.now(),
          })
          .where(eq(dbInstances.id, row.id));
        missingContainer += 1;
        continue;
      }
      const stateMap: Record<string, DbInstance['status']> = {
        running: 'running',
        exited: 'stopped',
        paused: 'stopped',
        restarting: 'restarting',
        dead: 'error',
        created: 'creating',
      };
      const next = stateMap[c.State] ?? 'error';
      await this.db
        .update(dbInstances)
        .set({ status: next, updatedAt: Date.now() })
        .where(eq(dbInstances.id, row.id));
      matched += 1;
      byContainerName.delete(row.containerName);
    }

    // Anything left under our naming convention is an orphan we can't
    // adopt without operator input (no recoverable credentials).
    for (const c of byContainerName.values()) {
      const names = (c.Names ?? []).map((n) => n.replace(/^\//, ''));
      if (names.some((n) => /^dinopanel-(mysql|mariadb|postgresql|redis|mongodb)-/.test(n))) {
        orphanContainer += 1;
        this.logger.warn(
          { container: names[0] },
          'databases.reconcile.orphan_container',
        );
      }
    }

    return {
      scanned: rows.length,
      matched,
      missingContainer,
      orphanContainer,
    };
  }

  // -------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------

  /**
   * Pull the image into the local Docker daemon if it isn't there
   * already. dockerode's createContainer 404s on missing images
   * (unlike `docker run`), so we have to do this explicitly. No-op
   * when the image is already cached.
   */
  private async ensureImage(ref: string): Promise<void> {
    try {
      await this.docker.getImage(ref).inspect();
      return; // already pulled
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status !== 404) throw err;
    }
    this.logger.debug({ ref }, 'db.pull.start');
    await new Promise<void>((resolve, reject) => {
      this.docker.pull(ref, (pullErr: Error | null, stream: NodeJS.ReadableStream) => {
        if (pullErr) {
          reject(pullErr);
          return;
        }
        // followProgress drains the pull stream and fires its callback
        // once the daemon emits the "Status: Downloaded" terminal
        // event. Errors mid-stream (e.g. tag not found on registry)
        // come back via the first arg.
        const modem = (this.docker as unknown as {
          modem: {
            followProgress: (
              s: NodeJS.ReadableStream,
              done: (err: Error | null, output: unknown[]) => void,
            ) => void;
          };
        }).modem;
        modem.followProgress(stream, (finishErr: Error | null) => {
          if (finishErr) reject(finishErr);
          else resolve();
        });
      });
    });
    this.logger.debug({ ref }, 'db.pull.done');
  }

  private async fetchRow(id: number): Promise<DbInstance> {
    const rows = await this.db
      .select()
      .from(dbInstances)
      .where(eq(dbInstances.id, id))
      .limit(1);
    if (!rows[0]) {
      throw new NotFoundException({
        code: 'DB_INSTANCE_NOT_FOUND',
        message: `No db instance with id ${id}`,
      });
    }
    return rows[0];
  }

  private async assertPortFree(port: number): Promise<void> {
    const existing = await this.db
      .select({ port: dbInstances.port })
      .from(dbInstances)
      .where(eq(dbInstances.port, port))
      .limit(1);
    if (existing.length > 0) {
      throw new ConflictException({
        code: 'DB_PORT_CONFLICT',
        message: `Port ${port} is already used by another DinoPanel instance`,
      });
    }
    // Host-port probe — best-effort. Docker bind is final source of
    // truth (spec.md §WARN — TOCTOU). A probe failure means "almost
    // certainly conflict"; a probe success doesn't guarantee no
    // conflict at create time.
    const probeOk = await probeHostPort(port);
    if (!probeOk) {
      throw new ConflictException({
        code: 'DB_PORT_CONFLICT',
        message: `Port ${port} is in use on the host`,
      });
    }
  }

  private async assertNameAndContainerFree(
    name: string,
    containerName: string,
  ): Promise<void> {
    const existing = await this.db
      .select({ id: dbInstances.id })
      .from(dbInstances)
      .where(sql`${dbInstances.name} = ${name} OR ${dbInstances.containerName} = ${containerName}`)
      .limit(1);
    if (existing.length > 0) {
      throw new ConflictException({
        code: 'DB_NAME_TAKEN',
        message: `An instance with name '${name}' (or container '${containerName}') already exists`,
      });
    }
  }

  private async markStatus(id: number, status: DbInstance['status']): Promise<void> {
    await this.db
      .update(dbInstances)
      .set({ status, lastError: null, updatedAt: Date.now() })
      .where(eq(dbInstances.id, id));
  }

  private async safeRmrf(path: string): Promise<void> {
    try {
      await fs.rm(path, { recursive: true, force: true });
    } catch (err) {
      this.logger.warn({ err, path }, 'databases.rollback.rmrf_failed');
    }
  }

  private toResponse(row: DbInstance): DbInstanceResponse {
    return {
      id: row.id,
      name: row.name,
      engine: row.engine,
      imageTag: row.imageTag,
      port: row.port,
      username: row.username,
      dataDir: row.dataDir,
      containerName: row.containerName,
      status: row.status,
      lastError: row.lastError,
      pmmRegistered: row.pmmRegistered,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultUsername(engine: DbEngine): string {
  switch (engine) {
    case 'mysql':
    case 'mariadb':
      return 'root';
    case 'postgresql':
      return 'postgres';
    case 'redis':
      // Redis has no real user concept; we store a placeholder so the
      // connection card has something to show. Auth is requirepass only.
      return 'default';
    case 'mongodb':
      return 'root';
    default: {
      const _exhaustive: never = engine;
      throw new Error(`Unsupported engine: ${_exhaustive as string}`);
    }
  }
}

function generateStrongPassword(): string {
  // 32 random bytes → 43 base64-url characters (no padding). Plenty
  // of entropy and survives shell + dockerode JSON round-trip.
  return randomBytes(32).toString('base64url');
}

function probeHostPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

export { generateStrongPassword, defaultUsername, probeHostPort };
