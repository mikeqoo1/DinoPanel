import type { FirewallAction, FirewallBackend, FirewallProto } from '@dinopanel/shared';

/**
 * A kernel-level rule observed via the active backend. `comment` /
 * `createdBy` etc. are NOT here — those come from our metadata table
 * and are joined at the service layer. Drivers stay close to what
 * ufw / firewall-cmd actually report.
 */
export interface RawRule {
  port: number;
  proto: FirewallProto;
  source: string | null;
  action: FirewallAction;
}

export interface FirewallDriver {
  readonly backend: FirewallBackend;
  getStatus(): Promise<{ enabled: boolean }>;
  enable(): Promise<void>;
  disable(): Promise<void>;
  listRules(): Promise<RawRule[]>;
  addRule(rule: RawRule): Promise<void>;
  removeRule(rule: RawRule): Promise<void>;
}

export class FirewallNotConfiguredError extends Error {
  constructor() {
    super('Neither ufw nor firewall-cmd is installed');
    this.name = 'FirewallNotConfiguredError';
  }
}

// FirewallCommandError was removed in v0.6 Phase 0 — the firewall module now
// uses the shared `CommandError` from `common/shell/run-command`, re-wrapped at
// the service layer via `commandErrorToHttp(err, 'FIREWALL')` so the public
// FIREWALL_TOOL_MISSING / FIREWALL_PERMISSION_DENIED / FIREWALL_COMMAND_FAILED /
// FIREWALL_SPAWN_ERROR codes are preserved.
