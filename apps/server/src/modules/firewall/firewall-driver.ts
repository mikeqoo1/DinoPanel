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

export class FirewallCommandError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly stderr?: string,
  ) {
    super(message);
    this.name = 'FirewallCommandError';
  }
}
