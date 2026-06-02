import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import { and, eq, isNull, lt, isNotNull } from 'drizzle-orm';
import { fail2banJailNameSchema } from '@dinopanel/shared';
import type {
  FirewallBackend,
  FirewallRule,
  StagedRuleResponse,
  StageFirewallRuleBody,
  Fail2banEntry,
  Fail2banJail,
} from '@dinopanel/shared';
import { DRIZZLE_DB, type Db } from '../../database/db.module';
import { firewallRuleMeta } from '../../database/schema';
import type { AppConfig } from '../../config/configuration';
import {
  type FirewallDriver,
  type RawRule,
} from './firewall-driver';
import {
  CommandError,
  assertSuccess,
  commandErrorToHttp,
  probeCommand,
  runCommand,
} from '../../common/shell/run-command';

export const FIREWALL_DRIVER = Symbol('FIREWALL_DRIVER');

interface StagedEntry {
  metaId: number;
  rule: RawRule;
  timer: NodeJS.Timeout;
  expiresAt: number;
}

const STAGE_CONFIRM_MS = 30_000;
const STARTUP_ORPHAN_THRESHOLD_MS = 60_000;

@Injectable()
export class FirewallService implements OnApplicationBootstrap, OnModuleDestroy {
  private staged = new Map<number, StagedEntry>();
  private fail2banAvailable = false;
  // fail2ban-client needs root; reuse the toolbox sudo posture (sudo -n is a
  // no-op when the panel already runs as root). Read once in the constructor.
  private readonly fail2banSudo: boolean;

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Db,
    @Inject(FIREWALL_DRIVER) private readonly driver: FirewallDriver,
    private readonly logger: Logger,
    private readonly config: ConfigService<{ app: AppConfig }>,
  ) {
    const app = this.config.get<AppConfig>('app', { infer: true });
    this.fail2banSudo = app?.env.TOOLBOX_REQUIRE_SUDO ?? false;
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.recoverySweep();
    this.fail2banAvailable = await this.probeFail2ban();
    this.logger.debug(
      { backend: this.driver.backend, fail2ban: this.fail2banAvailable },
      'firewall.bootstrap',
    );
  }

  onModuleDestroy(): void {
    for (const [, entry] of this.staged) clearTimeout(entry.timer);
    this.staged.clear();
  }

  getBackend(): FirewallBackend {
    return this.driver.backend;
  }

  hasFail2ban(): boolean {
    return this.fail2banAvailable;
  }

  /**
   * Run a host-touching driver op, re-wrapping any {@link CommandError} as a
   * coded HttpException (`FIREWALL_*`) so `ApiExceptionFilter` surfaces a real
   * `code` instead of dropping a bare Error to a generic 500. This is the
   * shared re-wrap standard the v0.6 toolbox module also uses.
   */
  private async driverOp<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof CommandError) throw commandErrorToHttp(err, 'FIREWALL');
      throw err;
    }
  }

  async getStatus(): Promise<{ backend: FirewallBackend; enabled: boolean; fail2ban: boolean }> {
    const { enabled } = await this.driverOp(() => this.driver.getStatus());
    return {
      backend: this.driver.backend,
      enabled,
      fail2ban: this.fail2banAvailable,
    };
  }

  async enable(): Promise<void> {
    await this.driverOp(() => this.driver.enable());
  }

  async disable(): Promise<void> {
    await this.driverOp(() => this.driver.disable());
  }

  async listRules(): Promise<FirewallRule[]> {
    const kernel = await this.driverOp(() => this.driver.listRules());
    const metaRows = await this.db
      .select()
      .from(firewallRuleMeta)
      .where(isNotNull(firewallRuleMeta.confirmedAt));
    return kernel.map((kernelRule) => {
      const meta = metaRows.find(
        (m) =>
          m.port === kernelRule.port &&
          m.proto === kernelRule.proto &&
          (m.source ?? null) === (kernelRule.source ?? null) &&
          m.action === kernelRule.action,
      );
      return {
        id: meta?.id ?? null,
        port: kernelRule.port,
        proto: kernelRule.proto,
        source: kernelRule.source,
        action: kernelRule.action,
        comment: meta?.comment ?? null,
        createdBy: meta?.createdBy ?? null,
        createdAt: meta?.createdAt ?? null,
        confirmedAt: meta?.confirmedAt ?? null,
        external: !meta,
      };
    });
  }

  async stage(
    body: StageFirewallRuleBody,
    userId: number | null,
  ): Promise<StagedRuleResponse> {
    this.enforceSelfProtect(body);
    const rule: RawRule = {
      port: body.port,
      proto: body.proto,
      source: body.source ?? null,
      action: body.action,
    };

    // Persist metadata FIRST (so a crash mid-driver still gives us the
    // staged_at timestamp for the boot recovery sweep)
    const stagedAt = Date.now();
    const inserted = await this.db
      .insert(firewallRuleMeta)
      .values({
        port: rule.port,
        proto: rule.proto,
        source: rule.source,
        action: rule.action,
        comment: body.comment ?? null,
        createdBy: userId,
        stagedAt,
      })
      .returning({ id: firewallRuleMeta.id });
    const metaId = inserted[0]?.id;
    if (metaId === undefined) throw new Error('staged metadata insert returned no row');

    try {
      await this.driver.addRule(rule);
    } catch (err) {
      // Roll back the metadata row; the kernel rule was never added
      await this.db.delete(firewallRuleMeta).where(eq(firewallRuleMeta.id, metaId));
      if (err instanceof CommandError) throw commandErrorToHttp(err, 'FIREWALL');
      throw err;
    }

    const expiresAt = stagedAt + STAGE_CONFIRM_MS;
    const timer = setTimeout(() => {
      void this.autoRevert(metaId).catch((err) =>
        this.logger.warn({ err, metaId }, 'firewall.auto_revert_failed'),
      );
    }, STAGE_CONFIRM_MS);
    this.staged.set(metaId, { metaId, rule, timer, expiresAt });

    return { stagedId: metaId, expiresAt };
  }

  async confirm(stagedId: number): Promise<{ ok: true }> {
    const entry = this.staged.get(stagedId);
    if (!entry) {
      // May still be valid if the row exists but the timer was cancelled
      // (e.g. after restart). Look up the row directly.
      const row = await this.db
        .select()
        .from(firewallRuleMeta)
        .where(eq(firewallRuleMeta.id, stagedId))
        .limit(1);
      if (!row[0]) throw new NotFoundException({ code: 'STAGED_RULE_NOT_FOUND' });
      if (row[0].confirmedAt) return { ok: true };
      throw new BadRequestException({
        code: 'STAGED_RULE_EXPIRED',
        message: 'Confirmation window already closed',
      });
    }

    // Step 1: write confirming_at, flush (sync via better-sqlite3)
    const now = Date.now();
    await this.db
      .update(firewallRuleMeta)
      .set({ confirmingAt: now })
      .where(eq(firewallRuleMeta.id, stagedId));

    // Step 2: cancel timer + drop in-memory entry
    clearTimeout(entry.timer);
    this.staged.delete(stagedId);

    // Step 3: write confirmed_at (a crash anywhere from now → response
    // results in the boot sweep promoting confirming_at → confirmed_at)
    await this.db
      .update(firewallRuleMeta)
      .set({ confirmedAt: now })
      .where(eq(firewallRuleMeta.id, stagedId));

    return { ok: true };
  }

  async cancelStage(stagedId: number): Promise<{ ok: true }> {
    const entry = this.staged.get(stagedId);
    if (!entry) throw new NotFoundException({ code: 'STAGED_RULE_NOT_FOUND' });
    clearTimeout(entry.timer);
    this.staged.delete(stagedId);
    try {
      await this.driver.removeRule(entry.rule);
    } catch (err) {
      this.logger.warn({ err, stagedId }, 'firewall.cancel_remove_failed');
    }
    await this.db.delete(firewallRuleMeta).where(eq(firewallRuleMeta.id, stagedId));
    return { ok: true };
  }

  async removeRule(metaId: number): Promise<{ ok: true }> {
    const row = await this.db
      .select()
      .from(firewallRuleMeta)
      .where(eq(firewallRuleMeta.id, metaId))
      .limit(1);
    if (!row[0]) throw new NotFoundException({ code: 'RULE_NOT_FOUND' });
    const r = row[0];
    await this.driverOp(() =>
      this.driver.removeRule({
        port: r.port,
        proto: r.proto,
        source: r.source,
        action: r.action,
      }),
    );
    await this.db.delete(firewallRuleMeta).where(eq(firewallRuleMeta.id, metaId));
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // Self-protect
  // -------------------------------------------------------------------------

  /**
   * Reject rules that would deny access to the panel's own bind port or
   * SSH unless `acknowledgeSelfLockout: true` is in the request.
   */
  private enforceSelfProtect(body: StageFirewallRuleBody): void {
    if (body.action !== 'deny') return;
    if (body.acknowledgeSelfLockout === true) return;

    const cfg = this.config.get<AppConfig>('app', { infer: true });
    const panelPort = cfg?.env.PORT ?? 9999;
    const sshPort = cfg?.env.SSH_PORT ?? 22;

    const isPanel = body.port === panelPort;
    const isSsh = body.port === sshPort;
    if (!isPanel && !isSsh) return;

    throw new BadRequestException({
      code: 'FIREWALL_SELF_LOCKOUT',
      message: isPanel
        ? `Refusing to deny port ${panelPort} (the panel's bind port). Set acknowledgeSelfLockout: true to override.`
        : `Refusing to deny port ${sshPort} (SSH). Set acknowledgeSelfLockout: true to override.`,
    });
  }

  // -------------------------------------------------------------------------
  // Fail2Ban (optional)
  // -------------------------------------------------------------------------

  private async probeFail2ban(): Promise<boolean> {
    return probeCommand('fail2ban-client', ['ping'], { sudo: this.fail2banSudo });
  }

  private requireFail2ban(): void {
    if (!this.fail2banAvailable) {
      throw new BadRequestException({ code: 'FAIL2BAN_NOT_AVAILABLE' });
    }
  }

  private fail2ban(args: string[]): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
    return runCommand('fail2ban-client', args, { sudo: this.fail2banSudo });
  }

  /** Guard: the jail must exist in the live jail list before any mutation. */
  private async assertJailExists(jail: string): Promise<void> {
    const status = await this.fail2ban(['status']);
    assertSuccess(status, 'fail2ban-client status');
    if (!parseFail2banJailList(status.stdout).includes(jail)) {
      throw new BadRequestException({
        code: 'FAIL2BAN_JAIL_NOT_FOUND',
        message: `Unknown jail: ${jail}`,
      });
    }
  }

  /** Read-only: every running jail with live counters + banned IPs. */
  async fail2banJails(): Promise<Fail2banJail[]> {
    this.requireFail2ban();
    return this.driverOp(async () => {
      const status = await this.fail2ban(['status']);
      assertSuccess(status, 'fail2ban-client status');
      const out: Fail2banJail[] = [];
      for (const jail of parseFail2banJailList(status.stdout)) {
        // Skip (don't 500) a jail that races to non-zero between the list and
        // detail fetch (e.g. a concurrent stop/reload) — mirrors the
        // skip-bad-entry convention in files.service listing.
        try {
          const detail = await this.fail2ban(['status', jail]);
          assertSuccess(detail, `fail2ban-client status ${jail}`);
          out.push(parseFail2banJailDetail(jail, detail.stdout));
        } catch (err) {
          this.logger.warn({ err, jail }, 'firewall.fail2ban_jail_detail_failed');
        }
      }
      return out;
    });
  }

  async fail2banBanned(): Promise<Fail2banEntry[]> {
    this.requireFail2ban();
    return this.driverOp(async () => {
      const status = await this.fail2ban(['status']);
      assertSuccess(status, 'fail2ban-client status');
      const out: Fail2banEntry[] = [];
      for (const jail of parseFail2banJailList(status.stdout)) {
        // Skip a jail that races to non-zero (concurrent stop/reload) rather
        // than 500 the whole banned-list read.
        try {
          const detail = await this.fail2ban(['status', jail]);
          assertSuccess(detail, `fail2ban-client status ${jail}`);
          for (const ip of parseFail2banJailDetail(jail, detail.stdout).bannedIps) {
            out.push({ ip, jail, bannedAt: null });
          }
        } catch (err) {
          this.logger.warn({ err, jail }, 'firewall.fail2ban_jail_detail_failed');
        }
      }
      return out;
    });
  }

  /** Manually ban an IP in a jail: `fail2ban-client set <jail> banip <ip>`. */
  async fail2banBan(jail: string, ip: string): Promise<{ ok: true }> {
    this.requireFail2ban();
    await this.driverOp(() => this.assertJailExists(jail));
    return this.driverOp(async () => {
      const r = await this.fail2ban(['set', jail, 'banip', ip]);
      assertSuccess(r, `fail2ban-client set ${jail} banip ${ip}`);
      return { ok: true } as const;
    });
  }

  async fail2banUnban(ip: string, jail: string): Promise<{ ok: true }> {
    this.requireFail2ban();
    await this.driverOp(() => this.assertJailExists(jail));
    return this.driverOp(async () => {
      const r = await this.fail2ban(['set', jail, 'unbanip', ip]);
      assertSuccess(r, `fail2ban-client set ${jail} unbanip ${ip}`);
      return { ok: true } as const;
    });
  }

  /**
   * RUNTIME enable/disable a jail via start/stop. fail2ban has no native
   * enable/disable verb — this does NOT persist across a daemon reload, and
   * the jail must already be defined in config (start of an undefined jail
   * fails). Documented as a runtime toggle in the UI.
   */
  async fail2banSetJailEnabled(jail: string, enabled: boolean): Promise<{ ok: true }> {
    this.requireFail2ban();
    // The jail arrives as an unvalidated URL path param and (for `start`)
    // cannot be checked against the running-jail allowlist, so enforce the
    // shared safe-name shape here — no leading dash, bounded length.
    if (!fail2banJailNameSchema.safeParse(jail).success) {
      throw new BadRequestException({
        code: 'FAIL2BAN_INVALID_JAIL',
        message: `Invalid jail name: ${jail}`,
      });
    }
    return this.driverOp(async () => {
      const sub = enabled ? 'start' : 'stop';
      const r = await this.fail2ban([sub, jail]);
      assertSuccess(r, `fail2ban-client ${sub} ${jail}`);
      return { ok: true } as const;
    });
  }

  // -------------------------------------------------------------------------
  // Boot-time recovery sweep (spec.md §1)
  // -------------------------------------------------------------------------

  private async recoverySweep(): Promise<void> {
    const now = Date.now();
    const cutoff = now - STARTUP_ORPHAN_THRESHOLD_MS;

    // 1. Revert orphans: confirmed_at IS NULL AND confirming_at IS NULL
    //    AND staged_at < cutoff
    const orphans = await this.db
      .select()
      .from(firewallRuleMeta)
      .where(
        and(
          isNull(firewallRuleMeta.confirmedAt),
          isNull(firewallRuleMeta.confirmingAt),
          lt(firewallRuleMeta.stagedAt, cutoff),
        ),
      );
    for (const row of orphans) {
      try {
        await this.driver.removeRule({
          port: row.port,
          proto: row.proto,
          source: row.source,
          action: row.action,
        });
      } catch (err) {
        if (err instanceof CommandError) {
          this.logger.warn({ err, id: row.id }, 'firewall.recovery_revert_failed');
        }
      }
      await this.db.delete(firewallRuleMeta).where(eq(firewallRuleMeta.id, row.id));
    }
    if (orphans.length > 0) {
      this.logger.warn({ count: orphans.length }, 'firewall.recovery.orphans_reverted');
    }

    // 2. Promote pending confirms: confirming_at IS NOT NULL AND
    //    confirmed_at IS NULL → confirmed_at = confirming_at
    await this.db
      .update(firewallRuleMeta)
      .set({ confirmedAt: now })
      .where(
        and(
          isNotNull(firewallRuleMeta.confirmingAt),
          isNull(firewallRuleMeta.confirmedAt),
        ),
      );
  }

  private async autoRevert(metaId: number): Promise<void> {
    const entry = this.staged.get(metaId);
    if (!entry) return; // already confirmed or cancelled
    this.staged.delete(metaId);
    try {
      await this.driver.removeRule(entry.rule);
    } catch (err) {
      this.logger.warn({ err, metaId }, 'firewall.auto_revert_driver_failed');
    }
    await this.db.delete(firewallRuleMeta).where(eq(firewallRuleMeta.id, metaId));
  }
}

