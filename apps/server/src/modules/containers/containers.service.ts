import { Inject, Injectable } from '@nestjs/common';
import Dockerode from 'dockerode';
import type { Container, LocalEngine } from '@dinopanel/shared';
import { DOCKER } from './docker.token';
import { mapDockerError } from './docker-error';

@Injectable()
export class ContainersService {
  constructor(@Inject(DOCKER) private readonly docker: Dockerode) {}

  private engine: LocalEngine | null = null;

  /**
   * Which Docker-compatible engine is behind the socket. Podman's compat API reports a
   * version component named "Podman Engine"; stock Docker reports "Engine". Cached after
   * the first successful probe — the engine does not change while the panel runs.
   */
  async getEngine(): Promise<LocalEngine> {
    if (this.engine) return this.engine;
    try {
      const v = (await this.docker.version()) as {
        Version?: string;
        Components?: Array<{ Name?: string }>;
      };
      const isPodman = (v.Components ?? []).some((c) => /podman/i.test(c.Name ?? ''));
      this.engine = { engine: isPodman ? 'podman' : 'docker', version: v.Version ?? '' };
      return this.engine;
    } catch (err) {
      mapDockerError(err, 'engine version');
    }
  }

  async list(filters?: Record<string, string[]>): Promise<Container[]> {
    try {
      const raw = await this.docker.listContainers({
        all: true,
        ...(filters ? { filters: JSON.stringify(filters) } : {}),
      });
      return raw.map((c) => ({
        id: c.Id,
        name: (c.Names[0] ?? '').replace(/^\//, ''),
        image: c.Image,
        imageId: c.ImageID,
        state: c.State as Container['state'],
        status: c.Status,
        ports: (c.Ports ?? []).map((p) => ({
          ip: p.IP,
          privatePort: p.PrivatePort,
          publicPort: p.PublicPort,
          type: p.Type as 'tcp' | 'udp' | 'sctp',
        })),
        labels: c.Labels ?? {},
        createdAt: c.Created,
      }));
    } catch (err) {
      mapDockerError(err, 'list containers');
    }
  }

  async inspect(id: string): Promise<Container> {
    try {
      const data = await this.docker.getContainer(id).inspect();
      // Map raw Docker inspect (PascalCase) to the shared Container schema.
      // The list() method maps from listContainers(); inspect() uses inspectContainer()
      // which has a different shape — we normalize here so the frontend gets a consistent type.
      return {
        id: data.Id,
        name: (data.Name ?? '').replace(/^\//, ''),
        image: data.Config?.Image ?? data.Image ?? '',
        imageId: data.Image ?? '',
        state: (data.State?.Status ?? 'unknown') as Container['state'],
        status: data.State?.Status ?? '',
        ports: Object.entries(
          (data.NetworkSettings?.Ports ?? {}) as Record<string, Array<{ HostIp?: string; HostPort?: string }> | null>,
        ).flatMap(([portProto, bindings]) => {
          const [privatePort, type] = portProto.split('/') as [string, string];
          if (!bindings) return [{ privatePort: parseInt(privatePort, 10), type: (type ?? 'tcp') as 'tcp' | 'udp' | 'sctp' }];
          return bindings.map((b) => ({
            ip: b.HostIp,
            privatePort: parseInt(privatePort, 10),
            publicPort: b.HostPort ? parseInt(b.HostPort, 10) : undefined,
            type: (type ?? 'tcp') as 'tcp' | 'udp' | 'sctp',
          }));
        }),
        labels: (data.Config?.Labels ?? {}) as Record<string, string>,
        createdAt: Math.floor(new Date(data.Created as string).getTime() / 1000),
      };
    } catch (err) {
      mapDockerError(err, `inspect container ${id}`);
    }
  }

  async start(id: string): Promise<void> {
    try {
      await this.docker.getContainer(id).start();
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode === 304) return;
      mapDockerError(err, `start container ${id}`);
    }
  }

  async stop(id: string): Promise<void> {
    try {
      await this.docker.getContainer(id).stop();
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode === 304) return;
      mapDockerError(err, `stop container ${id}`);
    }
  }

  async restart(id: string): Promise<void> {
    try {
      await this.docker.getContainer(id).restart();
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode === 304) return;
      mapDockerError(err, `restart container ${id}`);
    }
  }

  async pause(id: string): Promise<void> {
    try {
      await this.docker.getContainer(id).pause();
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode === 304) return;
      mapDockerError(err, `pause container ${id}`);
    }
  }

  async unpause(id: string): Promise<void> {
    try {
      await this.docker.getContainer(id).unpause();
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode === 304) return;
      mapDockerError(err, `unpause container ${id}`);
    }
  }

  async kill(id: string): Promise<void> {
    try {
      await this.docker.getContainer(id).kill();
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode === 304) return;
      mapDockerError(err, `kill container ${id}`);
    }
  }

  async remove(id: string, options?: { force?: boolean; v?: boolean }): Promise<void> {
    try {
      await this.docker.getContainer(id).remove({ force: options?.force, v: options?.v });
    } catch (err) {
      mapDockerError(err, `remove container ${id}`);
    }
  }
}
