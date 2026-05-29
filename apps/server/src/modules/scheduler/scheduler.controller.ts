import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UsePipes,
} from '@nestjs/common';
import { eq, lt, desc, and } from 'drizzle-orm';
import { Inject } from '@nestjs/common';
import {
  createScheduledTaskBodySchema,
  updateScheduledTaskBodySchema,
  cleanLogsPayloadSchema,
  dbBackupPayloadSchema,
  type CreateScheduledTaskBody,
  type UpdateScheduledTaskBody,
  type ScheduledTask,
} from '@dinopanel/shared';
import { DRIZZLE_DB, type Db } from '../../database/db.module';
import { scheduledTasks, scheduledRuns } from '../../database/schema';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { SchedulerService } from './scheduler.service';
import { CleanLogsTaskRunner } from './runners/clean-logs.runner';

@Controller('scheduler')
export class SchedulerController {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Db,
    private readonly scheduler: SchedulerService,
    private readonly cleanLogs: CleanLogsTaskRunner,
  ) {}

  @Get('tasks')
  async list(@Query('includeBuiltin') includeBuiltin?: string): Promise<ScheduledTask[]> {
    const rows = await this.db.select().from(scheduledTasks);
    const filtered = includeBuiltin === 'true' ? rows : rows.filter((r) => !r.builtin);
    return filtered.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      cron: r.cron,
      payload: r.payload,
      enabled: r.enabled,
      builtin: r.builtin,
      createdAt: r.createdAt,
      nextRunAt: r.enabled ? this.scheduler.nextRunAt(r.cron) : null,
    }));
  }

  @Post('tasks')
  @UsePipes(new ZodValidationPipe(createScheduledTaskBodySchema))
  async create(@Body() body: CreateScheduledTaskBody): Promise<ScheduledTask> {
    this.validateCronOrThrow(body.cron);
    this.validateTypePayload(body.type, body.payload);
    const inserted = await this.db
      .insert(scheduledTasks)
      .values({
        name: body.name,
        type: body.type,
        cron: body.cron,
        payload: body.payload as object,
        enabled: body.enabled,
        builtin: false,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error('Insert returned no row');
    await this.scheduler.register(row.id);
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      cron: row.cron,
      payload: row.payload,
      enabled: row.enabled,
      builtin: row.builtin,
      createdAt: row.createdAt,
      nextRunAt: row.enabled ? this.scheduler.nextRunAt(row.cron) : null,
    };
  }

  @Patch('tasks/:id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(updateScheduledTaskBodySchema)) body: UpdateScheduledTaskBody,
  ): Promise<ScheduledTask> {
    const existing = await this.db
      .select()
      .from(scheduledTasks)
      .where(eq(scheduledTasks.id, id))
      .limit(1);
    if (!existing[0]) throw new NotFoundException({ code: 'TASK_NOT_FOUND' });
    if (existing[0].builtin) {
      throw new BadRequestException({
        code: 'TASK_BUILTIN_IMMUTABLE',
        message: 'Built-in tasks cannot be edited',
      });
    }
    if (body.cron !== undefined) this.validateCronOrThrow(body.cron);
    if (body.type !== undefined && body.payload !== undefined) {
      this.validateTypePayload(body.type, body.payload);
    }
    await this.db
      .update(scheduledTasks)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.type !== undefined ? { type: body.type } : {}),
        ...(body.cron !== undefined ? { cron: body.cron } : {}),
        ...(body.payload !== undefined ? { payload: body.payload as object } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      })
      .where(eq(scheduledTasks.id, id));
    await this.scheduler.register(id);
    const reloaded = await this.db
      .select()
      .from(scheduledTasks)
      .where(eq(scheduledTasks.id, id))
      .limit(1);
    const r = reloaded[0]!;
    return {
      id: r.id,
      name: r.name,
      type: r.type,
      cron: r.cron,
      payload: r.payload,
      enabled: r.enabled,
      builtin: r.builtin,
      createdAt: r.createdAt,
      nextRunAt: r.enabled ? this.scheduler.nextRunAt(r.cron) : null,
    };
  }

  @Delete('tasks/:id')
  async remove(@Param('id', ParseIntPipe) id: number): Promise<{ ok: true }> {
    const existing = await this.db
      .select()
      .from(scheduledTasks)
      .where(eq(scheduledTasks.id, id))
      .limit(1);
    if (!existing[0]) throw new NotFoundException({ code: 'TASK_NOT_FOUND' });
    if (existing[0].builtin) {
      throw new BadRequestException({
        code: 'TASK_BUILTIN_IMMUTABLE',
        message: 'Built-in tasks cannot be deleted',
      });
    }
    this.scheduler.unregister(id);
    await this.db.delete(scheduledTasks).where(eq(scheduledTasks.id, id));
    return { ok: true };
  }

  @Post('tasks/:id/run')
  async runNow(@Param('id', ParseIntPipe) id: number): Promise<{ runId: number }> {
    const runId = await this.scheduler.runNow(id);
    return { runId };
  }

  @Get('tasks/:id/runs')
  async runs(
    @Param('id', ParseIntPipe) id: number,
    @Query('cursor') cursor?: string,
    @Query('limit') limitRaw?: string,
  ) {
    const limit = Math.min(Math.max(Number(limitRaw) || 50, 1), 200);
    const cursorTs = cursor ? Number(cursor) : null;
    const whereClause =
      cursorTs !== null
        ? and(eq(scheduledRuns.taskId, id), lt(scheduledRuns.startedAt, cursorTs))
        : eq(scheduledRuns.taskId, id);
    const rows = await this.db
      .select()
      .from(scheduledRuns)
      .where(whereClause)
      .orderBy(desc(scheduledRuns.startedAt))
      .limit(limit + 1);
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    const nextCursor = rows.length > limit && last ? String(last.startedAt) : null;
    return { items, nextCursor };
  }

  // -------------------------------------------------------------------------

  private validateCronOrThrow(expr: string): void {
    try {
      this.scheduler.validateCron(expr);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid cron expression';
      throw new BadRequestException({ code: 'BAD_REQUEST', message });
    }
  }

  private validateTypePayload(type: string, payload: unknown): void {
    if (type === 'clean_logs') {
      const parsed = cleanLogsPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        throw new BadRequestException({
          code: 'VALIDATION_FAILED',
          message: 'Invalid clean_logs payload',
          details: parsed.error.issues,
        });
      }
      // Path allowlist enforced at create time so bad tasks never persist.
      this.cleanLogs.assertPathAllowed(parsed.data.path);
    }
    // db_backup create-time validation. Reachable once Phase 5 adds
    // 'db_backup' to userFacingTaskTypeSchema (the body schema gates type
    // before this runs); landed here in Phase 4 alongside the runner.
    if (type === 'db_backup') {
      const parsed = dbBackupPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        throw new BadRequestException({
          code: 'VALIDATION_FAILED',
          message: 'Invalid db_backup payload',
          details: parsed.error.issues,
        });
      }
    }
  }
}
