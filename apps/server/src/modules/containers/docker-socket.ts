import { existsSync } from 'node:fs';

const DOCKER_DEFAULT = '/var/run/docker.sock';

/**
 * Pick the Docker-compatible API socket. `DOCKER_SOCKET_PATH` always wins; otherwise
 * the first existing candidate: docker, rootful podman, rootless podman. Nothing found
 * → docker default, so the existing DOCKER_UNREACHABLE 503 path fires unchanged.
 * Pure (env + exists injected) so it is unit-testable without touching the filesystem.
 */
export function resolveSocketPath(
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = existsSync,
): string {
  if (env.DOCKER_SOCKET_PATH) return env.DOCKER_SOCKET_PATH;
  const candidates = [
    DOCKER_DEFAULT,
    '/run/podman/podman.sock',
    ...(env.XDG_RUNTIME_DIR ? [`${env.XDG_RUNTIME_DIR}/podman/podman.sock`] : []),
  ];
  return candidates.find(exists) ?? DOCKER_DEFAULT;
}
