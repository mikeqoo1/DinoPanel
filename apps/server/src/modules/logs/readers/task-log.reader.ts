import { Inject, Injectable } from '@nestjs/common';
import { desc, lt, eq, and, type SQL } from 'drizzle-orm';
import type { ScheduledRun, ScheduledRunStatus } from '@dinopanel/shared';
import { DRIZZLE_DB, type Db } from '../../../database/db.module';
import { scheduledRuns } from '../../../database/schema';

export interface TaskLogFilter {
  cursor?: string;
  limit?: number;
  taskId?: number;
  status?: ScheduledRunStatus;
}

@Injectable()
export class TaskLogReader {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  async read(filter: TaskLogFilter): Promise<{ items: ScheduledRun[]; nextCursor: string | null }> {
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
    const conditions: SQL[] = [];
    if (filter.cursor) {
      const cursorTs = Number(filter.cursor);
      if (Number.isFinite(cursorTs)) conditions.push(lt(scheduledRuns.startedAt, cursorTs));
    }
    if (filter.taskId !== undefined) conditions.push(eq(scheduledRuns.taskId, filter.taskId));
    if (filter.status) conditions.push(eq(scheduledRuns.status, filter.status));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const rows = await this.db
      .select()
      .from(scheduledRuns)
      .where(where)
      .orderBy(desc(scheduledRuns.startedAt))
      .limit(limit + 1);
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    const nextCursor = rows.length > limit && last ? String(last.startedAt) : null;
    return { items, nextCursor };
  }
}
