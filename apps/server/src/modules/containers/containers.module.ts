import { Module } from '@nestjs/common';
import Dockerode from 'dockerode';
import { AuthModule } from '../auth/auth.module';
import { DOCKER } from './docker.token';
import { ContainersService } from './containers.service';
import { ContainersController } from './containers.controller';
import { LogsGateway } from './logs.gateway';
import { StatsGateway } from './stats.gateway';
import { ExecGateway } from './exec.gateway';
import { ImagesService } from './images.service';
import { ImagesController } from './images.controller';
import { PullGateway } from './pull.gateway';
import { NetworksService } from './networks.service';
import { NetworksController } from './networks.controller';
import { VolumesService } from './volumes.service';
import { VolumesController } from './volumes.controller';

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
    ImagesService,
    PullGateway,
    NetworksService,
    VolumesService,
  ],
  controllers: [ContainersController, ImagesController, NetworksController, VolumesController],
  exports: [DOCKER, ContainersService, LogsGateway, StatsGateway, ExecGateway, ImagesService, PullGateway, NetworksService, VolumesService],
})
export class ContainersModule {}
