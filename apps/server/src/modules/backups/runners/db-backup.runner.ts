import { Injectable } from '@nestjs/common';
import { dbBackupPayloadSchema, type ScheduledTaskType } from '@dinopanel/shared';
import { failedResult, successResult, type RunResult, type TaskRunner } from '../../scheduler/task-runner';
import { BackupsService } from '../backups.service';

/**
 * Scheduler runner for the `db_backup` task type (v0.5 Phase 4).
 *
 * Lives under backups/ rather than scheduler/runners/ because it depends
 * on BackupsService — same locality reasoning as acme-renew.runner under
 * acme/. Registered with SchedulerService at BackupsModule bootstrap, not
 * via the SchedulerService constructor.
 *
 * The cron expression is carried on the task row's own `cron` column and
 * validated by the controller; it is intentionally NOT part of the
 * payload schema.
 */
@Injectable()
export class DbBackupTaskRunner implements TaskRunner {
  readonly type: ScheduledTaskType = 'db_backup';

  constructor(private readonly backups: BackupsService) {}

  async run(payload: unknown): Promise<RunResult> {
    const parsed = dbBackupPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return failedResult(`Invalid db_backup payload: ${parsed.error.message}`);
    }
    const { instanceId, retentionGroup, keepLastN } = parsed.data;
    try {
      // create() returns a success row, or records a failed row and
      // re-throws — so the catch below is the only failure path here.
      const backup = await this.backups.create({
        instanceId,
        source: 'scheduled',
        retentionGroup,
        keepLastN,
      });
      return successResult(
        `backup #${backup.id} ok: instance=${backup.instanceName} engine=${backup.engine} size=${backup.byteSize}B duration=${backup.durationMs}ms file=${backup.filePath}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return failedResult(`db_backup failed (instance ${instanceId}): ${msg}`);
    }
  }
}
