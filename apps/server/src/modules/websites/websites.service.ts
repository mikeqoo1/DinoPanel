import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import {
  Inject,
  Injectable,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { eq } from 'drizzle-orm';
import type { AppConfig } from '../../config/configuration';
import { DRIZZLE_DB, type Db } from '../../database/db.module';
import { settings } from '../../database/schema';
import { NginxService } from './nginx.service';
import { resolveWebsitesPaths, type WebsitesPaths } from './paths';

export const WEBSITES_BOOTSTRAP_FLAG = 'websites.bootstrap_failed';

/**
 * Phase 1 responsibilities:
 *
 * - Bootstrap the on-disk layout (idempotent mkdir of `<root>/sites`,
 *   `<root>/nginx/conf.d`, `<root>/acme/...`).
 * - Write the nginx include glue file
 *   (`/etc/nginx/conf.d/00-dinopanel.conf`) so the host nginx picks up
 *   any future site conf without further intervention.
 * - Surface a degraded flag in `settings` when bootstrap fails, but
 *   never crash the app — the rest of DinoPanel must keep working.
 *
 * Phase 2 will fill in `list / create / update / delete / reconcile`.
 */
@Injectable()
export class WebsitesService implements OnApplicationBootstrap {
  private degraded = false;
  private degradedReason: string | null = null;
  private readonly paths: WebsitesPaths;
  private readonly nginxIncludePath: string;

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Db,
    @Inject(ConfigService)
    private readonly config: ConfigService<{ app: AppConfig }>,
    private readonly logger: Logger,
    private readonly nginx: NginxService,
  ) {
    const app = this.config.get<AppConfig>('app', { infer: true });
    if (!app) throw new Error('App config missing');
    this.paths = resolveWebsitesPaths(app.env.WEBSITES_ROOT);
    this.nginxIncludePath = app.env.WEBSITES_NGINX_INCLUDE_PATH;
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.ensureDirectories();
      await this.ensureNginxInclude();
      await this.clearDegradedFlag();
      this.logger.debug(
        { root: this.paths.root, include: this.nginxIncludePath },
        'websites.bootstrap.ok',
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.degraded = true;
      this.degradedReason = reason;
      this.logger.error({ err, reason }, 'websites.bootstrap.failed');
      // Best-effort persist; do NOT rethrow — bootstrap must not crash.
      await this.persistDegradedFlag(reason).catch(() => {
        /* ignore */
      });
    }
  }

  getStatus(): { degraded: boolean; reason: string | null } {
    return { degraded: this.degraded, reason: this.degradedReason };
  }

  isDegraded(): boolean {
    return this.degraded;
  }

  // Phase 1 stub — Phase 2 fills this in (DB row + conf-file join).
  async list(): Promise<unknown[]> {
    return Promise.resolve([]);
  }

  // -------------------------------------------------------------------
  // Bootstrap internals
  // -------------------------------------------------------------------

  /**
   * mkdir all six directories under `<root>`. `recursive: true` makes
   * this idempotent. Mode 0700 for `acme/` (private keys live there);
   * 0755 for the rest.
   *
   * Exposed (not private) so tests can drive it directly without
   * spinning the whole module.
   */
  async ensureDirectories(): Promise<void> {
    const mode0755 = 0o755;
    const mode0700 = 0o700;
    await fs.mkdir(this.paths.sitesDir, { recursive: true, mode: mode0755 });
    await fs.mkdir(this.paths.nginxConfDir, {
      recursive: true,
      mode: mode0755,
    });
    await fs.mkdir(this.paths.acmeDir, { recursive: true, mode: mode0700 });
    await fs.mkdir(this.paths.acmeCertsDir, {
      recursive: true,
      mode: mode0700,
    });
    await fs.mkdir(this.paths.acmeChallengeDir, {
      recursive: true,
      mode: mode0755,
    });
    // Re-chmod in case the dir already existed with a wider mode (e.g.
    // a previous run failed mid-way). recursive:true doesn't tighten.
    try {
      await fs.chmod(this.paths.acmeDir, mode0700);
    } catch {
      /* tolerate missing chmod in some test sandboxes */
    }
  }

  /**
   * Write `<WEBSITES_NGINX_INCLUDE_PATH>` containing the single include
   * directive that points host nginx at DinoPanel's conf.d. Idempotent —
   * we always overwrite the same bytes.
   */
  async ensureNginxInclude(): Promise<void> {
    const content = `# Managed by DinoPanel — do not edit.\ninclude ${this.paths.nginxConfDir}/*.conf;\n`;
    await fs.mkdir(dirname(this.nginxIncludePath), { recursive: true });
    await fs.writeFile(this.nginxIncludePath, content, {
      encoding: 'utf8',
      mode: 0o644,
    });
  }

  private async persistDegradedFlag(reason: string): Promise<void> {
    const now = Date.now();
    await this.db
      .insert(settings)
      .values({
        key: WEBSITES_BOOTSTRAP_FLAG,
        value: JSON.stringify({ at: now, reason }),
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: JSON.stringify({ at: now, reason }), updatedAt: now },
      });
  }

  private async clearDegradedFlag(): Promise<void> {
    await this.db
      .delete(settings)
      .where(eq(settings.key, WEBSITES_BOOTSTRAP_FLAG));
  }
}
