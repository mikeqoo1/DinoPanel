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
import type {
  FirewallBackend,
  FirewallRule,
  StagedRuleResponse,
  StageFirewallRuleBody,
  Fail2banEntry,
} from '@dinopanel/shared';
import { DRIZZLE_DB, type Db } from '../../database/db.module';
import { firewallRuleMeta } from '../../database/schema';
import type { AppConfig } from '../../config/configuration';
import {
  FirewallCommandError,
  type FirewallDriver,
  type RawRule,
} from './firewall-driver';
import { runCommand } from './drivers/run-command';

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

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Db,
    @Inject(FIREWALL_DRIVER) private readonly driver: FirewallDriver,
    private readonly logger: Logger,
    private readonly config: ConfigService<{ app: AppConfig }>,
  ) {}

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

  async getStatus(): Promise<{ backend: FirewallBackend; enabled: boolean; fail2ban: boolean }> {
    const { enabled } = await this.driver.getStatus();
    return {
      backend: this.driver.backend,
      enabled,
      fail2ban: this.fail2banAvailable,
    };
  }

  async enable(): Promise<void> {
    await this.driver.enable();
  }

  async disable(): Promise<void> {
    await this.driver.disable();
  }

  async listRules(): Promise<FirewallRule[]> {
    const kernel = await this.driver.listRules();
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
    await this.driver.removeRule({
      port: r.port,
      proto: r.proto,
      source: r.source,
      action: r.action,
    });
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
    try {
      const result = await runCommand('fail2ban-client', ['ping']);
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  async fail2banBanned(): Promise<Fail2banEntry[]> {
    if (!this.fail2banAvailable) {
      throw new BadRequestException({ code: 'FAIL2BAN_NOT_AVAILABLE' });
    }
    const status = await runCommand('fail2ban-client', ['status']);
    const jailMatch = /Jail list:\s*([^\n]+)/.exec(status.stdout);
    const jails = jailMatch
      ? jailMatch[1]!.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    const out: Fail2banEntry[] = [];
    for (const jail of jails) {
      const detail = await runCommand('fail2ban-client', ['status', jail]);
      const banned = /Banned IP list:\s*([^\n]+)/.exec(detail.stdout);
      if (!banned || !banned[1]) continue;
      const ips = banned[1].split(/\s+/).filter(Boolean);
      for (const ip of ips) out.push({ ip, jail, bannedAt: null });
    }
    return out;
  }

  async fail2banUnban(ip: string, jail: string): Promise<{ ok: true }> {
    if (!this.fail2banAvailable) {
      throw new BadRequestException({ code: 'FAIL2BAN_NOT_AVAILABLE' });
    }
    const result = await runCommand('fail2ban-client', ['set', jail, 'unbanip', ip]);
    if (result.exitCode !== 0) {
      throw new BadRequestException({
        code: 'FAIL2BAN_UNBAN_FAILED',
        message: result.stderr || 'fail2ban-client unbanip failed',
      });
    }
    return { ok: true };
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
        if (err instanceof FirewallCommandError) {
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
