import { Inject, Injectable } from '@nestjs/common';
import Dockerode from 'dockerode';
import type { Image } from '@dinopanel/shared';
import { DOCKER } from './docker.token';
import { mapDockerError } from './docker-error';

@Injectable()
export class ImagesService {
  constructor(@Inject(DOCKER) private readonly docker: Dockerode) {}

  async list(): Promise<Image[]> {
    try {
      const raw = await this.docker.listImages({ all: false });
      return raw.map((img) => ({
        id: img.Id,
        repoTags: img.RepoTags ?? [],
        size: img.Size,
        createdAt: img.Created,
        labels: img.Labels ?? undefined,
      }));
    } catch (err) {
      mapDockerError(err, 'list images');
    }
  }

  async inspect(id: string): Promise<Record<string, unknown>> {
    try {
      const data = await this.docker.getImage(id).inspect();
      return data as unknown as Record<string, unknown>;
    } catch (err) {
      mapDockerError(err, `inspect image ${id}`);
    }
  }

  async pull(ref: string, opts?: { onProgress?: (event: unknown) => void }): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.docker.pull(ref, (err: Error | null, stream: NodeJS.ReadableStream) => {
        if (err) {
          try {
            mapDockerError(err, `pull image ${ref}`);
          } catch (mapped) {
            reject(mapped);
            return;
          }
          reject(err);
          return;
        }

        let buffer = '';
        stream.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf8');
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const event = JSON.parse(trimmed) as unknown;
              opts?.onProgress?.(event);
            } catch {
              // ignore malformed JSON lines
            }
          }
        });

        stream.on('end', () => {
          resolve();
        });

        stream.on('error', (streamErr: Error) => {
          try {
            mapDockerError(streamErr, `pull image ${ref}`);
          } catch (mapped) {
            reject(mapped);
            return;
          }
          reject(streamErr);
        });
      });
    });
  }

  async remove(id: string, opts?: { force?: boolean; noprune?: boolean }): Promise<void> {
    try {
      await this.docker.getImage(id).remove({ force: opts?.force, noprune: opts?.noprune });
    } catch (err) {
      mapDockerError(err, `remove image ${id}`);
    }
  }

  async tag(id: string, repo: string, tag?: string): Promise<void> {
    try {
      await this.docker.getImage(id).tag({ repo, tag });
    } catch (err) {
      mapDockerError(err, `tag image ${id}`);
    }
  }
}
