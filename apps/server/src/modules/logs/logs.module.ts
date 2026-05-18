import { Module } from '@nestjs/common';
import { LogsController } from './logs.controller';
import { SystemLogReader } from './readers/system-log.reader';
import { SshLogReader } from './readers/ssh-log.reader';
import { OperationLogReader } from './readers/operation-log.reader';
import { LoginLogReader } from './readers/login-log.reader';
import { TaskLogReader } from './readers/task-log.reader';

@Module({
  controllers: [LogsController],
  providers: [SystemLogReader, SshLogReader, OperationLogReader, LoginLogReader, TaskLogReader],
})
export class LogsModule {}
