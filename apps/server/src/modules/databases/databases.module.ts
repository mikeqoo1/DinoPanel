import { Module } from '@nestjs/common';
import { ContainersModule } from '../containers/containers.module';
import { MonitoringModule } from '../monitoring/monitoring.module';
import { DatabasesController } from './databases.controller';
import { DatabasesService } from './databases.service';
import { DbEngineRegistry } from './db-engine.registry';
import { DbInstancesService } from './db-instances.service';
import { DbMetricsService } from './db-metrics.service';
import { ExternalPmmService } from './external-pmm.service';
import { MariadbDriver } from './engines/mariadb.driver';
import { MongoDriver } from './engines/mongo.driver';
import { MysqlDriver } from './engines/mysql.driver';
import { PostgresDriver } from './engines/postgres.driver';
import { RedisDriver } from './engines/redis.driver';

@Module({
  // ContainersModule re-exports the DOCKER dockerode injection token
  // — DbInstancesService injects it for container lifecycle.
  // MonitoringModule exports PmmPromqlClient for DbMetricsService.
  imports: [ContainersModule, MonitoringModule],
  controllers: [DatabasesController],
  providers: [
    DatabasesService,
    DbInstancesService,
    DbMetricsService,
    ExternalPmmService,
    DbEngineRegistry,
    MysqlDriver,
    MariadbDriver,
    PostgresDriver,
    RedisDriver,
    MongoDriver,
  ],
  exports: [
    DatabasesService,
    DbInstancesService,
    DbMetricsService,
    ExternalPmmService,
    DbEngineRegistry,
  ],
})
export class DatabasesModule {}
