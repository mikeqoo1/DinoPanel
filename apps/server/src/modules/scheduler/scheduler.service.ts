import {
  Inject,
  Injectable,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { eq, sql, and, isNull } from 'drizzle-orm';
import * as cron from 'node-cron';
import { CronExpressionParser } from 'cron-parser';
import type { ScheduledTaskType } from '@dinopanel/shared';
import { DRIZZLE_DB, type Db } from '../../database/db.module';
import { scheduledTasks, scheduledRuns } from '../../database/schema';
import { ShellTaskRunner } from './runners/shell.runner';
import { BackupFilesTaskRunner } from './runners/backup-files.runner';
import { CleanLogsTaskRunner } from './runners/clean-logs.runner';
import { RestartServiceTaskRunner } from './runners/restart-service.runner';
import { HttpRequestTaskRunner } from './runners/http-request.runner';
import { PurgeTaskRunner } from './runners/purge.runner';
import type { TaskRunner } from './task-runner';

type CronHandle = ReturnType<typeof cron.schedule>;

interface RegisteredEntry {
  handle: CronHandle;
}

const BUILTIN_PURGE_NAME = 'system.purge_operation_log';
const BUILTIN_PURGE_CRON = '15 3 * * *';

@Injectable()
export class SchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly runners: Map<ScheduledTaskType, TaskRunner>;
  private readonly entries = new Map<number, RegisteredEntry>();

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Db,
    private readonly logger: Logger,
    shell: ShellTaskRunner,
    backup: BackupFilesTaskRunner,
    cleanLogs: CleanLogsTaskRunner,
    restart: RestartServiceTaskRunner,
    http: HttpRequestTaskRunner,
    purge: PurgeTaskRunner,
  ) {
    this.runners = new Map<ScheduledTaskType, TaskRunner>([
      ['shell', shell],
      ['backup_files', backup],
      ['clean_logs', cleanLogs],
      ['restart_service', restart],
      ['http_request', http],
      ['purge', purge],
    ]);
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.abortStaleRunningRuns();
    await this.ensureBuiltins();
    // NOTE: loadFromDb runs AFTER this.ensureBuiltins() but does not pick
    // up rows inserted by other modules (e.g. AcmeModule) whose bootstrap
    // runs later. Those modules must call `ensureBuiltinTask` then
    // `register(taskId)` themselves — see `system.acme_renew` in
    // `AcmeModule`.
    await this.loadFromDb();
  }

  onModuleDestroy(): void {
    for (const [, entry] of this.entries) entry.handle.stop();
    this.entries.clear();
  }

  /**
   * Validate a cron string. Returns the parsed expression on success;
   * throws on failure so controllers can map to 400.
   */
  validateCron(expr: string): void {
    try {
      CronExpressionParser.parse(expr);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Invalid cron expression: ${msg}`);
    }
  }

  nextRunAt(expr: string): number | null {
    try {
      const it = CronExpressionParser.parse(expr);
      return it.next().getTime();
    } catch {
      return null;
    }
  }

  async register(taskId: number): Promise<void> {
    const existing = this.entries.get(taskId);
    if (existing) {
      existing.handle.stop();
      this.entries.delete(taskId);
    }
    const row = await this.db
      .select()
      .from(scheduledTasks)
      .where(eq(scheduledTasks.id, taskId))
      .limit(1);
    const task = row[0];
    if (!task || !task.enabled) return;
    if (!cron.validate(task.cron)) {
      this.logger.warn({ taskId, cron: task.cron }, 'scheduler.invalid_cron_skipped');
      return;
    }
    const handle = cron.schedule(task.cron, () => {
      void this.executeTask(taskId);
    });
    this.entries.set(taskId, { handle });
  }

  unregister(taskId: number): void {
    const entry = this.entries.get(taskId);
    if (!entry) return;
    entry.handle.stop();
    this.entries.delete(taskId);
  }

  async runNow(taskId: number): Promise<number> {
    const row = await this.db
      .select()
      .from(scheduledTasks)
      .where(eq(scheduledTasks.id, taskId))
      .limit(1);
    if (!row[0]) throw new NotFoundException({ code: 'TASK_NOT_FOUND' });
    return this.executeTask(taskId);
  }

  async loadFromDb(): Promise<void> {
    const rows = await this.db
      .select({ id: scheduledTasks.id })
      .from(scheduledTasks)
      .where(eq(scheduledTasks.enabled, true));
    for (const row of rows) {
      await this.register(row.id);
    }
    this.logger.debug({ count: rows.length }, 'scheduler.loaded');
  }

  private async executeTask(taskId: number): Promise<number> {
    const row = await this.db
      .select()
      .from(scheduledTasks)
      .where(eq(scheduledTasks.id, taskId))
      .limit(1);
    const task = row[0];
    if (!task) {
      this.logger.warn({ taskId }, 'scheduler.execute.task_missing');
      throw new NotFoundException({ code: 'TASK_NOT_FOUND' });
    }
    const runner = this.runners.get(task.type);
    if (!runner) {
      this.logger.error({ taskId, type: task.type }, 'scheduler.execute.no_runner');
      throw new Error(`No runner registered for type ${task.type}`);
    }

    const startedAt = Date.now();
    const inserted = await this.db
      .insert(scheduledRuns)
      .values({
        taskId,
        startedAt,
        status: 'running',
      })
      .returning({ id: scheduledRuns.id });
    const runId = inserted[0]?.id;
    if (runId === undefined) {
      throw new Error('Failed to insert scheduled_runs row');
    }

    let result;
    try {
      result = await runner.run(task.payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result = { status: 'failed' as const, exitCode: null, output: `Uncaught: ${msg}` };
    }
    await this.db
      .update(scheduledRuns)
      .set({
        finishedAt: Date.now(),
        status: result.status,
        exitCode: result.exitCode,
        output: result.output,
      })
      .where(eq(scheduledRuns.id, runId));
    return runId;
  }

  private async abortStaleRunningRuns(): Promise<void> {
    await this.db
      .update(scheduledRuns)
      .set({
        status: 'aborted',
        finishedAt: Date.now(),
        output: sql`coalesce(${scheduledRuns.output}, '') || '\n[aborted: server_restart]'`,
      })
      .where(
        and(eq(scheduledRuns.status, 'running'), isNull(scheduledRuns.finishedAt)),
      );
  }

  /**
   * Allow other modules to plug in their own runners. Used by AcmeModule
   * to register `acme_renew` without forcing SchedulerModule to import it
   * (which would create a circular dependency since AcmeModule already
   * imports SchedulerModule).
   */
  registerRunner(type: ScheduledTaskType, runner: TaskRunner): void {
    if (this.runners.has(type)) {
      throw new Error(`Runner for type "${type}" already registered`);
    }
    this.runners.set(type, runner);
  }

  /**
   * Idempotent builtin-task upsert callable from other modules during
   * their own bootstrap. Returns the row id either way so the caller can
   * follow up with `register(id)` to wire the cron handle.
   */
  async ensureBuiltinTask(args: {
    name: string;
    cron: string;
    type: ScheduledTaskType;
    payload: unknown;
  }): Promise<number> {
    const existing = await this.db
      .select({ id: scheduledTasks.id })
      .from(scheduledTasks)
      .where(eq(scheduledTasks.name, args.name))
      .limit(1);
    if (existing[0]) return existing[0].id;
    const inserted = await this.db
      .insert(scheduledTasks)
      .values({
        name: args.name,
        type: args.type,
        cron: args.cron,
        payload: args.payload,
        enabled: true,
        builtin: true,
      })
      .returning({ id: scheduledTasks.id });
    const row = inserted[0];
    if (!row) throw new Error('ensureBuiltinTask insert returned no row');
    return row.id;
  }

  private async ensureBuiltins(): Promise<void> {
    const existing = await this.db
      .select({ id: scheduledTasks.id })
      .from(scheduledTasks)
      .where(eq(scheduledTasks.name, BUILTIN_PURGE_NAME))
      .limit(1);
    if (existing[0]) return;
    await this.db.insert(scheduledTasks).values({
      name: BUILTIN_PURGE_NAME,
      type: 'purge',
      cron: BUILTIN_PURGE_CRON,
      payload: { table: 'operation_log' },
      enabled: true,
      builtin: true,
    });
  }
}
