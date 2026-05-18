import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE_DB, type Db } from '../../database/db.module';
import { settings } from '../../database/schema';

export const AUDIT_RETENTION_DAYS_KEY = 'audit.retentionDays';
export const DEFAULT_AUDIT_RETENTION_DAYS = 30;
const MIN_DAYS = 1;
const MAX_DAYS = 365;

@Injectable()
export class AuditService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  async getRetentionDays(): Promise<number> {
    const row = await this.db
      .select()
      .from(settings)
      .where(eq(settings.key, AUDIT_RETENTION_DAYS_KEY))
      .limit(1);
    if (!row[0]) return DEFAULT_AUDIT_RETENTION_DAYS;
    const n = Number(row[0].value);
    if (!Number.isFinite(n) || n < MIN_DAYS) return DEFAULT_AUDIT_RETENTION_DAYS;
    return Math.floor(n);
  }

  async setRetentionDays(days: number): Promise<number> {
    const clamped = Math.max(MIN_DAYS, Math.min(MAX_DAYS, Math.floor(days)));
    const stringified = String(clamped);
    await this.db
      .insert(settings)
      .values({ key: AUDIT_RETENTION_DAYS_KEY, value: stringified })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: stringified, updatedAt: Date.now() },
      });
    return clamped;
  }
}
