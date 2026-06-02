import { z } from 'zod';

export const firewallProtoSchema = z.enum(['tcp', 'udp', 'any']);
export type FirewallProto = z.infer<typeof firewallProtoSchema>;

export const firewallActionSchema = z.enum(['allow', 'deny']);
export type FirewallAction = z.infer<typeof firewallActionSchema>;

export const firewallBackendSchema = z.enum(['ufw', 'firewalld']);
export type FirewallBackend = z.infer<typeof firewallBackendSchema>;

export const firewallStatusSchema = z.object({
  backend: firewallBackendSchema,
  enabled: z.boolean(),
  fail2ban: z.boolean(),
});
export type FirewallStatus = z.infer<typeof firewallStatusSchema>;

export const firewallRuleSchema = z.object({
  id: z.number().int().nullable(),
  port: z.number().int().min(0).max(65535),
  proto: firewallProtoSchema,
  source: z.string().nullable(),
  action: firewallActionSchema,
  comment: z.string().nullable(),
  createdBy: z.number().int().nullable(),
  createdAt: z.number().int().nullable(),
  confirmedAt: z.number().int().nullable(),
  external: z.boolean(),
});
export type FirewallRule = z.infer<typeof firewallRuleSchema>;

export const stageFirewallRuleBodySchema = z.object({
  port: z.number().int().min(0).max(65535),
  proto: firewallProtoSchema,
  source: z.string().nullable().optional(),
  action: firewallActionSchema,
  comment: z.string().max(200).nullable().optional(),
  acknowledgeSelfLockout: z.boolean().optional(),
});
export type StageFirewallRuleBody = z.infer<typeof stageFirewallRuleBodySchema>;

export const stagedRuleResponseSchema = z.object({
  stagedId: z.number().int(),
  expiresAt: z.number().int(),
});
export type StagedRuleResponse = z.infer<typeof stagedRuleResponseSchema>;

export const fail2banEntrySchema = z.object({
  ip: z.string(),
  jail: z.string(),
  bannedAt: z.number().int().nullable(),
});
export type Fail2banEntry = z.infer<typeof fail2banEntrySchema>;

// --- v0.6 fail2ban management (extends the firewall module in place) -------

// Jail names: alnum + dot/dash/underscore (e.g. "sshd", "nginx-http-auth").
// First char is not '-' so a value can never be misread as a fail2ban-client
// option flag. The service additionally re-checks the name against the live
// jail list before any mutation (allowlist).
const JAIL_REGEX = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

// IPv4 / IPv6 / optional CIDR. A cheap anchored shape/injection guard only —
// fail2ban-client itself rejects a malformed address (linear-time, no
// catastrophic backtracking; matches the TIMEZONE_REGEX posture).
const IP_REGEX = /^(?:(?:\d{1,3}\.){3}\d{1,3}|[0-9A-Fa-f:]+)(?:\/\d{1,3})?$/;

// Safe jail-name shape (no leading dash so it can't be read as a flag). The
// single source of truth reused by the ban body and the runtime enable/disable
// path-param guard.
export const fail2banJailNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(JAIL_REGEX, 'Invalid jail name');
export type Fail2banJailName = z.infer<typeof fail2banJailNameSchema>;

// One configured/running jail with its live counters (read-only list view).
export const fail2banJailSchema = z.object({
  name: z.string(),
  // present in the running "Jail list" => active (runtime-enabled).
  enabled: z.boolean(),
  currentlyFailed: z.number().int().nonnegative(),
  totalFailed: z.number().int().nonnegative(),
  currentlyBanned: z.number().int().nonnegative(),
  totalBanned: z.number().int().nonnegative(),
  bannedIps: z.array(z.string()),
});
export type Fail2banJail = z.infer<typeof fail2banJailSchema>;

// POST /firewall/fail2ban/ban — manually ban an IP in a jail.
export const fail2banBanBodySchema = z.object({
  jail: fail2banJailNameSchema,
  ip: z.string().min(1).max(64).regex(IP_REGEX, 'Invalid IP/CIDR'),
});
export type Fail2banBanBody = z.infer<typeof fail2banBanBodySchema>;

// Reuse the ban body shape for unban — retrofits validation onto the
// previously-unvalidated /firewall/fail2ban/unban route.
export const fail2banUnbanBodySchema = fail2banBanBodySchema;
export type Fail2banUnbanBody = z.infer<typeof fail2banUnbanBodySchema>;

// POST /firewall/fail2ban/jails/:name/enabled — RUNTIME start/stop toggle
// (fail2ban has no native enable/disable verb; this does not persist across a
// daemon reload, and the jail must already be defined in config).
export const fail2banSetEnabledBodySchema = z.object({
  enabled: z.boolean(),
});
export type Fail2banSetEnabledBody = z.infer<typeof fail2banSetEnabledBodySchema>;
