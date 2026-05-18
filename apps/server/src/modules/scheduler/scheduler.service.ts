import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { DRIZZLE_DB, type Db } from '../../database/db.module';

/**
 * Skeleton for the in-process scheduler. Phase 2 fills in:
 *   - node-cron integration in register/unregister
 *   - 5 TaskRunner implementations
 *   - built-in `purge` runner + bootstrap row
 *   - REST surface
 *
 * For Phase 1 the service exists so other modules (AuthService, future
 * AuditInterceptor.purge, etc.) can inject it and the wiring is real even
 * though run-time scheduling is a no-op.
 */
@Injectable()
export class SchedulerService implements OnApplicationBootstrap {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Db,
    private readonly logger: Logger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Phase 2 will load enabled scheduled_tasks rows and register them with
    // node-cron here. For now the table is empty on a fresh install.
    this.logger.debug({}, 'scheduler.bootstrap.skeleton');
    await this.loadFromDb();
  }

  register(taskId: number): void {
    this.logger.debug({ taskId }, 'scheduler.register.stub');
  }

  unregister(taskId: number): void {
    this.logger.debug({ taskId }, 'scheduler.unregister.stub');
  }

  async runNow(taskId: number): Promise<void> {
    this.logger.debug({ taskId }, 'scheduler.runNow.stub');
  }

  async loadFromDb(): Promise<void> {
    // Phase 2: SELECT enabled tasks, register each.
    // Phase 2: mark scheduled_runs WHERE status='running' as aborted.
  }

  // Silence "unused private member" in the skeleton phase.
  protected dbRef(): Db {
    return this.db;
  }
}
