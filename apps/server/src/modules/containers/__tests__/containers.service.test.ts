import { describe, it, expect, vi } from 'vitest';
import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ContainersService } from '../containers.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDockerContainer(overrides: Record<string, unknown> = {}) {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    restart: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    unpause: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    inspect: vi.fn().mockResolvedValue({
      Id: 'abc123',
      Name: '/my-container',
      State: { Status: 'running' },
    }),
    ...overrides,
  };
}

function makeDocker(container = makeDockerContainer()) {
  return {
    listContainers: vi.fn(),
    getContainer: vi.fn().mockReturnValue(container),
  };
}

function makeService(docker = makeDocker()) {
  // ContainersService constructor expects the DOCKER-injected dockerode instance
  return new ContainersService(docker as never);
}

// Raw listContainers output that should map to a Container
const RAW_CONTAINER = {
  Id: 'abc123def456',
  Names: ['/my-app'],
  Image: 'nginx:latest',
  ImageID: 'sha256:aaaa',
  State: 'running',
  Status: 'Up 2 hours',
  Ports: [{ IP: '0.0.0.0', PrivatePort: 80, PublicPort: 8080, Type: 'tcp' }],
  Labels: { env: 'prod' },
  Created: 1700000000,
};

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

describe('ContainersService', () => {
  // 1. list() happy path
  it('1 — list() resolves to Container[] aligned with shared schema', async () => {
    const docker = makeDocker();
    (docker.listContainers as ReturnType<typeof vi.fn>).mockResolvedValue([RAW_CONTAINER]);
    const svc = makeService(docker);

    const result = await svc.list();

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('abc123def456');
    expect(result[0]!.name).toBe('my-app');          // leading slash stripped
    expect(result[0]!.image).toBe('nginx:latest');
    expect(result[0]!.imageId).toBe('sha256:aaaa');
    expect(result[0]!.state).toBe('running');
    expect(result[0]!.status).toBe('Up 2 hours');
    expect(result[0]!.createdAt).toBe(1700000000);
    expect(result[0]!.labels).toEqual({ env: 'prod' });
    expect(result[0]!.ports[0]).toMatchObject({ privatePort: 80, publicPort: 8080, type: 'tcp' });
  });

  // 2. inspect() happy path
  it('2 — inspect(id) resolves to full raw data', async () => {
    const inspectData = { Id: 'abc123', Name: '/my-container', State: { Status: 'running' } };
    const container = makeDockerContainer({
      inspect: vi.fn().mockResolvedValue(inspectData),
    });
    const svc = makeService(makeDocker(container));

    const result = await svc.inspect('abc123');

    expect(result).toEqual(inspectData);
  });

  // 3. start on already-running container (304) → resolves without throwing
  it('3 — start() with 304 (already running) resolves silently', async () => {
    const err304 = Object.assign(new Error('Not Modified'), { statusCode: 304 });
    const container = makeDockerContainer({
      start: vi.fn().mockRejectedValue(err304),
    });
    const svc = makeService(makeDocker(container));

    await expect(svc.start('abc123')).resolves.toBeUndefined();
  });

  // 4. start on missing container (404) → throws NotFoundException with DOCKER_NOT_FOUND
  it('4 — start() with 404 throws NotFoundException with code DOCKER_NOT_FOUND', async () => {
    const err404 = Object.assign(new Error('No such container'), { statusCode: 404 });
    const container = makeDockerContainer({
      start: vi.fn().mockRejectedValue(err404),
    });
    const svc = makeService(makeDocker(container));

    await expect(svc.start('missing-id')).rejects.toThrow(NotFoundException);
    await expect(svc.start('missing-id')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'DOCKER_NOT_FOUND' }),
    });
  });

  // 5. stop on already-stopped container (304) → resolves without throwing
  it('5 — stop() with 304 (already stopped) resolves silently', async () => {
    const err304 = Object.assign(new Error('Not Modified'), { statusCode: 304 });
    const container = makeDockerContainer({
      stop: vi.fn().mockRejectedValue(err304),
    });
    const svc = makeService(makeDocker(container));

    await expect(svc.stop('abc123')).resolves.toBeUndefined();
  });

  // 6. remove running container without force (409) → throws ConflictException
  it('6 — remove() with 409 throws ConflictException with code DOCKER_CONFLICT', async () => {
    const err409 = Object.assign(new Error('You cannot remove a running container'), {
      statusCode: 409,
      reason: 'You cannot remove a running container',
    });
    const container = makeDockerContainer({
      remove: vi.fn().mockRejectedValue(err409),
    });
    const svc = makeService(makeDocker(container));

    await expect(svc.remove('running-id', { force: false })).rejects.toThrow(ConflictException);
    await expect(svc.remove('running-id', { force: false })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'DOCKER_CONFLICT' }),
    });
  });

  // 7. remove running container with force:true → resolves
  it('7 — remove() with force:true resolves successfully', async () => {
    const container = makeDockerContainer({
      remove: vi.fn().mockResolvedValue(undefined),
    });
    const docker = makeDocker(container);
    const svc = makeService(docker);

    await expect(svc.remove('running-id', { force: true })).resolves.toBeUndefined();
    expect(container.remove).toHaveBeenCalledWith({ force: true, v: undefined });
  });

  // 8. transport error (ENOENT) → throws ServiceUnavailableException with DOCKER_UNREACHABLE
  it('8 — ENOENT transport error throws ServiceUnavailableException with code DOCKER_UNREACHABLE', async () => {
    const transportErr = Object.assign(new Error('connect ENOENT /var/run/docker.sock'), {
      code: 'ENOENT',
    });
    const docker = makeDocker();
    (docker.listContainers as ReturnType<typeof vi.fn>).mockRejectedValue(transportErr);
    const svc = makeService(docker);

    await expect(svc.list()).rejects.toThrow(ServiceUnavailableException);
    await expect(svc.list()).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'DOCKER_UNREACHABLE' }),
    });
  });
});
