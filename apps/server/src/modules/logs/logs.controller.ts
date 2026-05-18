import {
  Controller,
  Get,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SystemLogReader } from './readers/system-log.reader';
import { SshLogReader } from './readers/ssh-log.reader';
import { OperationLogReader } from './readers/operation-log.reader';
import { LoginLogReader } from './readers/login-log.reader';
import { TaskLogReader } from './readers/task-log.reader';

@Controller('logs')
export class LogsController {
  constructor(
    private readonly system: SystemLogReader,
    private readonly ssh: SshLogReader,
    private readonly operation: OperationLogReader,
    private readonly login: LoginLogReader,
    private readonly task: TaskLogReader,
  ) {}

  @Get('system')
  async systemLog(@Query('limit') limit?: string, @Query('grep') grep?: string) {
    const lines = await this.system.read({
      limit: limit ? Number(limit) : undefined,
      grep,
    });
    return { items: lines, nextCursor: null };
  }

  @Get('ssh')
  async sshLog(@Query('limit') limit?: string) {
    const lines = await this.ssh.read({ limit: limit ? Number(limit) : undefined });
    return { items: lines, nextCursor: null };
  }

  @Get('operation')
  operationLog(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('userId') userId?: string,
    @Query('path') pathLike?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.operation.read({
      cursor,
      limit: limit ? Number(limit) : undefined,
      userId: userId ? Number(userId) : undefined,
      pathLike,
      status: status ? Number(status) : undefined,
      from: from ? Number(from) : undefined,
      to: to ? Number(to) : undefined,
    });
  }

  @Get('login')
  loginLog(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('username') username?: string,
    @Query('result') result?: 'success' | 'fail',
  ) {
    return this.login.read({
      cursor,
      limit: limit ? Number(limit) : undefined,
      username,
      result,
    });
  }

  @Get('tasks')
  taskLog(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('taskId') taskId?: string,
  ) {
    return this.task.read({
      cursor,
      limit: limit ? Number(limit) : undefined,
      taskId: taskId ? Number(taskId) : undefined,
    });
  }

  @Get('website')
  websiteLog(): never {
    throw new ServiceUnavailableException({
      code: 'FEATURE_PENDING',
      message: 'Available after v0.3 (websites + ACME)',
    });
  }
}
