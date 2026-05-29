import { Module, OnApplicationBootstrap } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { DatabaseModule } from '../../database/db.module';
import { ContainersModule } from '../containers/containers.module';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { SchedulerService } from '../scheduler/scheduler.service';
import {
  BackupsByDatabaseController,
  BackupsController,
} from './backups.controller';
import { BackupsService } from './backups.service';
import { BackupDriverRegistry } from './backup-driver.registry';
import { MariadbBackupDriver } from './drivers/mariadb.backup-driver';
import { MongodbBackupDriver } from './drivers/mongodb.backup-driver';
import { MysqlBackupDriver } from './drivers/mysql.backup-driver';
import { PostgresqlBackupDriver } from './drivers/postgresql.backup-driver';
import { RedisBackupDriver } from './drivers/redis.backup-driver';
import { DbBackupTaskRunner } from './runners/db-backup.runner';

/**
 * v0.5 backups module.
 *
 * Pulls in `DatabaseModule` for the drizzle handle and `ContainersModule`
 * for the dockerode DOCKER token. Both are re-exported `@Global`-style
 * by their owners so the imports here are purely for the boot graph.
 */
@Module({
  imports: [DatabaseModule, ContainersModule, SchedulerModule],
  controllers: [BackupsController, BackupsByDatabaseController],
  providers: [
    BackupsService,
    BackupDriverRegistry,
    MysqlBackupDriver,
    MariadbBackupDriver,
    PostgresqlBackupDriver,
    RedisBackupDriver,
    MongodbBackupDriver,
    DbBackupTaskRunner,
  ],
  exports: [BackupsService, BackupDriverRegistry],
})
export class BackupsModule implements OnApplicationBootstrap {
  constructor(
    private readonly scheduler: SchedulerService,
    private readonly dbBackupRunner: DbBackupTaskRunner,
    private readonly logger: Logger,
  ) {}

  onApplicationBootstrap(): void {
    // Register the runner so SchedulerService.executeTask can dispatch to
    // it when a `db_backup` cron fires. Unlike acme_renew there is no
    // builtin task row — db_backup tasks are user-created via /scheduler.
    try {
      this.scheduler.registerRunner('db_backup', this.dbBackupRunner);
    } catch (err) {
      // registerRunner only throws when the type is already registered —
      // expected on dev hot-reload, so swallow that. Any other failure is
      // an unexpected wiring break: surface it loudly rather than let the
      // runner silently go missing until a db_backup cron fires.
      const alreadyRegistered =
        err instanceof Error && err.message.includes('already registered');
      if (!alreadyRegistered) {
        this.logger.error({ err }, 'backups.bootstrap.runner_registration_failed');
        throw err;
      }
      this.logger.debug({ err }, 'backups.bootstrap.runner_already_registered');
    }
  }
}
