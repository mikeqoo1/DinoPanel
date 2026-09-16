import { describe, it, expect } from 'vitest';
import { resolveSocketPath } from '../docker-socket';

const DOCKER = '/var/run/docker.sock';
const PODMAN = '/run/podman/podman.sock';

function existsIn(...paths: string[]) {
  return (p: string) => paths.includes(p);
}

describe('resolveSocketPath', () => {
  it('honours DOCKER_SOCKET_PATH verbatim, even if the file does not exist yet', () => {
    expect(resolveSocketPath({ DOCKER_SOCKET_PATH: '/custom.sock' }, existsIn())).toBe('/custom.sock');
  });

  it('prefers the docker socket when both docker and podman sockets exist', () => {
    expect(resolveSocketPath({}, existsIn(DOCKER, PODMAN))).toBe(DOCKER);
  });

  it('falls back to the rootful podman socket when docker.sock is missing', () => {
    expect(resolveSocketPath({}, existsIn(PODMAN))).toBe(PODMAN);
  });

  it('falls back to the rootless podman socket under XDG_RUNTIME_DIR', () => {
    const rootless = '/run/user/1000/podman/podman.sock';
    expect(resolveSocketPath({ XDG_RUNTIME_DIR: '/run/user/1000' }, existsIn(rootless))).toBe(rootless);
  });

  it('returns the docker default when nothing exists (so DOCKER_UNREACHABLE 503 fires as before)', () => {
    expect(resolveSocketPath({}, existsIn())).toBe(DOCKER);
  });
});
