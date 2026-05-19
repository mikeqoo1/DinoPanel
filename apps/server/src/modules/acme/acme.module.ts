import { Module, OnApplicationBootstrap } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { SchedulerService } from '../scheduler/scheduler.service';
import { WebsitesModule } from '../websites/websites.module';
import { AcmeAccountService } from './acme-account.service';
import { AcmeClientFactory } from './acme-client.factory';
import { AcmeController } from './acme.controller';
import { AcmeOrchestratorService } from './acme-orchestrator.service';
import { AcmeSettingsController } from './acme-settings.controller';
import {
  CloudflareDns01Challenger,
  CloudflareDohPropagationPoller,
  PROPAGATION_POLLER,
  type PropagationPoller,
} from './challengers/cloudflare-dns01.challenger';
import { Http01Challenger } from './challengers/http01.challenger';
import {
  ACME_RENEW_TASK_CRON,
  ACME_RENEW_TASK_NAME,
  AcmeRenewTaskRunner,
} from './runners/acme-renew.runner';

@Module({
  imports: [SchedulerModule, WebsitesModule],
  controllers: [AcmeController, AcmeSettingsController],
  providers: [
    AcmeClientFactory,
    AcmeAccountService,
    AcmeOrchestratorService,
    Http01Challenger,
    CloudflareDns01Challenger,
    AcmeRenewTaskRunner,
    {
      provide: PROPAGATION_POLLER,
      useClass: CloudflareDohPropagationPoller,
    },
  ],
  exports: [AcmeAccountService, AcmeOrchestratorService],
})
export class AcmeModule implements OnApplicationBootstrap {
  constructor(
    private readonly scheduler: SchedulerService,
    private readonly renewRunner: AcmeRenewTaskRunner,
    private readonly logger: Logger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Register the runner so SchedulerService.executeTask can dispatch
    // to it when the `acme_renew` cron fires.
    try {
      this.scheduler.registerRunner('acme_renew', this.renewRunner);
    } catch (err) {
      // Already registered (e.g. hot-reload in dev) — treat as no-op.
      this.logger.debug({ err }, 'acme.bootstrap.runner_already_registered');
    }

    // Insert the builtin task row (idempotent) and schedule it.
    const taskId = await this.scheduler.ensureBuiltinTask({
      name: ACME_RENEW_TASK_NAME,
      cron: ACME_RENEW_TASK_CRON,
      type: 'acme_renew',
      payload: { renewWithinDays: 30 },
    });
    await this.scheduler.register(taskId);
    this.logger.debug(
      { taskId, cron: ACME_RENEW_TASK_CRON },
      'acme.bootstrap.renew_job_registered',
    );
  }
}

// Re-export the propagation poller type so external callers can swap it
// in tests / for alternate resolvers.
export type { PropagationPoller };
