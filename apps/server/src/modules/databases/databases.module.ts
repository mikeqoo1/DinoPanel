import { Module } from '@nestjs/common';
import { DatabasesController } from './databases.controller';
import { DatabasesService } from './databases.service';
import { DbEngineRegistry } from './db-engine.registry';
import { MariadbDriver } from './engines/mariadb.driver';
import { MongoDriver } from './engines/mongo.driver';
import { MysqlDriver } from './engines/mysql.driver';
import { PostgresDriver } from './engines/postgres.driver';
import { RedisDriver } from './engines/redis.driver';

/**
 * Phase 1 module surface: bootstrap + read-only list. Phase 2 will
 * `imports: [ContainersModule]` for the dockerode service when
 * `DbInstancesService` (Phase 2 split-out) needs container lifecycle.
 */
@Module({
  controllers: [DatabasesController],
  providers: [
    DatabasesService,
    DbEngineRegistry,
    MysqlDriver,
    MariadbDriver,
    PostgresDriver,
    RedisDriver,
    MongoDriver,
  ],
  exports: [DatabasesService, DbEngineRegistry],
})
export class DatabasesModule {}
