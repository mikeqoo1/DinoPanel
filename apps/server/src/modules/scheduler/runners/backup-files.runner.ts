import { Injectable } from '@nestjs/common';
import { join } from 'node:path';
import { backupFilesPayloadSchema, type ScheduledTaskType } from '@dinopanel/shared';
import { FilesService } from '../../files/files.service';
import { failedResult, successResult, type RunResult, type TaskRunner } from '../task-runner';

@Injectable()
export class BackupFilesTaskRunner implements TaskRunner {
  readonly type: ScheduledTaskType = 'backup_files';

  constructor(private readonly files: FilesService) {}

  async run(payload: unknown): Promise<RunResult> {
    const parsed = backupFilesPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return failedResult(`Invalid backup_files payload: ${parsed.error.message}`);
    }
    const { sources, targetDir } = parsed.data;
    const stamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .replace(/Z$/, '');
    const dest = join(targetDir, `backup-${stamp}.tar.gz`);
    try {
      await this.files.compressToDisk(sources, dest, 'tar.gz');
      return successResult(`Archive written: ${dest}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return failedResult(`compressToDisk failed: ${msg}`);
    }
  }
}
