import { describe, it, expect, vi } from 'vitest';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { NetworksService } from '../networks.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDockerNetwork(overrides: Record<string, unknown> = {}) {
  return {
    inspect: vi.fn().mockResolvedValue({ Id: 'net123', Name: 'dinopanel-net', Driver: 'bridge' }),
    remove: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeDocker(network = makeDockerNetwork()) {
  return {
    listNetworks: vi.fn(),
    getNetwork: vi.fn().mockReturnValue(network),
    createNetwork: vi.fn(),
  };
}

function makeService(docker = makeDocker()) {
  return new NetworksService(docker as never);
}

const RAW_NETWORK = {
  Id: 'net123abc',
  Name: 'dinopanel-net',
  Driver: 'bridge',
  Scope: 'local',
};

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

describe('NetworksService', () => {
  // N-1. list() happy path
  it('N-1 — list() resolves to Network[] aligned with shared schema', async () => {
    const docker = makeDocker();
    (docker.listNetworks as ReturnType<typeof vi.fn>).mockResolvedValue([RAW_NETWORK]);
    const svc = makeService(docker);

    const result = await svc.list();

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('net123abc');
    expect(result[0]!.name).toBe('dinopanel-net');
    expect(result[0]!.driver).toBe('bridge');
    expect(result[0]!.scope).toBe('local');
  });

  // N-2. create() happy path → resolves { id }
  it('N-2 — create({ name }) resolves with { id }', async () => {
    const docker = makeDocker();
    (docker.createNetwork as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'new-net-id' });
    const svc = makeService(docker);

    const result = await svc.create({ name: 'dinopanel-net' });

    expect(result).toEqual({ id: 'new-net-id' });
    expect(docker.createNetwork).toHaveBeenCalledWith({
      Name: 'dinopanel-net',
      Driver: 'bridge',
      Internal: false,
    });
  });

  // N-3. remove non-existent network (404) → NotFoundException
  it('N-3 — remove() with 404 throws NotFoundException with code DOCKER_NOT_FOUND', async () => {
    const err404 = Object.assign(new Error('no such network'), { statusCode: 404 });
    const network = makeDockerNetwork({ remove: vi.fn().mockRejectedValue(err404) });
    const svc = makeService(makeDocker(network));

    await expect(svc.remove('non-existent')).rejects.toThrow(NotFoundException);
    await expect(svc.remove('non-existent')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'DOCKER_NOT_FOUND' }),
    });
  });

  // N-4. connect() with socket ENOENT → ServiceUnavailableException + DOCKER_UNREACHABLE
  it('N-4 — connect() with ENOENT throws ServiceUnavailableException with code DOCKER_UNREACHABLE', async () => {
    const transportErr = Object.assign(new Error('connect ENOENT /var/run/docker.sock'), {
      code: 'ENOENT',
    });
    const network = makeDockerNetwork({ connect: vi.fn().mockRejectedValue(transportErr) });
    const svc = makeService(makeDocker(network));

    await expect(svc.connect('net', 'container')).rejects.toThrow(ServiceUnavailableException);
    await expect(svc.connect('net', 'container')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'DOCKER_UNREACHABLE' }),
    });
  });
});
