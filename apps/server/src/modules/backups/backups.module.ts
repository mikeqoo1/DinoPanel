import { Module } from '@nestjs/common';
import { BackupsController } from './backups.controller';
import { BackupsService } from './backups.service';
import { BackupDriverRegistry } from './backup-driver.registry';
import { MariadbBackupDriver } from './drivers/mariadb.backup-driver';
import { MongodbBackupDriver } from './drivers/mongodb.backup-driver';
import { MysqlBackupDriver } from './drivers/mysql.backup-driver';
import { PostgresqlBackupDriver } from './drivers/postgresql.backup-driver';
import { RedisBackupDriver } from './drivers/redis.backup-driver';

/**
 * v0.5 backups module — Phase 1 skeleton.
 *
 * Phase 3+ will pull in DatabaseModule (drizzle handle) and
 * ContainersModule (dockerode DOCKER token) — left out of Phase 1
 * to keep the boot graph minimal until those services exist.
 */
@Module({
  controllers: [BackupsController],
  providers: [
    BackupsService,
    BackupDriverRegistry,
    MysqlBackupDriver,
    MariadbBackupDriver,
    PostgresqlBackupDriver,
    RedisBackupDriver,
    MongodbBackupDriver,
  ],
  exports: [BackupsService, BackupDriverRegistry],
})
export class BackupsModule {}