// ---------------------------------------------------------------------------
// Pure fail2ban-client output parsers (exported for golden-string tests).
// ---------------------------------------------------------------------------

/** Parse the global `fail2ban-client status` "Jail list:" line. */
export function parseFail2banJailList(stdout: string): string[] {
  const m = /Jail list:\s*([^\n]*)/i.exec(stdout);
  if (!m || !m[1]) return [];
  return m[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Parse `fail2ban-client status <jail>` into counters + banned IP list. */
export function parseFail2banJailDetail(name: string, stdout: string): Fail2banJail {
  const num = (re: RegExp): number => {
    const m = re.exec(stdout);
    return m && m[1] ? Number(m[1]) : 0;
  };
  const bannedLine = /Banned IP list:\s*([^\n]*)/i.exec(stdout);
  const bannedIps =
    bannedLine && bannedLine[1] ? bannedLine[1].split(/\s+/).filter(Boolean) : [];
  return {
    name,
    enabled: true, // present in the running jail list => active
    currentlyFailed: num(/Currently failed:\s*(\d+)/i),
    totalFailed: num(/Total failed:\s*(\d+)/i),
    currentlyBanned: num(/Currently banned:\s*(\d+)/i),
    totalBanned: num(/Total banned:\s*(\d+)/i),
    bannedIps,
  };
}
