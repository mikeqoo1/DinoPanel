import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { SchedulerService } from './scheduler.service';
import { SchedulerController } from './scheduler.controller';
import { ShellTaskRunner } from './runners/shell.runner';
import { BackupFilesTaskRunner } from './runners/backup-files.runner';
import { CleanLogsTaskRunner } from './runners/clean-logs.runner';
import { RestartServiceTaskRunner } from './runners/restart-service.runner';
import { HttpRequestTaskRunner } from './runners/http-request.runner';
import { PurgeTaskRunner } from './runners/purge.runner';

@Module({
  imports: [FilesModule],
  controllers: [SchedulerController],
  providers: [
    SchedulerService,
    ShellTaskRunner,
    BackupFilesTaskRunner,
    CleanLogsTaskRunner,
    RestartServiceTaskRunner,
    HttpRequestTaskRunner,
    PurgeTaskRunner,
  ],
  exports: [SchedulerService, CleanLogsTaskRunner],
})
export class SchedulerModule {}
