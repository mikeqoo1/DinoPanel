import { Module } from '@nestjs/common';
import Dockerode from 'dockerode';

export const DOCKER = Symbol('DOCKER');

@Module({
  providers: [
    {
      provide: DOCKER,
      useFactory: (): Dockerode =>
        new Dockerode({
          socketPath: process.env.DOCKER_SOCKET_PATH ?? '/var/run/docker.sock',
        }),
    },
  ],
  exports: [DOCKER],
})
export class ContainersModule {}
