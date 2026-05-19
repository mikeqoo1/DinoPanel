import { spawn } from 'node:child_process';
import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { join } from 'node:path';
import type { AppConfig } from '../../config/configuration';
import {
  assertSafeSiteName,
  resolveWebsitesPaths,
  type WebsitesPaths,
} from './paths';

export class NginxCommandError extends Error {
  constructor(
    public readonly code:
      | 'NGINX_VALIDATE_FAILED'
      | 'NGINX_RELOAD_FAILED'
      | 'NGINX_NOT_AVAILABLE'
      | 'NGINX_SPAWN_ERROR',
    message: string,
    public readonly stderr?: string,
  ) {
    super(message);
    this.name = 'NginxCommandError';
  }
}

interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

const NGINX_TIMEOUT_MS = 15_000;

/**
 * The single I/O wrapper around the host nginx binary.
 *
 * - Path resolution is centralised here so every conf-file write goes
 *   through the same safety gate (see `assertSafeSiteName`).
 * - `validate()` and `reload()` shell out via `sudo -n` per the sudoers
 *   contract documented in `docs/websites.md`. Operators add NOPASSWD
 *   entries for `nginx -t` and `systemctl reload nginx` once at install
 *   time.
 * - Probe at boot returns rather than throws so a misconfigured dev box
 *   doesn't take the whole panel down — the WebsitesService bootstrap
 *   decides whether to mark the module degraded.
 */
@Injectable()
export class NginxService implements OnApplicationBootstrap {
  private readonly paths: WebsitesPaths;
  private readonly requireSudo: boolean;
  private sudoProbeOk = false;

  constructor(
    @Inject(ConfigService)
    private readonly config: ConfigService<{ app: AppConfig }>,
    private readonly logger: Logger,
  ) {
    const app = this.config.get<AppConfig>('app', { infer: true });
    if (!app) throw new Error('App config missing');
    this.paths = resolveWebsitesPaths(app.env.WEBSITES_ROOT);
    this.requireSudo = app.env.WEBSITES_REQUIRE_SUDO;
  }

  async onApplicationBootstrap(): Promise<void> {
    this.sudoProbeOk = await this.probeSudo();
    if (!this.sudoProbeOk && this.requireSudo) {
      this.logger.warn(
        { sudoProbeOk: false },
        'nginx.sudo_probe_failed — see docs/websites.md for sudoers setup',
      );
    }
  }

  // ------------------------------------------------------------------
  // Path resolution
  // ------------------------------------------------------------------

  getPaths(): WebsitesPaths {
    return this.paths;
  }

  siteRoot(name: string): string {
    assertSafeSiteName(name);
    return join(this.paths.sitesDir, name);
  }

  siteConfPath(name: string): string {
    assertSafeSiteName(name);
    return join(this.paths.nginxConfDir, `${name}.conf`);
  }

  acmeRoot(): string {
    return this.paths.acmeDir;
  }

  acmeCertDir(siteId: number): string {
    if (!Number.isInteger(siteId) || siteId <= 0) {
      throw new Error(`Invalid siteId for acmeCertDir: ${siteId}`);
    }
    return join(this.paths.acmeCertsDir, String(siteId));
  }

  // ------------------------------------------------------------------
  // Shell operations
  // ------------------------------------------------------------------

  async validate(): Promise<void> {
    const result = await this.runSudo(['nginx', '-t']);
    if (result.exitCode !== 0) {
      throw new NginxCommandError(
        'NGINX_VALIDATE_FAILED',
        result.stderr || 'nginx -t exited non-zero',
        result.stderr,
      );
    }
  }

  async reload(): Promise<void> {
    const result = await this.runSudo(['systemctl', 'reload', 'nginx']);
    if (result.exitCode !== 0) {
      throw new NginxCommandError(
        'NGINX_RELOAD_FAILED',
        result.stderr || 'systemctl reload nginx exited non-zero',
        result.stderr,
      );
    }
  }

  /**
   * Best-effort probe at boot. Returns true if `sudo -n nginx -t` exits
   * 0, false otherwise. Never throws — bootstrap callers handle the
   * degraded case.
   */
  async probeSudo(): Promise<boolean> {
    try {
      const result = await this.runSudo(['nginx', '-t']);
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  isSudoOk(): boolean {
    return this.sudoProbeOk;
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private runSudo(args: string[]): Promise<CommandResult> {
    return new Promise<CommandResult>((resolve, reject) => {
      const child = spawn('sudo', ['-n', ...args], {
        timeout: NGINX_TIMEOUT_MS,
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (b: Buffer) => (stdout += b.toString('utf8')));
      child.stderr.on('data', (b: Buffer) => (stderr += b.toString('utf8')));
      child.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') {
          reject(
            new NginxCommandError(
              'NGINX_NOT_AVAILABLE',
              'sudo not installed on PATH',
            ),
          );
          return;
        }
        reject(new NginxCommandError('NGINX_SPAWN_ERROR', err.message));
      });
      child.on('close', (code) => {
        resolve({ exitCode: code, stdout, stderr });
      });
    });
  }
}
