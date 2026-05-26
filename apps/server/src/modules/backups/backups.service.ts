import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, mkdir, stat, unlink } from 'node:fs/promises';
import { basename } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, lt } from 'drizzle-orm';
import type Dockerode from 'dockerode';
import type {
  BackupResponse,
  BackupSource,
  ListBackupsQuery,
} from '@dinopanel/shared';
import type { AppConfig } from '../../config/configuration';
import { DRIZZLE_DB, type Db } from '../../database/db.module';
import {
  backups,
  dbInstances,
  type Backup,
  type DbInstance,
} from '../../database/schema';
import { DOCKER } from '../containers/docker.token';
import { BackupDriverRegistry } from './backup-driver.registry';
import { resolveBackupsPaths, type BackupsPaths } from './paths';

interface CreateInput {
  instanceId: number;
  source: BackupSource;
  retentionGroup?: string | null;
  keepLastN?: number | null;
}

interface RestoreInput {
  backupId: number;
  confirm: string;
}

interface ListResult {
  items: BackupResponse[];
  nextCursor: number | null;
}

interface DownloadStream {
  stream: NodeJS.ReadableStream;
  filename: string;
  byteSize: number;
}

@Injectable()
export class BackupsService implements OnModuleInit {
  private readonly logger = new Logger(BackupsService.name);
  readonly paths: BackupsPaths;

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Db,
    @Inject(DOCKER) private readonly docker: Dockerode,
    @Inject(ConfigService) config: ConfigService<{ app: AppConfig }>,
    private readonly drivers: BackupDriverRegistry,
  ) {
    const app = config.get<AppConfig>('app', { infer: true });
    if (!app) throw new Error('App config missing');
    this.paths = resolveBackupsPaths(app.env.BACKUPS_ROOT);
  }

  async onModuleInit(): Promise<void> {
    try {
      await mkdir(this.paths.root, { recursive: true, mode: 0o700 });
    } catch (err) {
      // Don't crash boot — operator might be running with a relocated
      // root that the panel can't create itself. The first create()
      // call will surface a clearer error against the same path.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to bootstrap BACKUPS_ROOT (${this.paths.root}): ${message}`,
      );
    }
  }

  // -------------------------------------------------------------------
  // Create — dump → host gzip (if needed) → file → row → retention prune
  // -------------------------------------------------------------------

  async create(input: CreateInput): Promise<BackupResponse> {
    const instance = await this.fetchInstance(input.instanceId);
    const driver = this.drivers.get(instance.engine);
    const container = this.docker.getContainer(instance.containerName);

    await mkdir(this.paths.engineDir(instance.engine), { recursive: true, mode: 0o700 });
    await mkdir(this.paths.instanceDir(instance.engine, instance.name), {
      recursive: true,
      mode: 0o700,
    });

    const timestamp = Date.now();
    const filePath = this.paths.file({
      engine: instance.engine,
      instanceName: instance.name,
      timestamp,
      source: input.source,
      extension: driver.extension,
    });

    const retentionGroup = input.retentionGroup ?? null;
    const keepLastN = input.keepLastN ?? null;
    const startedAt = Date.now();

    try {
      const source = await driver.dump({ container, instance });
      const sink = createWriteStream(filePath, { mode: 0o600 });
      // decisions.md D6: mongo emits gzipped bytes natively; everyone
      // else streams raw bytes that we gzip on the host.
      if (driver.alreadyGzipped) {
        await pipeline(source, sink);
      } else {
        await pipeline(source, createGzip(), sink);
      }
      await chmod(filePath, 0o600);

      const fileStat = await stat(filePath);
      const durationMs = Date.now() - startedAt;

      const inserted = await this.db
        .insert(backups)
        .values({
          instanceId: instance.id,
          filePath,
          byteSize: fileStat.size,
          durationMs,
          source: input.source,
          retentionGroup,
          keepLastN,
          status: 'success',
          error: null,
        })
        .returning()
        .then((rows) => rows[0]);
      if (!inserted) throw new Error('insert returned no row');

      if (retentionGroup && keepLastN) {
        await this.pruneRetention(instance.id, retentionGroup, keepLastN);
      }

      this.logger.log(
        `backup created: instance=${instance.name} file=${basename(filePath)} size=${fileStat.size}B duration=${durationMs}ms source=${input.source}`,
      );
      return this.toResponse(inserted, instance);
    } catch (err) {
      // Best-effort cleanup of the partial file then record the
      // failure so the log centre + audit log surface it. The exception
      // still propagates so the API caller sees it.
      await unlink(filePath).catch(() => undefined);
      const message = err instanceof Error ? err.message : String(err);
      const durationMs = Date.now() - startedAt;
      await this.db
        .insert(backups)
        .values({
          instanceId: instance.id,
          filePath,
          byteSize: 0,
          durationMs,
          source: input.source,
          retentionGroup,
          keepLastN,
          status: 'failed',
          error: message.slice(0, 2000),
        })
        .returning()
        .catch((insertErr: unknown) =>
          this.logger.warn(
            `failed to record backup failure row: ${
              insertErr instanceof Error ? insertErr.message : String(insertErr)
            }`,
          ),
        );
      throw err;
    }
  }

  /**
   * Drop oldest successful backups in (instance_id, retention_group)
   * beyond `keepLastN`. Manual backups have retention_group=NULL and
   * are exempt from prune (decisions.md D5).
   *
   * Called synchronously at the end of every successful scheduled
   * backup. Errors are logged but never re-thrown — a prune failure
   * shouldn't fail the operator's backup.
   */
  private async pruneRetention(
    instanceId: number,
    retentionGroup: string,
    keepLastN: number,
  ): Promise<void> {
    try {
      const rows = await this.db
        .select()
        .from(backups)
        .where(
          and(
            eq(backups.instanceId, instanceId),
            eq(backups.retentionGroup, retentionGroup),
            eq(backups.status, 'success'),
          ),
        )
        .orderBy(desc(backups.createdAt));
      const surplus = rows.slice(keepLastN);
      for (const row of surplus) {
        await unlink(row.filePath).catch(() => undefined);
        await this.db.delete(backups).where(eq(backups.id, row.id));
      }
      if (surplus.length > 0) {
        this.logger.log(
          `retention prune: instance=${instanceId} group=${retentionGroup} dropped=${surplus.length}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `retention prune failed (instance=${instanceId} group=${retentionGroup}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // -------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------

  async list(query: ListBackupsQuery): Promise<ListResult> {
    const conditions = [] as ReturnType<typeof eq>[];
    if (query.instanceId !== undefined) {
      conditions.push(eq(backups.instanceId, query.instanceId));
    }
    if (query.cursor !== undefined) {
      conditions.push(lt(backups.id, query.cursor));
    }

    const rows = await this.db
      .select({ backup: backups, instance: dbInstances })
      .from(backups)
      .innerJoin(dbInstances, eq(backups.instanceId, dbInstances.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(backups.id))
      .limit(query.limit + 1);

    const items = rows
      .slice(0, query.limit)
      .map(({ backup, instance }) => this.toResponse(backup, instance));
    const last = rows[query.limit - 1];
    const nextCursor = rows.length > query.limit && last ? last.backup.id : null;
    return { items, nextCursor };
  }

  async get(id: number): Promise<BackupResponse> {
    const { backup, instance } = await this.fetchBackup(id);
    return this.toResponse(backup, instance);
  }

  // -------------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------------

  async delete(id: number): Promise<void> {
    const { backup } = await this.fetchBackup(id);
    // File first, then row — if we crash between the two the row
    // points at a missing file (UI handles this), which is recoverable.
    // The reverse order would leave an orphaned file on disk with no
    // panel surface to clean it up.
    await unlink(backup.filePath).catch(() => undefined);
    await this.db.delete(backups).where(eq(backups.id, id));
  }

  // -------------------------------------------------------------------
  // Restore — gunzip on host (except mongo) → driver.restore
  // -------------------------------------------------------------------

  async restore(input: RestoreInput): Promise<BackupResponse> {
    const { backup, instance } = await this.fetchBackup(input.backupId);
    if (input.confirm !== instance.name) {
      throw new BadRequestException({
        code: 'BACKUP_RESTORE_CONFIRM_MISMATCH',
        message: 'confirm string must match the target instance name',
      });
    }
    if (backup.status !== 'success') {
      throw new BadRequestException({
        code: 'BACKUP_NOT_RESTORABLE',
        message: `backup #${backup.id} has status=${backup.status}, cannot restore`,
      });
    }

    const driver = this.drivers.get(instance.engine);
    const container = this.docker.getContainer(instance.containerName);
    const fileStream = createReadStream(backup.filePath);
    // alreadyGzipped (mongo): pass the file straight to mongorestore,
    // which handles `--gzip` itself. Everyone else: gunzip on host.
    const stream = driver.alreadyGzipped
      ? fileStream
      : (fileStream.pipe(createGunzip()) as NodeJS.ReadableStream);

    await driver.restore({ container, instance, stream });
    this.logger.log(
      `restore: instance=${instance.name} from=${basename(backup.filePath)}`,
    );
    return this.toResponse(backup, instance);
  }

  // -------------------------------------------------------------------
  // Streaming download
  // -------------------------------------------------------------------

  async streamFile(id: number): Promise<DownloadStream> {
    const { backup } = await this.fetchBackup(id);
    const fileStat = await stat(backup.filePath).catch(() => null);
    if (!fileStat) {
      throw new NotFoundException({
        code: 'BACKUP_FILE_MISSING',
        message: `file for backup #${id} no longer exists on disk`,
      });
    }
    return {
      stream: createReadStream(backup.filePath),
      filename: basename(backup.filePath),
      byteSize: fileStat.size,
    };
  }

  // -------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------

  private async fetchInstance(id: number): Promise<DbInstance> {
    const row = await this.db
      .select()
      .from(dbInstances)
      .where(eq(dbInstances.id, id))
      .get();
    if (!row) {
      throw new NotFoundException({
        code: 'DB_INSTANCE_NOT_FOUND',
        message: `db instance ${id} not found`,
      });
    }
    return row;
  }

  private async fetchBackup(
    id: number,
  ): Promise<{ backup: Backup; instance: DbInstance }> {
    const row = await this.db
      .select({ backup: backups, instance: dbInstances })
      .from(backups)
      .innerJoin(dbInstances, eq(backups.instanceId, dbInstances.id))
      .where(eq(backups.id, id))
      .get();
    if (!row) {
      throw new NotFoundException({
        code: 'BACKUP_NOT_FOUND',
        message: `backup ${id} not found`,
      });
    }
    return row;
  }

  private toResponse(backup: Backup, instance: DbInstance): BackupResponse {
    return {
      id: backup.id,
      instanceId: backup.instanceId,
      instanceName: instance.name,
      engine: instance.engine,
      filePath: backup.filePath,
      byteSize: backup.byteSize,
      durationMs: backup.durationMs,
      source: backup.source,
      retentionGroup: backup.retentionGroup,
      keepLastN: backup.keepLastN,
      status: backup.status,
      error: backup.error,
      createdAt: backup.createdAt,
      updatedAt: backup.updatedAt,
    };
  }
}

