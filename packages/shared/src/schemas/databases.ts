import { z } from 'zod';

// v0.4 databases module — all-container (decisions.md Q1).
// Container name convention: `dinopanel-<engine>-<name>`. The
// containerName is the canonical PMM service_name (decisions.md
// Q5 + spec.md §PromQL bundles).

export const dbEngineSchema = z.enum([
  'mysql',
  'mariadb',
  'postgresql',
  'redis',
  'mongodb',
]);
export type DbEngine = z.infer<typeof dbEngineSchema>;

// Instance name = container suffix. Lowercase alnum + dash so it
// survives docker container naming + PMM service_name regex.
export const dbInstanceNameSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'Lowercase letters, digits, and - only');
export type DbInstanceName = z.infer<typeof dbInstanceNameSchema>;

export const dbInstanceStatusSchema = z.enum([
  'running',
  'stopped',
  'restarting',
  'creating',
  'removing',
  'error',
]);
export type DbInstanceStatus = z.infer<typeof dbInstanceStatusSchema>;

// Strong-default credentials are generated server-side; operator
// override is optional. Password length matches the 32-char
// crypto.randomBytes default the service generates.
const dbCustomCredentialsSchema = z.object({
  username: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'SQL-identifier-safe characters only'),
  password: z.string().min(8).max(128),
});
export type DbCustomCredentials = z.infer<typeof dbCustomCredentialsSchema>;

export const createDbInstanceSchema = z.object({
  name: dbInstanceNameSchema,
  engine: dbEngineSchema,
  // Optional — driver default applies when omitted.
  imageTag: z.string().min(1).max(128).optional(),
  port: z.number().int().min(1024).max(65535),
  customCredentials: dbCustomCredentialsSchema.optional(),
});
export type CreateDbInstance = z.infer<typeof createDbInstanceSchema>;

export const patchDbInstanceSchema = z.object({
  imageTag: z.string().min(1).max(128).optional(),
  // Future-proof: keep open for v0.5 metadata-only edits.
});
export type PatchDbInstance = z.infer<typeof patchDbInstanceSchema>;

export const removeDbInstanceSchema = z.object({
  dropData: z.boolean(),
});
export type RemoveDbInstance = z.infer<typeof removeDbInstanceSchema>;

export const dbInstanceSchema = z.object({
  id: z.number().int(),
  name: dbInstanceNameSchema,
  engine: dbEngineSchema,
  imageTag: z.string(),
  port: z.number().int(),
  username: z.string(),
  // Plaintext per Q3. Audit/log redaction policy lives server-side
  // (spec.md §Audit + log redaction policy).
  password: z.string(),
  dataDir: z.string(),
  containerName: z.string(),
  status: dbInstanceStatusSchema,
  lastError: z.string().nullable(),
  pmmRegistered: z.boolean(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type DbInstanceResponse = z.infer<typeof dbInstanceSchema>;

export const dbHealthSchema = z.object({
  ok: z.boolean(),
  // Engine-reported detail when available (e.g. mysql uptime,
  // postgres server version). Free-form string keeps the type
  // narrow without growing per engine.
  detail: z.string().nullable(),
});
export type DbHealth = z.infer<typeof dbHealthSchema>;

// One metric field per PromQL bundle entry. null = PMM
// unreachable / query returned no vector — UI renders as "—".
export const dbMetricsSummarySchema = z.object({
  qps: z.number().nullable(),
  connections: z.number().nullable(),
  uptimeSeconds: z.number().nullable(),
  replicationLagSeconds: z.number().nullable(),
  // Surface when monitoring.pmm_url unset, lets UI hide cards
  // instead of showing 4 dashes.
  pmmConfigured: z.boolean(),
});
export type DbMetricsSummary = z.infer<typeof dbMetricsSummarySchema>;

export const dbReconcileResponseSchema = z.object({
  scanned: z.number().int(),
  matched: z.number().int(),
  missingContainer: z.number().int(),
  orphanContainer: z.number().int(),
});
export type DbReconcileResponse = z.infer<typeof dbReconcileResponseSchema>;
