import { promises as fs } from 'node:fs';
import {
  Inject,
  Injectable,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { eq } from 'drizzle-orm';
import type {
  CreateDbInstance,
  DbInstanceResponse,
  DbReconcileResponse,
  PatchDbInstance,
  RemoveDbInstance,
} from '@dinopanel/shared';
import type { AppConfig } from '../../config/configuration';
import { DRIZZLE_DB, type Db } from '../../database/db.module';
import { settings } from '../../database/schema';
import { resolveDatabasesPaths, type DatabasesPaths } from './paths';
import { relabelPath } from './selinux.util';

export const DATABASES_BOOTSTRAP_FLAG = 'databases.bootstrap_failed';
const DATABASES_SELINUX_LABEL = 'container_file_t';
const PHASE2_ERROR = 'NOT_IMPLEMENTED_YET (phase: 2)';

/**
 * Phase 1 responsibilities:
 *
 * - Bootstrap the on-disk root (`<DATABASES_ROOT>`) with 0755.
 * - Apply SELinux `container_file_t` label to the root tree
 *   (no-op on non-SELinux hosts).
 * - Surface a degraded flag in `settings` when bootstrap fails;
 *   never crash the app.
 *
 * Phase 2 fills in `create / start / stop / restart / remove /
 * rotatePassword / reconcile`.
 */
@Injectable()
export class DatabasesService implements OnApplicationBootstrap {
  private degraded = false;
  private degradedReason: string | null = null;
  private readonly paths: DatabasesPaths;

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Db,
    @Inject(ConfigService)
    private readonly config: ConfigService<{ app: AppConfig }>,
    private readonly logger: Logger,
  ) {
    const app = this.config.get<AppConfig>('app', { infer: true });
    if (!app) throw new Error('App config missing');
    this.paths = resolveDatabasesPaths(app.env.DATABASES_ROOT);
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.ensureRoot();
      await this.applyRootLabel();
      await this.clearDegradedFlag();
      this.logger.debug({ root: this.paths.root }, 'databases.bootstrap.ok');
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.degraded = true;
      this.degradedReason = reason;
      this.logger.error({ err, reason }, 'databases.bootstrap.failed');
      await this.persistDegradedFlag(reason).catch(() => {
        /* ignore */
      });
    }
  }

  getStatus(): { degraded: boolean; reason: string | null } {
    return { degraded: this.degraded, reason: this.degradedReason };
  }

  isDegraded(): boolean {
    return this.degraded;
  }

  // -------------------------------------------------------------------
  // Phase 1 — bootstrap internals
  // -------------------------------------------------------------------

  async ensureRoot(): Promise<void> {
    await fs.mkdir(this.paths.root, { recursive: true, mode: 0o755 });
  }

  async applyRootLabel(): Promise<void> {
    const result = await relabelPath(this.paths.root, DATABASES_SELINUX_LABEL);
    if (!result.ok && result.reason !== 'not_installed') {
      // Surface as a bootstrap failure so the operator can see it via
      // the degraded flag. Non-SELinux hosts hit `not_installed` and
      // pass straight through.
      throw new Error(
        `SELinux relabel of ${this.paths.root} failed: ${result.reason} — ${result.stderr ?? ''}`,
      );
    }
    if (result.reason === 'not_installed') {
      this.logger.debug(
        { root: this.paths.root },
        'databases.bootstrap.selinux_skipped',
      );
    }
  }

  // -------------------------------------------------------------------
  // Phase 2 — lifecycle (stubs)
  // -------------------------------------------------------------------

  async list(): Promise<DbInstanceResponse[]> {
    return [];
  }

  async get(_id: number): Promise<DbInstanceResponse> {
    throw new Error(PHASE2_ERROR);
  }

  async create(_input: CreateDbInstance): Promise<DbInstanceResponse> {
    throw new Error(PHASE2_ERROR);
  }

  async patch(
    _id: number,
    _input: PatchDbInstance,
  ): Promise<DbInstanceResponse> {
    throw new Error(PHASE2_ERROR);
  }

  async remove(_id: number, _input: RemoveDbInstance): Promise<void> {
    throw new Error(PHASE2_ERROR);
  }

  async start(_id: number): Promise<void> {
    throw new Error(PHASE2_ERROR);
  }

  async stop(_id: number): Promise<void> {
    throw new Error(PHASE2_ERROR);
  }

  async restart(_id: number): Promise<void> {
    throw new Error(PHASE2_ERROR);
  }

  async rotatePassword(_id: number): Promise<DbInstanceResponse> {
    throw new Error(PHASE2_ERROR);
  }

  async reconcile(): Promise<DbReconcileResponse> {
    throw new Error(PHASE2_ERROR);
  }

  // -------------------------------------------------------------------
  // Degraded flag persistence
  // -------------------------------------------------------------------

  private async persistDegradedFlag(reason: string): Promise<void> {
    const now = Date.now();
    await this.db
      .insert(settings)
      .values({
        key: DATABASES_BOOTSTRAP_FLAG,
        value: JSON.stringify({ at: now, reason }),
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: JSON.stringify({ at: now, reason }), updatedAt: now },
      });
  }

  private async clearDegradedFlag(): Promise<void> {
    await this.db
      .delete(settings)
      .where(eq(settings.key, DATABASES_BOOTSTRAP_FLAG));
  }
}
