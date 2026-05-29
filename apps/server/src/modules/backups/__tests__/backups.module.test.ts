import { describe, it, expect, vi } from 'vitest';
import { BackupsModule } from '../backups.module';
import { DbBackupTaskRunner } from '../runners/db-backup.runner';
import type { SchedulerService } from '../../scheduler/scheduler.service';

function makeModule(registerRunner: ReturnType<typeof vi.fn>) {
  const scheduler = { registerRunner } as unknown as SchedulerService;
  const runner = new DbBackupTaskRunner({} as never);
  const logger = { debug: vi.fn(), error: vi.fn() };
  return {
    module: new BackupsModule(scheduler, runner, logger as never),
    runner,
    logger,
  };
}

describe('BackupsModule bootstrap', () => {
  it('registers the db_backup runner with the scheduler', () => {
    const registerRunner = vi.fn();
    const { module, runner } = makeModule(registerRunner);
    module.onApplicationBootstrap();
    expect(registerRunner).toHaveBeenCalledTimes(1);
    expect(registerRunner).toHaveBeenCalledWith('db_backup', runner);
  });

  it('tolerates an already-registered runner (dev hot-reload) without throwing', () => {
    const registerRunner = vi.fn(() => {
      throw new Error('Runner for type "db_backup" already registered');
    });
    const { module, logger } = makeModule(registerRunner);
    expect(() => module.onApplicationBootstrap()).not.toThrow();
    expect(logger.debug).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('rethrows an unexpected registration failure loudly (not silent)', () => {
    const registerRunner = vi.fn(() => {
      throw new Error('scheduler unavailable');
    });
    const { module, logger } = makeModule(registerRunner);
    expect(() => module.onApplicationBootstrap()).toThrow('scheduler unavailable');
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
