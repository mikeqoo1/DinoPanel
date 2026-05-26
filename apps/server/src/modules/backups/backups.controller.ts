import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
  createBackupBodySchema,
  listBackupsQuerySchema,
  restoreBackupBodySchema,
  type BackupResponse,
  type CreateBackupBody,
  type ListBackupsQuery,
  type RestoreBackupBody,
} from '@dinopanel/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { BackupsService } from './backups.service';

/**
 * Controller for /api/backups — list-all + delete + restore + download.
 * Per-database create/list lives on `BackupsByDatabaseController` so
 * the URL shape matches the v0.4 databases module (`/api/databases/:id/<thing>`).
 */
@Controller('backups')
export class BackupsController {
  constructor(private readonly backups: BackupsService) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(listBackupsQuerySchema)) query: ListBackupsQuery,
  ): Promise<{ items: BackupResponse[]; nextCursor: number | null }> {
    return this.backups.list(query);
  }

  @Delete(':backupId')
  @HttpCode(204)
  async delete(@Param('backupId', ParseIntPipe) backupId: number): Promise<void> {
    await this.backups.delete(backupId);
  }

  @Post(':backupId/restore')
  async restore(
    @Param('backupId', ParseIntPipe) backupId: number,
    @Body(new ZodValidationPipe(restoreBackupBodySchema)) body: RestoreBackupBody,
  ): Promise<BackupResponse> {
    return this.backups.restore({ backupId, confirm: body.confirm });
  }

  @Get(':backupId/download')
  async download(
    @Param('backupId', ParseIntPipe) backupId: number,
    @Res({ passthrough: false }) res: FastifyReply,
  ): Promise<unknown> {
    const { stream, filename, byteSize } = await this.backups.streamFile(backupId);
    res.header(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(filename)}"`,
    );
    res.header('Content-Type', 'application/gzip');
    res.header('Content-Length', String(byteSize));
    return res.send(stream);
  }
}

/**
 * Sub-controller for /api/databases/:id/backups so the URL shape
 * mirrors how v0.4's databases controller layered metrics + sub-resources.
 */
@Controller('databases/:id/backups')
export class BackupsByDatabaseController {
  constructor(private readonly backups: BackupsService) {}

  @Get()
  async listForInstance(
    @Param('id', ParseIntPipe) instanceId: number,
  ): Promise<{ items: BackupResponse[]; nextCursor: number | null }> {
    return this.backups.list({ instanceId, limit: 200 });
  }

  @Post()
  async create(
    @Param('id', ParseIntPipe) instanceId: number,
    @Body(new ZodValidationPipe(createBackupBodySchema)) body: CreateBackupBody,
  ): Promise<BackupResponse> {
    return this.backups.create({
      instanceId,
      source: 'manual',
      retentionGroup: body.retentionGroup ?? null,
      keepLastN: body.keepLastN ?? null,
    });
  }
}
