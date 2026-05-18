import { Inject, Injectable } from '@nestjs/common';
import { desc, lt, eq, and, type SQL } from 'drizzle-orm';
import type { LoginLogEntry } from '@dinopanel/shared';
import { DRIZZLE_DB, type Db } from '../../../database/db.module';
import { loginAttempts } from '../../../database/schema';

export interface LoginLogFilter {
  cursor?: string;
  limit?: number;
  username?: string;
  result?: 'success' | 'fail';
}

@Injectable()
export class LoginLogReader {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  async read(filter: LoginLogFilter): Promise<{ items: LoginLogEntry[]; nextCursor: string | null }> {
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
    const conditions: SQL[] = [];
    if (filter.cursor) {
      const cursorTs = Number(filter.cursor);
      if (Number.isFinite(cursorTs)) conditions.push(lt(loginAttempts.createdAt, cursorTs));
    }
    if (filter.username) conditions.push(eq(loginAttempts.username, filter.username));
    if (filter.result) conditions.push(eq(loginAttempts.result, filter.result));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const rows = await this.db
      .select()
      .from(loginAttempts)
      .where(where)
      .orderBy(desc(loginAttempts.createdAt))
      .limit(limit + 1);
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    const nextCursor = rows.length > limit && last ? String(last.createdAt) : null;
    return { items, nextCursor };
  }
}
