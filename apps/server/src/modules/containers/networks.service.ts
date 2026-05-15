import { Inject, Injectable } from '@nestjs/common';
import Dockerode from 'dockerode';
import type { Network } from '@dinopanel/shared';
import { DOCKER } from './docker.token';
import { mapDockerError } from './docker-error';

@Injectable()
export class NetworksService {
  constructor(@Inject(DOCKER) private readonly docker: Dockerode) {}

  async list(): Promise<Network[]> {
    try {
      const raw = await this.docker.listNetworks();
      return raw.map((n) => ({
        id: n.Id,
        name: n.Name,
        driver: n.Driver,
        scope: n.Scope,
      }));
    } catch (err) {
      mapDockerError(err, 'list networks');
    }
  }

  async inspect(id: string): Promise<Record<string, unknown>> {
    try {
      const data = await this.docker.getNetwork(id).inspect();
      return data as unknown as Record<string, unknown>;
    } catch (err) {
      mapDockerError(err, `inspect network ${id}`);
    }
  }

  async create(opts: { name: string; driver?: string; internal?: boolean }): Promise<{ id: string }> {
    try {
      const network = await this.docker.createNetwork({
        Name: opts.name,
        Driver: opts.driver ?? 'bridge',
        Internal: opts.internal ?? false,
      });
      return { id: network.id };
    } catch (err) {
      mapDockerError(err, `create network ${opts.name}`);
    }
  }

  async remove(id: string): Promise<void> {
    try {
      await this.docker.getNetwork(id).remove();
    } catch (err) {
      mapDockerError(err, `remove network ${id}`);
    }
  }

  async connect(networkId: string, containerId: string): Promise<void> {
    try {
      await this.docker.getNetwork(networkId).connect({ Container: containerId });
    } catch (err) {
      mapDockerError(err, `connect container ${containerId} to network ${networkId}`);
    }
  }

  async disconnect(networkId: string, containerId: string, force?: boolean): Promise<void> {
    try {
      await this.docker.getNetwork(networkId).disconnect({ Container: containerId, Force: force ?? false });
    } catch (err) {
      mapDockerError(err, `disconnect container ${containerId} from network ${networkId}`);
    }
  }
}
