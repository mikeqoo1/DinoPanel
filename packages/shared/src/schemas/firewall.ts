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
