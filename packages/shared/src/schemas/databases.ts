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

// External PMM service shape — PMM-monitored DBs that are NOT
// managed by DinoPanel. Read-only; no credentials, no actions.
// Engine union includes 'mariadb' for completeness even though PMM
// 2.x reports MariaDB under the mysql bucket (no current way to
// distinguish — kept here for forward compatibility).
export const pmmExternalServiceSchema = z.object({
  serviceId: z.string(),
  serviceName: z.string(),
  engine: z.enum([
    'mysql',
    'mariadb',
    'postgresql',
    'mongodb',
    'redis',
    'unknown',
  ]),
  nodeId: z.string(),
  address: z.string().nullable(),
  port: z.number().int().nullable(),
});
export type PmmExternalService = z.infer<typeof pmmExternalServiceSchema>;

// Failure surface — keep the response shape stable (services
// always present, possibly empty) and tag the error so the UI
// can render distinct copy per reason. `not_configured` is also
// surfaced rather than hidden so the section can collapse cleanly.
export const pmmExternalErrorReasonSchema = z.enum([
  'not_configured',
  'auth',
  'unreachable',
  'bad_response',
]);
export type PmmExternalErrorReason = z.infer<
  typeof pmmExternalErrorReasonSchema
>;

// PMM API credentials surface for /settings. v0.4.5 adds the missing
// UI for monitoring.pmm_api_token + monitoring.pmm_tls_skip_verify
// (previously only settable via .env, surfaced as a usability bug
// during v0.4.4 Rocky 234 troubleshooting).
export const pmmCredentialsViewSchema = z.object({
  // Whether a token is stored in settings. The token value itself is
  // never returned to the UI (parity with Cloudflare token handling).
  tokenSet: z.boolean(),
  // null = no override stored, fall back to env default;
  // true / false = explicit override
  tlsSkipVerify: z.boolean().nullable(),
});
export type PmmCredentialsView = z.infer<typeof pmmCredentialsViewSchema>;

export const pmmCredentialsUpdateSchema = z.object({
  // null = no change to stored token; '' = clear; non-empty = replace
  apiToken: z.string().nullable(),
  // null = clear setting (fall back to env default); explicit override
  tlsSkipVerify: z.boolean().nullable(),
});
export type PmmCredentialsUpdate = z.infer<typeof pmmCredentialsUpdateSchema>;

export const pmmExternalServicesResponseSchema = z.object({
  services: z.array(pmmExternalServiceSchema),
  error: z
    .object({ reason: pmmExternalErrorReasonSchema })
    .nullable(),
  // Epoch ms when this snapshot was taken — frontend can show
  // "last refreshed N seconds ago". When served from cache this
  // is the original fetch time, not the cache-hit time.
  fetchedAt: z.number().int(),
});
export type PmmExternalServicesResponse = z.infer<
  typeof pmmExternalServicesResponseSchema
>;
