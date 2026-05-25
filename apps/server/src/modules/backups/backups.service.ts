import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir } from 'node:fs/promises';
import type { AppConfig } from '../../config/configuration';
import { resolveBackupsPaths, type BackupsPaths } from './paths';

/**
 * Phase 1 service — owns BACKUPS_ROOT bootstrap (mkdir mode 0700) and
 * the `list()` stub the controller returns. Real list / create / delete
 * / restore / download / retention prune land in Phase 3.
 *
 * decisions.md D2 + spec.md §Filesystem: `<root>/` mode 0700 root.
 */
@Injectable()
export class BackupsService implements OnModuleInit {
  private readonly logger = new Logger(BackupsService.name);
  readonly paths: BackupsPaths;

  constructor(private readonly config: ConfigService) {
    const appCfg = this.config.getOrThrow<AppConfig>('app');
    this.paths = resolveBackupsPaths(appCfg.env.BACKUPS_ROOT);
  }

  async onModuleInit(): Promise<void> {
    try {
      await mkdir(this.paths.root, { recursive: true, mode: 0o700 });
    } catch (err) {
      // Don't crash boot — a non-writable BACKUPS_ROOT only matters
      // when an operator triggers create/restore. Log loudly so the
      // misconfiguration surfaces in the log centre.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to bootstrap BACKUPS_ROOT (${this.paths.root}): ${message}`,
      );
    }
  }

  /** Phase 1: always empty. Phase 3 returns backups[] from sqlite. */
  async list(): Promise<unknown[]> {
    return [];
  }
}
