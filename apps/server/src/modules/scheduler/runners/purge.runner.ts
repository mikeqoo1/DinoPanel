import { Inject, Injectable } from '@nestjs/common';
import { lt, eq, sql } from 'drizzle-orm';
import { purgePayloadSchema, type ScheduledTaskType } from '@dinopanel/shared';
import { DRIZZLE_DB, type Db } from '../../../database/db.module';
import { operationLog, settings } from '../../../database/schema';
import { failedResult, successResult, type RunResult, type TaskRunner } from '../task-runner';

export const AUDIT_RETENTION_DAYS_KEY = 'audit.retentionDays';
export const DEFAULT_AUDIT_RETENTION_DAYS = 30;

/**
 * Built-in dogfood runner: deletes operation_log rows older than the
 * configured retention. Registered automatically at boot under the
 * `system.purge_operation_log` task — hidden from the user-facing CRUD.
 */
@Injectable()
export class PurgeTaskRunner implements TaskRunner {
  readonly type: ScheduledTaskType = 'purge';

  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  async run(payload: unknown): Promise<RunResult> {
    const parsed = purgePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return failedResult(`Invalid purge payload: ${parsed.error.message}`);
    }
    const days = await this.readRetentionDays();
    const cutoff = Date.now() - days * 86_400_000;
    try {
      const before = await this.db
        .select({ n: sql<number>`count(*)` })
        .from(operationLog);
      await this.db.delete(operationLog).where(lt(operationLog.createdAt, cutoff));
      const after = await this.db
        .select({ n: sql<number>`count(*)` })
        .from(operationLog);
      const deleted = (before[0]?.n ?? 0) - (after[0]?.n ?? 0);
      return successResult(`retention=${days}d, deleted=${deleted}, kept=${after[0]?.n ?? 0}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return failedResult(`purge failed: ${msg}`);
    }
  }

  private async readRetentionDays(): Promise<number> {
    const row = await this.db
      .select()
      .from(settings)
      .where(eq(settings.key, AUDIT_RETENTION_DAYS_KEY))
      .limit(1);
    if (!row[0]) return DEFAULT_AUDIT_RETENTION_DAYS;
    const n = Number(row[0].value);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_AUDIT_RETENTION_DAYS;
    return Math.floor(n);
  }
}
