import { Inject, Injectable } from '@nestjs/common';
import Dockerode from 'dockerode';
import type { Volume } from '@dinopanel/shared';
import { DOCKER } from './docker.token';
import { mapDockerError } from './docker-error';

@Injectable()
export class VolumesService {
  constructor(@Inject(DOCKER) private readonly docker: Dockerode) {}

  async list(): Promise<Volume[]> {
    try {
      const result = await this.docker.listVolumes();
      const volumes = result.Volumes ?? [];
      return volumes.map((v) => ({
        name: v.Name,
        driver: v.Driver,
        mountpoint: v.Mountpoint,
      }));
    } catch (err) {
      mapDockerError(err, 'list volumes');
    }
  }

  async inspect(name: string): Promise<Record<string, unknown>> {
    try {
      const data = await this.docker.getVolume(name).inspect();
      return data as unknown as Record<string, unknown>;
    } catch (err) {
      mapDockerError(err, `inspect volume ${name}`);
    }
  }

  async create(opts: { name: string; driver?: string; labels?: Record<string, string> }): Promise<Volume> {
    try {
      // dockerode v5 returns a chainable Volume wrapper from createVolume(),
      // not the raw JSON. Inspect the named volume to populate the response.
      await this.docker.createVolume({
        Name: opts.name,
        Driver: opts.driver ?? 'local',
        Labels: opts.labels,
      });
      const data = (await this.docker.getVolume(opts.name).inspect()) as {
        Name: string;
        Driver: string;
        Mountpoint: string;
      };
      return {
        name: data.Name,
        driver: data.Driver,
        mountpoint: data.Mountpoint,
      };
    } catch (err) {
      mapDockerError(err, `create volume ${opts.name}`);
    }
  }

  async remove(name: string, force?: boolean): Promise<void> {
    try {
      await this.docker.getVolume(name).remove({ force: force ?? false });
    } catch (err) {
      mapDockerError(err, `remove volume ${name}`);
    }
  }

  async prune(): Promise<{ volumesDeleted: string[]; spaceReclaimed: number }> {
    try {
      const result = await this.docker.pruneVolumes();
      return {
        volumesDeleted: result.VolumesDeleted ?? [],
        spaceReclaimed: result.SpaceReclaimed ?? 0,
      };
    } catch (err) {
      mapDockerError(err, 'prune volumes');
    }
  }
}
