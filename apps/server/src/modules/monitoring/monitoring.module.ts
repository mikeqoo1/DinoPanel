import { Module } from '@nestjs/common';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';
import { PmmInventoryClient } from './pmm-inventory.client';
import { PmmPromqlClient } from './pmm-promql.client';

@Module({
  controllers: [MonitoringController],
  providers: [MonitoringService, PmmPromqlClient, PmmInventoryClient],
  exports: [MonitoringService, PmmPromqlClient, PmmInventoryClient],
})
export class MonitoringModule {}
