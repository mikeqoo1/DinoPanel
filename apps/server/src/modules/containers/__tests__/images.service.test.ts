import { describe, it, expect, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ImagesService } from '../images.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDockerImage(overrides: Record<string, unknown> = {}) {
  return {
    inspect: vi.fn().mockResolvedValue({ Id: 'sha256:abc', RepoTags: ['nginx:latest'] }),
    remove: vi.fn().mockResolvedValue(undefined),
    tag: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeDocker(image = makeDockerImage()) {
  return {
    listImages: vi.fn(),
    getImage: vi.fn().mockReturnValue(image),
    pull: vi.fn(),
  };
}

function makeService(docker = makeDocker()) {
  return new ImagesService(docker as never);
}

const RAW_IMAGE = {
  Id: 'sha256:aabbccddeeff',
  RepoTags: ['nginx:latest', 'nginx:1.25'],
  Size: 142_000_000,
  Created: 1700000000,
  Labels: { maintainer: 'nginx' },
};

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

describe('ImagesService', () => {
  // I-1. list() happy path
  it('I-1 — list() resolves to Image[] aligned with shared schema', async () => {
    const docker = makeDocker();
    (docker.listImages as ReturnType<typeof vi.fn>).mockResolvedValue([RAW_IMAGE]);
    const svc = makeService(docker);

    const result = await svc.list();

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('sha256:aabbccddeeff');
    expect(result[0]!.repoTags).toEqual(['nginx:latest', 'nginx:1.25']);
    expect(result[0]!.size).toBe(142_000_000);
    expect(result[0]!.createdAt).toBe(1700000000);
    expect(result[0]!.labels).toEqual({ maintainer: 'nginx' });
  });

  // I-2. remove on in-use image (409) → ConflictException + DOCKER_CONFLICT
  it('I-2 — remove() with 409 throws ConflictException with code DOCKER_CONFLICT', async () => {
    const err409 = Object.assign(new Error('image is being used by running container'), {
      statusCode: 409,
      reason: 'image is being used by running container',
    });
    const image = makeDockerImage({ remove: vi.fn().mockRejectedValue(err409) });
    const svc = makeService(makeDocker(image));

    await expect(svc.remove('sha256:running-used')).rejects.toThrow(ConflictException);
    await expect(svc.remove('sha256:running-used')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'DOCKER_CONFLICT' }),
    });
  });

  // I-3. tag() passes correct parameters to dockerode
  it('I-3 — tag(id, repo, tag) resolves and passes correct params to dockerode', async () => {
    const tagFn = vi.fn().mockResolvedValue(undefined);
    const image = makeDockerImage({ tag: tagFn });
    const docker = makeDocker(image);
    const svc = makeService(docker);

    await expect(svc.tag('sha256:abc', 'myrepo', 'v1')).resolves.toBeUndefined();
    expect(docker.getImage).toHaveBeenCalledWith('sha256:abc');
    expect(tagFn).toHaveBeenCalledWith({ repo: 'myrepo', tag: 'v1' });
  });

  // I-4. pull missing image (404) → NotFoundException + DOCKER_NOT_FOUND
  it('I-4 — pull() with 404 error rejects with NotFoundException and code DOCKER_NOT_FOUND', async () => {
    const err404 = Object.assign(new Error('pull access denied'), { statusCode: 404 });
    const docker = makeDocker();
    (docker.pull as ReturnType<typeof vi.fn>).mockImplementation(
      (_ref: string, cb: (err: Error | null, stream: unknown) => void) => {
        cb(err404, null);
      },
    );
    const svc = makeService(docker);

    await expect(svc.pull('missing-image:latest')).rejects.toThrow(NotFoundException);
    await expect(svc.pull('missing-image:latest')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'DOCKER_NOT_FOUND' }),
    });
  });
});
