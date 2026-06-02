import { describe, it, expect, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import type Dockerode from 'dockerode';
import { CleanerDriver } from '../drivers/cleaner-driver';

// docker handle is only exercised by the docker_prune tests; the others throw
// before ever touching it, so an empty stub is fine for them.
const NO_DOCKER = {} as unknown as Dockerode;

describe('CleanerDriver — per-category availability (GET /toolbox/cleaners)', () => {
  it('reports every category available when its tool is present', () => {
    const driver = new CleanerDriver(NO_DOCKER, 'dnf', true, true);
    expect(driver.list()).toEqual([
      { category: 'journald', available: true, reason: null },
      { category: 'package_cache', available: true, reason: null },
      { category: 'docker_prune', available: true, reason: null },
    ]);
  });

  it('flags journald + package_cache unavailable when their tools are absent', () => {
    const driver = new CleanerDriver(NO_DOCKER, null, false, true);
    expect(driver.list()).toEqual([
      { category: 'journald', available: false, reason: 'JOURNALD_NOT_AVAILABLE' },
      { category: 'package_cache', available: false, reason: 'NO_PACKAGE_MANAGER' },
      { category: 'docker_prune', available: true, reason: null },
    ]);
  });
});

describe('CleanerDriver — degrades to 503 when a tool is absent', () => {
  it('journald 503s JOURNALD_NOT_AVAILABLE when journalctl is missing', async () => {
    const driver = new CleanerDriver(NO_DOCKER, 'dnf', false, true);
    const caught = (await driver.run('journald').catch((e: unknown) => e)) as HttpException;
    expect(caught).toBeInstanceOf(HttpException);
    expect(caught.getStatus()).toBe(503);
    expect(caught.getResponse()).toMatchObject({ code: 'JOURNALD_NOT_AVAILABLE' });
  });

  it('package_cache 503s NO_PACKAGE_MANAGER when neither dnf nor apt is present', async () => {
    const driver = new CleanerDriver(NO_DOCKER, null, true, true);
    const caught = (await driver.run('package_cache').catch((e: unknown) => e)) as HttpException;
    expect(caught).toBeInstanceOf(HttpException);
    expect(caught.getStatus()).toBe(503);
    expect(caught.getResponse()).toMatchObject({ code: 'NO_PACKAGE_MANAGER' });
  });
});

describe('CleanerDriver — closed-enum guardrail (hardened switch default)', () => {
  it('refuses a category outside the curated set instead of silently returning undefined', () => {
    const driver = new CleanerDriver(NO_DOCKER, 'dnf', true, true);
    // The schema blocks this upstream; the switch default is defense-in-depth.
    let caught: unknown;
    try {
      void driver.run('tmp_sweep' as never);
      expect.unreachable('should have thrown for an unknown cleaner category');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).getStatus()).toBe(400);
    expect((caught as HttpException).getResponse()).toMatchObject({ code: 'TOOLBOX_UNKNOWN_CLEANER' });
  });
});

describe('CleanerDriver — docker_prune (containers + dangling images, no volumes)', () => {
  it('sums reclaimed space and counts only actually-deleted images', async () => {
    const docker = {
      pruneContainers: vi.fn().mockResolvedValue({ ContainersDeleted: ['a', 'b'], SpaceReclaimed: 100 }),
      pruneImages: vi.fn().mockResolvedValue({
        // one real deletion + one untagged-only record (must NOT be counted)
        ImagesDeleted: [{ Deleted: 'sha256:x' }, { Untagged: 'repo:tag' }],
        SpaceReclaimed: 50,
      }),
    } as unknown as Dockerode;
    const driver = new CleanerDriver(docker, 'dnf', true, true);

    const result = await driver.run('docker_prune');
    expect(result).toMatchObject({ category: 'docker_prune', freedBytes: 150 });
    expect(result.detail).toContain('containers: 2');
    expect(result.detail).toContain('images: 1');
    // Never prunes volumes.
    expect((docker as unknown as { pruneVolumes?: unknown }).pruneVolumes).toBeUndefined();
  });

  it('surfaces a coded HttpException when the docker socket is unreachable', async () => {
    const docker = {
      pruneContainers: vi.fn().mockRejectedValue(
        Object.assign(new Error('connect ENOENT /var/run/docker.sock'), { code: 'ENOENT' }),
      ),
      pruneImages: vi.fn(),
    } as unknown as Dockerode;
    const driver = new CleanerDriver(docker, 'dnf', true, true);

    const caught = (await driver.run('docker_prune').catch((e: unknown) => e)) as HttpException;
    expect(caught).toBeInstanceOf(HttpException);
    expect(caught.getStatus()).toBe(503);
    expect(caught.getResponse()).toMatchObject({ code: 'DOCKER_UNREACHABLE' });
  });
});
