import { Inject, Injectable } from '@nestjs/common';
import { desc, lt, eq, and, like, gte, lte, type SQL } from 'drizzle-orm';
import type { OperationLogEntry } from '@dinopanel/shared';
import { DRIZZLE_DB, type Db } from '../../../database/db.module';
import { operationLog } from '../../../database/schema';

export interface OperationLogFilter {
  cursor?: string;
  limit?: number;
  userId?: number;
  pathLike?: string;
  status?: number;
  from?: number;
  to?: number;
}

@Injectable()
export class OperationLogReader {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  async read(filter: OperationLogFilter): Promise<{ items: OperationLogEntry[]; nextCursor: string | null }> {
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
    const conditions: SQL[] = [];
    if (filter.cursor) {
      const cursorTs = Number(filter.cursor);
      if (Number.isFinite(cursorTs)) conditions.push(lt(operationLog.createdAt, cursorTs));
    }
    if (filter.userId !== undefined) conditions.push(eq(operationLog.userId, filter.userId));
    if (filter.pathLike) conditions.push(like(operationLog.path, `%${filter.pathLike}%`));
    if (filter.status !== undefined) conditions.push(eq(operationLog.statusCode, filter.status));
    if (filter.from !== undefined) conditions.push(gte(operationLog.createdAt, filter.from));
    if (filter.to !== undefined) conditions.push(lte(operationLog.createdAt, filter.to));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const rows = await this.db
      .select()
      .from(operationLog)
      .where(where)
      .orderBy(desc(operationLog.createdAt))
      .limit(limit + 1);
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    const nextCursor = rows.length > limit && last ? String(last.createdAt) : null;
    return { items, nextCursor };
  }
}
