import { describe, it, expect, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { VolumesService } from '../volumes.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDockerVolume(overrides: Record<string, unknown> = {}) {
  return {
    inspect: vi.fn().mockResolvedValue({ Name: 'data', Driver: 'local', Mountpoint: '/var/lib/docker/volumes/data/_data' }),
    remove: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeDocker(volume = makeDockerVolume()) {
  return {
    listVolumes: vi.fn(),
    getVolume: vi.fn().mockReturnValue(volume),
    createVolume: vi.fn(),
    pruneVolumes: vi.fn(),
  };
}

function makeService(docker = makeDocker()) {
  return new VolumesService(docker as never);
}

const RAW_VOLUME_LIST = {
  Volumes: [
    {
      Name: 'mydata',
      Driver: 'local',
      Mountpoint: '/var/lib/docker/volumes/mydata/_data',
    },
  ],
  Warnings: [],
};

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

describe('VolumesService', () => {
  // V-1. list() happy path
  it('V-1 — list() resolves to Volume[] aligned with shared schema', async () => {
    const docker = makeDocker();
    (docker.listVolumes as ReturnType<typeof vi.fn>).mockResolvedValue(RAW_VOLUME_LIST);
    const svc = makeService(docker);

    const result = await svc.list();

    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('mydata');
    expect(result[0]!.driver).toBe('local');
    expect(result[0]!.mountpoint).toBe('/var/lib/docker/volumes/mydata/_data');
  });

  // V-2. create() happy path → resolves with Volume shape
  it('V-2 — create({ name, driver }) resolves with Volume shape', async () => {
    const docker = makeDocker();
    (docker.createVolume as ReturnType<typeof vi.fn>).mockResolvedValue({
      Name: 'data',
      Driver: 'local',
      Mountpoint: '/var/lib/docker/volumes/data/_data',
    });
    const svc = makeService(docker);

    const result = await svc.create({ name: 'data', driver: 'local' });

    expect(result).toEqual({
      name: 'data',
      driver: 'local',
      mountpoint: '/var/lib/docker/volumes/data/_data',
    });
    expect(docker.createVolume).toHaveBeenCalledWith({
      Name: 'data',
      Driver: 'local',
      Labels: undefined,
    });
  });

  // V-3. remove in-use volume without force (409) → ConflictException
  it('V-3 — remove() in-use volume throws ConflictException with code DOCKER_CONFLICT', async () => {
    const err409 = Object.assign(new Error('volume is in use'), {
      statusCode: 409,
      reason: 'volume is in use',
    });
    const volume = makeDockerVolume({ remove: vi.fn().mockRejectedValue(err409) });
    const svc = makeService(makeDocker(volume));

    await expect(svc.remove('in-use', false)).rejects.toThrow(ConflictException);
    await expect(svc.remove('in-use', false)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'DOCKER_CONFLICT' }),
    });
  });

  // V-4. prune() happy path → resolves with volumesDeleted + spaceReclaimed
  it('V-4 — prune() resolves with volumesDeleted and spaceReclaimed', async () => {
    const docker = makeDocker();
    (docker.pruneVolumes as ReturnType<typeof vi.fn>).mockResolvedValue({
      VolumesDeleted: ['old-vol-1', 'old-vol-2'],
      SpaceReclaimed: 104_857_600,
    });
    const svc = makeService(docker);

    const result = await svc.prune();

    expect(result.volumesDeleted).toEqual(['old-vol-1', 'old-vol-2']);
    expect(result.spaceReclaimed).toBe(104_857_600);
  });
});
