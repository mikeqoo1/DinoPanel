import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'node:fs';
import { join, resolve as resolvePath, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { cleanLogsPayloadSchema, type ScheduledTaskType } from '@dinopanel/shared';
import type { AppConfig } from '../../../config/configuration';
import { failedResult, successResult, type RunResult, type TaskRunner } from '../task-runner';

@Injectable()
export class CleanLogsTaskRunner implements TaskRunner {
  readonly type: ScheduledTaskType = 'clean_logs';

  constructor(private readonly config: ConfigService<{ app: AppConfig }>) {}

  /**
   * Validate that `path` resolves under one of the allowed prefixes. Throws
   * BadRequestException at task-create time; callers should invoke this
   * before persisting the task row.
   */
  assertPathAllowed(path: string): void {
    const allowed = this.allowedPrefixes();
    const abs = isAbsolute(path) ? resolvePath(path) : resolvePath(process.cwd(), path);
    const ok = allowed.some((prefix) => abs === prefix || abs.startsWith(prefix + '/'));
    if (!ok) {
      throw new BadRequestException({
        code: 'CLEAN_LOGS_PATH_NOT_ALLOWED',
        message: `Path must start with one of: ${allowed.join(', ')}`,
      });
    }
  }

  async run(payload: unknown): Promise<RunResult> {
    const parsed = cleanLogsPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return failedResult(`Invalid clean_logs payload: ${parsed.error.message}`);
    }
    const { path, olderThanDays } = parsed.data;
    try {
      this.assertPathAllowed(path);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return failedResult(msg);
    }

    const cutoff = Date.now() - olderThanDays * 86_400_000;
    let deleted = 0;
    let skipped = 0;
    try {
      const entries = await fs.readdir(path);
      for (const name of entries) {
        const full = join(path, name);
        const stat = await fs.stat(full).catch(() => null);
        if (!stat || !stat.isFile()) {
          skipped++;
          continue;
        }
        if (stat.mtimeMs < cutoff) {
          await fs.unlink(full).catch(() => undefined);
          deleted++;
        }
      }
      return successResult(`deleted=${deleted}, skipped=${skipped}, under=${path}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return failedResult(`clean_logs failed: ${msg}`);
    }
  }

  private allowedPrefixes(): string[] {
    const cfg = this.config.get<AppConfig>('app', { infer: true });
    const dataDir =
      cfg?.env.DATA_DIR && (isAbsolute(cfg.env.DATA_DIR)
        ? cfg.env.DATA_DIR
        : resolvePath(process.cwd(), cfg.env.DATA_DIR));
    const home = homedir();
    return [
      '/var/log',
      '/tmp',
      ...(dataDir ? [dataDir] : []),
      join(home, 'dinopanel/logs'),
    ];
  }
}
