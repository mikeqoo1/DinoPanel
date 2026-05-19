import { Module } from '@nestjs/common';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';
import { PmmPromqlClient } from './pmm-promql.client';

@Module({
  controllers: [MonitoringController],
  providers: [MonitoringService, PmmPromqlClient],
  exports: [PmmPromqlClient],
})
export class MonitoringModule {}
