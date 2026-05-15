import { Module } from '@nestjs/common';
import Dockerode from 'dockerode';
import { AuthModule } from '../auth/auth.module';
import { DOCKER } from './docker.token';
import { ContainersService } from './containers.service';
import { ContainersController } from './containers.controller';
import { LogsGateway } from './logs.gateway';
import { StatsGateway } from './stats.gateway';
import { ExecGateway } from './exec.gateway';

export { DOCKER } from './docker.token';

@Module({
  imports: [AuthModule],
  providers: [
    {
      provide: DOCKER,
      useFactory: (): Dockerode =>
        new Dockerode({
          socketPath: process.env.DOCKER_SOCKET_PATH ?? '/var/run/docker.sock',
        }),
    },
    ContainersService,
    LogsGateway,
    StatsGateway,
    ExecGateway,
  ],
  controllers: [ContainersController],
  exports: [DOCKER, ContainersService, LogsGateway, StatsGateway, ExecGateway],
})
export class ContainersModule {}
