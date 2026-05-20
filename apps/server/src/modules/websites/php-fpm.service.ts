import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { count, eq } from 'drizzle-orm';
import type Dockerode from 'dockerode';
import type { AppConfig } from '../../config/configuration';
import { DRIZZLE_DB, type Db } from '../../database/db.module';
import { sites } from '../../database/schema';
import { DOCKER } from '../containers/docker.token';

const PHP_FPM_CONTAINER_NAME = 'dinopanel-php-fpm';
const DEFAULT_IMAGE = 'php:8.3-fpm';
const DEFAULT_TCP_HOST = '127.0.0.1';
const DEFAULT_TCP_PORT = 9000;
const DEFAULT_IDLE_KEEP_ALIVE_MIN = 10;

/**
 * v0.4 carry-over from v0.3: auto-provisioned PHP-FPM container.
 *
 * Operator override path (set `PHP_FPM_SOCKET_PATH` env to either
 * `unix:/path` or `tcp://host:port`) → service stays in `external`
 * mode, doesn't manage any container, just resolves the upstream
 * for the conf renderer.
 *
 * Default path (env empty) → service auto-provisions a `php:8.3-fpm`
 * container named `dinopanel-php-fpm`, bind-mounts the websites
 * sites root 1:1 (so fpm sees real document paths), exposes TCP
 * 127.0.0.1:9000. Lifecycle:
 *   - start when first PHP site is created (`ensureRunning`)
 *   - scheduled stop after 10 min idle when last PHP site removed
 *   - status reported as `managed` / `external` / `not_running`
 */
