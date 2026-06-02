import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import type Dockerode from 'dockerode';
import type { CleanCategory, CleanResult, ToolboxCleaner } from '@dinopanel/shared';
import { mapDockerError } from '../../containers/docker-error';
import { runCommand, assertSuccess } from '../../../common/shell/run-command';

export type PackageManager = 'dnf' | 'apt' | null;

// journald retention cap applied by the journald cleaner. Server-chosen
// constant (never from the request body) so the sudoers entry can pin the
// exact `--vacuum-size=*` shape; keeps ~500M of recent logs, frees the rest.
const JOURNALD_VACUUM_SIZE = '500M';

/**
 * Curated, tool-owned cleaners. Each category is path-less — the underlying
 * tool owns what it deletes — so there is no filesystem-path input and no
 * arbitrary-delete surface. docker_prune goes through the dockerode socket
 * (mapDockerError), the others shell out under `sudo -n`.
 */
export class CleanerDriver {
  constructor(
    private readonly docker: Dockerode,
    private readonly pkgManager: PackageManager,
    private readonly journaldAvailable: boolean,
    private readonly requireSudo: boolean,
  ) {}

  /** Per-category availability for GET /toolbox/cleaners. */
  list(): ToolboxCleaner[] {
    return [
      {
        category: 'journald',
        available: this.journaldAvailable,
        reason: this.journaldAvailable ? null : 'JOURNALD_NOT_AVAILABLE',
      },
      {
        category: 'package_cache',
        available: this.pkgManager !== null,
        reason: this.pkgManager !== null ? null : 'NO_PACKAGE_MANAGER',
      },
      // Docker reachability is only known at call time; assumed present here
      // and surfaced as DOCKER_UNREACHABLE 503 by the prune call if the socket
      // is down.
      { category: 'docker_prune', available: true, reason: null },
    ];
  }

  run(category: CleanCategory): Promise<CleanResult> {
    switch (category) {
      case 'journald':
        return this.journald();
      case 'package_cache':
        return this.packageCache();
      case 'docker_prune':
        return this.dockerPrune();
      default:
        // Unreachable for a schema-validated CleanCategory, but a closed-enum
        // switch returning `undefined` on an unknown value would be a latent
        // crash. Defense-in-depth: refuse anything outside the curated set.
        throw new BadRequestException({
          code: 'TOOLBOX_UNKNOWN_CLEANER',
          message: `Unknown cleaner category: ${String(category)}`,
        });
    }
  }

  private async journald(): Promise<CleanResult> {
    if (!this.journaldAvailable) {
      throw new ServiceUnavailableException({
        code: 'JOURNALD_NOT_AVAILABLE',
        message: 'journalctl is not installed on this host',
      });
    }
    const r = await runCommand('journalctl', [`--vacuum-size=${JOURNALD_VACUUM_SIZE}`], {
      sudo: this.requireSudo,
      timeoutMs: 30_000,
    });
    assertSuccess(r, 'journalctl --vacuum-size');
    // journald prints "Vacuuming done, freed X ..." to STDERR.
    return { category: 'journald', freedBytes: null, detail: (r.stderr || r.stdout).trim() };
  }

  private async packageCache(): Promise<CleanResult> {
    if (this.pkgManager === null) {
      throw new ServiceUnavailableException({
        code: 'NO_PACKAGE_MANAGER',
        message: 'No supported package manager (dnf/apt) on PATH',
      });
    }
    const [cmd, args] =
      this.pkgManager === 'dnf'
        ? (['dnf', ['clean', 'all']] as const)
        : (['apt-get', ['clean']] as const);
    const r = await runCommand(cmd, [...args], { sudo: this.requireSudo, timeoutMs: 60_000 });
    assertSuccess(r, `${cmd} ${args.join(' ')}`);
    return {
      category: 'package_cache',
      freedBytes: null,
      detail: (r.stdout || `${cmd} ${args.join(' ')} ok`).trim(),
    };
  }

  /**
   * Mirror `docker system prune`: stopped containers + dangling images. We do
   * NOT prune volumes (the CLI omits them without --volumes; pruning them can
   * delete data) and keep images dangling-only (no aggressive `-a`).
   */
  private async dockerPrune(): Promise<CleanResult> {
    try {
      const containers = await this.docker.pruneContainers();
      const images = await this.docker.pruneImages();
      const freedBytes = (containers.SpaceReclaimed ?? 0) + (images.SpaceReclaimed ?? 0);
      // ImagesDeleted has one record per Untagged AND per Deleted layer; count
      // only actual deletions so a tagged dangling image isn't double-counted.
      const imagesDeleted = (images.ImagesDeleted ?? []).filter((r) => Boolean(r.Deleted)).length;
      const detail =
        `containers: ${containers.ContainersDeleted?.length ?? 0}, images: ${imagesDeleted}`;
      return { category: 'docker_prune', freedBytes, detail };
    } catch (err) {
      mapDockerError(err, 'docker system prune'); // never returns
    }
  }
}
