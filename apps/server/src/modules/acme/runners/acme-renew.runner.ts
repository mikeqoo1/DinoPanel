import { Inject, Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { and, isNotNull, lt } from 'drizzle-orm';
import type { ScheduledTaskType } from '@dinopanel/shared';
import { DRIZZLE_DB, type Db } from '../../../database/db.module';
import { sites } from '../../../database/schema';
import {
  failedResult,
  successResult,
  type RunResult,
  type TaskRunner,
} from '../../scheduler/task-runner';
import { AcmeOrchestratorService } from '../acme-orchestrator.service';

const RENEW_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

interface AcmeRenewPayload {
  /** Override the default 30-day window if needed. */
  renewWithinDays?: number;
}

@Injectable()
export class AcmeRenewTaskRunner implements TaskRunner {
  readonly type: ScheduledTaskType = 'acme_renew';

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Db,
    private readonly orchestrator: AcmeOrchestratorService,
    private readonly logger: Logger,
  ) {}

  async run(payload: unknown): Promise<RunResult> {
    const window =
      isAcmeRenewPayload(payload) && payload.renewWithinDays !== undefined
        ? payload.renewWithinDays
        : RENEW_WINDOW_DAYS;
    const cutoff = Date.now() + window * DAY_MS;

    const candidates = await this.db
      .select()
      .from(sites)
      .where(
        and(
          isNotNull(sites.certExpiresAt),
          lt(sites.certExpiresAt, cutoff),
        ),
      );

    if (candidates.length === 0) {
      return successResult(`No certs expiring within ${window} days`);
    }

    const lines: string[] = [
      `Renew sweep: ${candidates.length} site(s) within ${window}d of expiry`,
    ];
    let failures = 0;
    for (const site of candidates) {
      try {
        const result = await this.orchestrator.renew(site.id);
        lines.push(
          `  ✓ site=${site.id} (${site.name}) new expiry ${new Date(
            result.expiresAt,
          ).toISOString()}`,
        );
      } catch (err) {
        failures++;
        const msg = err instanceof Error ? err.message : String(err);
        lines.push(`  ✗ site=${site.id} (${site.name}) ${msg}`);
        this.logger.warn({ err, siteId: site.id }, 'acme.renew.site_failed');
      }
    }

    return failures === 0
      ? successResult(lines.join('\n'))
      : failedResult(
          lines.join('\n'),
          // exitCode-like signal: number of failures
          failures,
        );
  }
}

function isAcmeRenewPayload(v: unknown): v is AcmeRenewPayload {
  return typeof v === 'object' && v !== null;
}

/** Stable task name for the builtin renew job. */
export const ACME_RENEW_TASK_NAME = 'system.acme_renew';
/** Default cron expression: every 12 hours. */
export const ACME_RENEW_TASK_CRON = '0 */12 * * *';
