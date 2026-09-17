import { Module } from '@nestjs/common';
import { NexusController } from './nexus.controller';
import { NexusService } from './nexus.service';

// ponytail: own 60s setInterval rather than the scheduler module — that one drives
// user-defined cron tasks stored in scheduled_tasks; this is an internal poller.
@Module({
  controllers: [NexusController],
  providers: [NexusService],
})
export class NexusModule {}
