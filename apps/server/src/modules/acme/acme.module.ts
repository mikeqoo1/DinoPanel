import { Module } from '@nestjs/common';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { WebsitesModule } from '../websites/websites.module';
import { AcmeAccountService } from './acme-account.service';
import { AcmeController } from './acme.controller';
import { AcmeOrchestratorService } from './acme-orchestrator.service';

/**
 * Phase 1 skeleton. Imports SchedulerModule + WebsitesModule up front so
 * Phase 4's renewal job and cert-write paths don't need to restructure
 * imports later.
 */
@Module({
  imports: [SchedulerModule, WebsitesModule],
  controllers: [AcmeController],
  providers: [AcmeAccountService, AcmeOrchestratorService],
  exports: [AcmeAccountService, AcmeOrchestratorService],
})
export class AcmeModule {}