@Injectable()
export class PhpFpmService {
  private readonly externalUpstream: string | null;
  private readonly websitesSitesDir: string;
  private idleStopTimer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Db,
    @Inject(DOCKER) private readonly docker: Dockerode,
    @Inject(ConfigService)
    config: ConfigService<{ app: AppConfig }>,
    private readonly logger: Logger,
  ) {
    const app = config.get<AppConfig>('app', { infer: true });
    if (!app) throw new Error('App config missing');
    this.externalUpstream = normalizeExternalUpstream(app.env.PHP_FPM_SOCKET_PATH);
    this.websitesSitesDir = `${app.env.WEBSITES_ROOT}/sites`;
  }

  /**
   * Mode the service is operating in.
   * - `external` — operator set PHP_FPM_SOCKET_PATH; we delegate.
   * - `managed` — we manage `dinopanel-php-fpm`; default upstream.
   */
  isExternalMode(): boolean {
    return this.externalUpstream !== null;
  }

  /**
   * Value to write after `fastcgi_pass` in the nginx conf. External
   * mode just returns the operator's resolved upstream; managed mode
   * returns the TCP host:port the auto-provisioned container listens
   * on.
   */
  getUpstream(): string {
    if (this.externalUpstream) return this.externalUpstream;
    return `${DEFAULT_TCP_HOST}:${DEFAULT_TCP_PORT}`;
  }

  /**
   * Ensure the managed container is running. No-op in external mode
   * (operator already has fpm somewhere). Idempotent — Docker create
   * with `force: false` returns 409 when the container already
   * exists; we treat that as success and just start whichever exists.
   */
  async ensureRunning(): Promise<void> {
    if (this.externalUpstream) return;
    if (this.idleStopTimer) {
      clearTimeout(this.idleStopTimer);
      this.idleStopTimer = null;
    }

    const existing = this.docker.getContainer(PHP_FPM_CONTAINER_NAME);
    try {
      const info = await existing.inspect();
      if (info.State?.Running) return;
      await existing.start();
      return;
    } catch (err) {
      // 404 → no container yet; fall through to create.
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode !== 404) throw err;
    }

    const spec: Dockerode.ContainerCreateOptions = {
      name: PHP_FPM_CONTAINER_NAME,
      Image: DEFAULT_IMAGE,
      ExposedPorts: { '9000/tcp': {} },
      Labels: {
        'dinopanel.managed': 'true',
        'dinopanel.kind': 'php-fpm',
      },
      HostConfig: {
        // 1:1 bind so PHP sees the same paths nginx resolves to
        // (try_files / SCRIPT_FILENAME work without translation).
        Binds: [`${this.websitesSitesDir}:${this.websitesSitesDir}:ro`],
        PortBindings: {
          '9000/tcp': [{ HostIp: DEFAULT_TCP_HOST, HostPort: String(DEFAULT_TCP_PORT) }],
        },
        RestartPolicy: { Name: 'unless-stopped' },
      },
    };
    const container = await this.docker.createContainer(spec);
    await container.start();
    this.logger.debug(
      { container: PHP_FPM_CONTAINER_NAME, image: DEFAULT_IMAGE },
      'php-fpm.auto_provisioned',
    );
  }

  /**
   * Called after a PHP site is removed. Counts remaining PHP sites;
   * when zero, schedule a delayed stop (10 min default — config via
   * settings later if operators ask). No-op in external mode.
   */
  async scheduleIdleStop(idleMinutes = DEFAULT_IDLE_KEEP_ALIVE_MIN): Promise<void> {
    if (this.externalUpstream) return;
    const phpRows = await this.db
      .select({ value: count() })
      .from(sites)
      .where(eq(sites.type, 'php'));
    const phpCount = phpRows[0]?.value ?? 0;
    if (phpCount > 0) return;

    if (this.idleStopTimer) {
      clearTimeout(this.idleStopTimer);
    }
    this.idleStopTimer = setTimeout(
      () => {
        void this.stopManagedContainer().catch((err) =>
          this.logger.warn({ err }, 'php-fpm.idle_stop_failed'),
        );
      },
      idleMinutes * 60_000,
    );
    // Prevent the timer from holding the event loop alive at shutdown.
    this.idleStopTimer.unref?.();
  }

  async getStatus(): Promise<PhpFpmStatus> {
    if (this.externalUpstream) {
      return {
        mode: 'external',
        upstream: this.externalUpstream,
        containerRunning: null,
        containerName: null,
      };
    }
    try {
      const info = await this.docker.getContainer(PHP_FPM_CONTAINER_NAME).inspect();
      return {
        mode: 'managed',
        upstream: this.getUpstream(),
        containerRunning: info.State?.Running ?? false,
        containerName: PHP_FPM_CONTAINER_NAME,
      };
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode === 404) {
        return {
          mode: 'managed',
          upstream: this.getUpstream(),
          containerRunning: false,
          containerName: PHP_FPM_CONTAINER_NAME,
        };
      }
      throw err;
    }
  }

  async restart(): Promise<void> {
    if (this.externalUpstream) return; // operator owns it
    await this.docker.getContainer(PHP_FPM_CONTAINER_NAME).restart().catch(async (err) => {
      // 404 — container doesn't exist yet, create + start instead.
      if ((err as { statusCode?: number }).statusCode === 404) {
        await this.ensureRunning();
        return;
      }
      throw err;
    });
  }

  /** Exposed for tests so the scheduled stop can be triggered eagerly. */
  async stopManagedContainer(): Promise<void> {
    if (this.externalUpstream) return;
    await this.docker
      .getContainer(PHP_FPM_CONTAINER_NAME)
      .stop()
      .catch((err) => {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 304 || statusCode === 404) return;
        throw err;
      });
    this.idleStopTimer = null;
  }
}

export interface PhpFpmStatus {
  mode: 'external' | 'managed';
  upstream: string;
  containerRunning: boolean | null;
  containerName: string | null;
}

/**
 * v0.3 used PHP_FPM_SOCKET_PATH as a literal unix socket path. v0.4
 * extends the env to also accept `tcp://host:port` AND treats empty
 * string as "auto-provision". Returns the resolved fastcgi_pass
 * value when external mode applies, or `null` for managed mode.
 */
function normalizeExternalUpstream(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('tcp://')) {
    return trimmed.slice('tcp://'.length);
  }
  if (trimmed.startsWith('unix:')) {
    return trimmed;
  }
  // Bare path → unix socket (v0.3 contract).
  if (trimmed.startsWith('/')) {
    return `unix:${trimmed}`;
  }
  // host:port form without scheme → accept as-is.
  return trimmed;
}

export { normalizeExternalUpstream };
