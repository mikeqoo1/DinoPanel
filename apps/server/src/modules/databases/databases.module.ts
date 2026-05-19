import { Module } from '@nestjs/common';
import { ContainersModule } from '../containers/containers.module';
import { DatabasesController } from './databases.controller';
import { DatabasesService } from './databases.service';
import { DbEngineRegistry } from './db-engine.registry';
import { DbInstancesService } from './db-instances.service';
import { MariadbDriver } from './engines/mariadb.driver';
import { MongoDriver } from './engines/mongo.driver';
import { MysqlDriver } from './engines/mysql.driver';
import { PostgresDriver } from './engines/postgres.driver';
import { RedisDriver } from './engines/redis.driver';

@Module({
  // ContainersModule re-exports the DOCKER dockerode injection token
  // — DbInstancesService injects it for container lifecycle.
  imports: [ContainersModule],
  controllers: [DatabasesController],
  providers: [
    DatabasesService,
    DbInstancesService,
    DbEngineRegistry,
    MysqlDriver,
    MariadbDriver,
    PostgresDriver,
    RedisDriver,
    MongoDriver,
  ],
  exports: [DatabasesService, DbInstancesService, DbEngineRegistry],
})
export class DatabasesModule {}
