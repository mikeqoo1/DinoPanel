import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/db.module';
import { ContainersModule } from '../containers/containers.module';
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

/**
 * v0.5 backups module.
 *
 * Pulls in `DatabaseModule` for the drizzle handle and `ContainersModule`
 * for the dockerode DOCKER token. Both are re-exported `@Global`-style
 * by their owners so the imports here are purely for the boot graph.
 */
@Module({
  imports: [DatabaseModule, ContainersModule],
  controllers: [BackupsController, BackupsByDatabaseController],
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
