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
import { ComposeService } from './compose.service';
import { ComposeController } from './compose.controller';
import { ComposeActionGateway } from './compose-action.gateway';

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
    ComposeService,
    ComposeActionGateway,
  ],
  controllers: [ContainersController, ImagesController, NetworksController, VolumesController, ComposeController],
  exports: [DOCKER, ContainersService, LogsGateway, StatsGateway, ExecGateway, ImagesService, PullGateway, NetworksService, VolumesService, ComposeService, ComposeActionGateway],
})
export class ContainersModule {}
