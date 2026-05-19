import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { eq } from 'drizzle-orm';
import type {
  ReconcileResponse,
  SiteCertInfo,
  SiteCreate,
  SitePatch,
  SitePayload,
  SiteResponse,
  SiteType,
} from '@dinopanel/shared';
import { DRIZZLE_DB, type Db } from '../../database/db.module';
import { sites, type Site } from '../../database/schema';
import { renderSiteConf, type RenderContext } from './conf-renderer';
import { NginxCommandError, NginxService } from './nginx.service';

/**
 * Owns the file-truth side of the websites module.
 *
 * Q2 (decisions.md) commits to "files win on conflict" — every mutating
 * operation goes through `writeConfWithRollback()` so a failed
 * `nginx -t` leaves disk + DB in a consistent good state (the previous
 * conf is restored before we report the failure). The DB metadata row
 * is upserted only after both validate and reload succeed.
 */
@Injectable()
export class SitesService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Db,
    private readonly nginx: NginxService,
    private readonly logger: Logger,
  ) {}

  // -------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------

  async list(): Promise<SiteResponse[]> {
    const rows = await this.db.select().from(sites);
    return rows.map((r) => this.rowToResponse(r));
  }

  async getById(id: number): Promise<SiteResponse> {
    const row = await this.findRow(id);
    return this.rowToResponse(row);
  }

  async getConf(id: number): Promise<{ path: string; content: string }> {
    const row = await this.findRow(id);
    const path = this.nginx.siteConfPath(row.name);
    try {
      const content = await fs.readFile(path, 'utf8');
      return { path, content };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NotFoundException({
          code: 'SITE_CONF_MISSING_ON_DISK',
          message: `Conf file ${path} missing — DB row marked orphaned`,
        });
      }
      throw err;
    }
  }

  // -------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------

  async create(input: SiteCreate): Promise<SiteResponse> {
    await this.ensureNameAvailable(input.name);

    const content = this.render({
      name: input.name,
      primaryDomain: input.primaryDomain,
      payload: input.payload,
      cert: null,
    });

    await this.writeConfWithRollback(input.name, content);
    await this.ensureSiteContentDir(input.name, input.payload.type);

    const now = Date.now();
    const inserted = await this.db
      .insert(sites)
      .values({
        name: input.name,
        primaryDomain: input.primaryDomain,
        type: input.payload.type,
        payload: input.payload,
        managedByDinopanel: true,
        orphaned: false,
        certPaths: null,
        certExpiresAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error('sites insert returned no row');
    return this.rowToResponse(row);
  }

  async update(id: number, patch: SitePatch): Promise<SiteResponse> {
    const row = await this.findRow(id);
    const nextPayload: SitePayload =
      patch.payload ?? (row.payload as SitePayload);
    const nextDomain = patch.primaryDomain ?? row.primaryDomain;

    const content = this.render({
      name: row.name,
      primaryDomain: nextDomain,
      payload: nextPayload,
      cert: row.certPaths as SiteCertInfo | null,
    });

    await this.writeConfWithRollback(row.name, content);

    const now = Date.now();
    const updated = await this.db
      .update(sites)
      .set({
        primaryDomain: nextDomain,
        type: nextPayload.type,
        payload: nextPayload,
        orphaned: false,
        updatedAt: now,
      })
      .where(eq(sites.id, id))
      .returning();
    const result = updated[0];
    if (!result) throw new Error('sites update returned no row');
    return this.rowToResponse(result);
  }

  async remove(id: number): Promise<void> {
    const row = await this.findRow(id);
    const path = this.nginx.siteConfPath(row.name);
    try {
      await fs.unlink(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    try {
      await this.nginx.reload();
    } catch (err) {
      // Conf is already gone — reload failure here means systemd / sudo
      // is broken; log and continue. The DB row still goes away so the
      // user can retry from a clean state.
      this.logger.warn({ err, id }, 'sites.remove.reload_failed');
    }
    await this.db.delete(sites).where(eq(sites.id, id));
  }

  // -------------------------------------------------------------------
  // Reconcile (managed-row orphan detection)
  // -------------------------------------------------------------------

  /**
   * Walks the conf directory, marks rows whose conf file is missing as
   * orphaned, and reports counts.
   *
   * Phase 2 deliberately does NOT import non-managed (`external`)
   * conf files as DB rows — see deviation log in `tasks.md`. External
   * conf discovery defers to Phase 5 once the response schema gains
   * a managed/external discriminator.
   */
  async reconcile(): Promise<ReconcileResponse> {
    const dir = this.nginx.getPaths().nginxConfDir;
    let onDisk: Set<string>;
    try {
      const entries = await fs.readdir(dir);
      onDisk = new Set(
        entries
          .filter((e) => e.endsWith('.conf'))
          .map((e) => e.slice(0, -'.conf'.length)),
      );
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        onDisk = new Set();
      } else {
        throw err;
      }
    }

    const rows = await this.db.select().from(sites);
    for (const row of rows) {
      const fileMissing = !onDisk.has(row.name);
      if (fileMissing && !row.orphaned) {
        await this.db
          .update(sites)
          .set({ orphaned: true, updatedAt: Date.now() })
          .where(eq(sites.id, row.id));
      } else if (!fileMissing && row.orphaned) {
        // File reappeared (e.g. operator restored from backup) — clear
        // the flag so the UI stops nagging.
        await this.db
          .update(sites)
          .set({ orphaned: false, updatedAt: Date.now() })
          .where(eq(sites.id, row.id));
      }
    }

    const externalCount = [...onDisk].filter(
      (name) => !rows.some((r) => r.name === name),
    ).length;
    if (externalCount > 0) {
      this.logger.warn(
        { count: externalCount },
        'sites.reconcile.external_confs_seen',
      );
    }

    return {
      scanned: onDisk.size,
      imported: 0,
      orphaned: rows.filter((r) => !onDisk.has(r.name)).length,
    };
  }

  // -------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------

  private rowToResponse(row: Site): SiteResponse {
    return {
      id: row.id,
      name: row.name,
      primaryDomain: row.primaryDomain,
      type: row.type as SiteType,
      payload: row.payload as SitePayload,
      managedByDinopanel: row.managedByDinopanel,
      orphaned: row.orphaned,
      certPaths: row.certPaths as SiteCertInfo | null,
      certExpiresAt: row.certExpiresAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async findRow(id: number): Promise<Site> {
    const rows = await this.db
      .select()
      .from(sites)
      .where(eq(sites.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundException({ code: 'SITE_NOT_FOUND' });
    return row;
  }

  private async ensureNameAvailable(name: string): Promise<void> {
    const existing = await this.db
      .select({ id: sites.id })
      .from(sites)
      .where(eq(sites.name, name))
      .limit(1);
    if (existing.length > 0) {
      throw new ConflictException({
        code: 'SITE_NAME_TAKEN',
        message: `A site named "${name}" already exists`,
      });
    }
    // Also guard the conf-file path: an external file with this name
    // would silently get overwritten otherwise.
    const path = this.nginx.siteConfPath(name);
    try {
      await fs.access(path);
      throw new ConflictException({
        code: 'SITE_CONF_PATH_TAKEN',
        message: `Conf file already exists at ${path} (external?)`,
      });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  private render(args: {
    name: string;
    primaryDomain: string;
    payload: SitePayload;
    cert: SiteCertInfo | null;
  }): string {
    const ctx: RenderContext = {
      name: args.name,
      primaryDomain: args.primaryDomain,
      payload: args.payload,
      siteRoot: this.nginx.siteRoot(args.name),
      acmeRoot: this.nginx.acmeRoot(),
      cert: args.cert,
    };
    return renderSiteConf(ctx);
  }

  /**
   * Atomic conf swap with rollback.
   *
   * 1. If a current `<name>.conf` exists, copy it to `<name>.conf.bak`.
   * 2. Write the new content to `<name>.conf.tmp`, then `fs.rename` to
   *    `<name>.conf` (atomic on POSIX — see open(2) RENAME_EXCHANGE
   *    semantics on Linux >= 3.15 / glibc 2.20).
   * 3. `nginx -t` reads the live conf tree from disk and reports.
   *    On failure: restore the backup atomically and best-effort reload
   *    to put the in-memory nginx on the known-good config, then throw
   *    `SITE_CONF_INVALID`.
   * 4. On success: delete the backup, `systemctl reload nginx`.
   */
  private async writeConfWithRollback(
    name: string,
    content: string,
  ): Promise<void> {
    const confPath = this.nginx.siteConfPath(name);
    const backupPath = `${confPath}.bak`;
    const tmpPath = `${confPath}.tmp`;

    await fs.mkdir(dirname(confPath), { recursive: true });

    let hadPrevious = false;
    try {
      await fs.access(confPath);
      await fs.copyFile(confPath, backupPath);
      hadPrevious = true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }

    await fs.writeFile(tmpPath, content, { encoding: 'utf8', mode: 0o644 });
    await fs.rename(tmpPath, confPath);

    try {
      await this.nginx.validate();
    } catch (validateErr) {
      // Rollback
      if (hadPrevious) {
        await fs.rename(backupPath, confPath).catch((err) =>
          this.logger.error(
            { err, name },
            'sites.rollback.backup_restore_failed',
          ),
        );
        // Best-effort reload to ensure the in-memory nginx is on the
        // restored config. If this fails too the user already has a
        // bigger problem (sudo / systemd); log and proceed to throw.
        await this.nginx.reload().catch((err) =>
          this.logger.warn(
            { err, name },
            'sites.rollback.post_restore_reload_failed',
          ),
        );
      } else {
        await fs.unlink(confPath).catch(() => undefined);
      }
      const detail =
        validateErr instanceof NginxCommandError
          ? validateErr.stderr ?? validateErr.message
          : String(validateErr);
      throw new BadRequestException({
        code: 'SITE_CONF_INVALID',
        message: 'nginx -t rejected the generated conf',
        detail,
      });
    }

    if (hadPrevious) {
      await fs.unlink(backupPath).catch(() => undefined);
    }

    await this.nginx.reload();
  }

  /**
   * Static + PHP sites need a content root on disk for nginx's `root`
   * directive to resolve. Reverse-proxy sites don't.
   */
  private async ensureSiteContentDir(
    name: string,
    type: SiteType,
  ): Promise<void> {
    if (type === 'reverse_proxy') return;
    const root = this.nginx.siteRoot(name);
    await fs.mkdir(`${root}/public`, { recursive: true, mode: 0o755 });
  }
}
