import { z } from 'zod';

// ---------------------------------------------------------------------------
// Nexus Repository traffic monitoring (v0.6.9)
// ---------------------------------------------------------------------------

// http/https URL with an optional port and no path — the module appends its own paths.
const urlField = z
  .string()
  .min(1)
  .max(200)
  .regex(/^https?:\/\/[A-Za-z0-9][A-Za-z0-9._-]*(?::\d{1,5})?$/, 'Expected http(s)://host[:port] with no path');

/** Sonatype does not expose the community-edition quota anywhere in its API, so the
 *  panel keeps it as editable configuration. These are the documented CE defaults. */
export const CE_REQUESTS_PER_DAY_LIMIT = 200_000;
export const CE_COMPONENTS_LIMIT = 100_000;
/** Nexus's own usage centre turns amber at 75% — mirror it. */
export const USAGE_WARN_RATIO = 0.75;

const limitField = z.number().int().positive().max(1_000_000_000);

export const nexusInstanceSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(64),
  url: urlField,
  username: z.string().max(128),
  /** A password is stored (encrypted); the password itself is never returned. */
  hasPassword: z.boolean(),
  requestsPerDayLimit: limitField,
  componentsLimit: limitField,
});
export type NexusInstance = z.infer<typeof nexusInstanceSchema>;

export const createNexusInstanceSchema = z.object({
  name: z.string().min(1).max(64),
  url: urlField,
  username: z.string().min(1).max(128),
  /** Needs the `nexus:metrics:read` privilege to reach /service/rest/metrics/prometheus. */
  password: z.string().min(1).max(256),
  requestsPerDayLimit: limitField.default(CE_REQUESTS_PER_DAY_LIMIT),
  componentsLimit: limitField.default(CE_COMPONENTS_LIMIT),
});
export type CreateNexusInstance = z.infer<typeof createNexusInstanceSchema>;
/** Pre-parse shape: the limits may be omitted and fall back to the CE defaults. */
export type CreateNexusInstanceInput = z.input<typeof createNexusInstanceSchema>;

/** One scrape of the cumulative counters Nexus exposes. */
export const nexusMetricsSchema = z.object({
  requests: z.number(),
  resp2xx: z.number(),
  resp3xx: z.number(),
  resp4xx: z.number(),
  resp5xx: z.number(),
  bytesDown: z.number(),
  bytesUp: z.number(),
  byFormat: z.record(z.string(), z.object({ down: z.number(), up: z.number() })),
});
export type NexusMetrics = z.infer<typeof nexusMetricsSchema>;

export const updateNexusLimitsSchema = z.object({
  requestsPerDayLimit: limitField,
  componentsLimit: limitField,
});
export type UpdateNexusLimits = z.infer<typeof updateNexusLimitsSchema>;

/** Community-edition quota counters, read from /service/rest/internal/ui/usage-metrics. */
export const nexusUsageSchema = z.object({
  requests24h: z.number(),
  componentCount: z.number(),
  uniqueUsers30d: z.number(),
  peakRequestsPerDay30d: z.number(),
  peakRequestsPerMinute1d: z.number(),
});
export type NexusUsage = z.infer<typeof nexusUsageSchema>;

/** Per-second rates over one bucket; `ts` is the bucket's closing sample.
 *  `requests24h` is a gauge, not a rate: it is the bucket's last reported value. */
export const nexusPointSchema = z.object({
  ts: z.number(),
  requests: z.number(),
  errors: z.number(),
  bytesDown: z.number(),
  bytesUp: z.number(),
  requests24h: z.number().nullable(),
});
export type NexusPoint = z.infer<typeof nexusPointSchema>;

export const nexusRangeSchema = z.enum(['1h', '24h', '7d']);
export type NexusRange = z.infer<typeof nexusRangeSchema>;

export const nexusSeriesSchema = z.object({
  range: nexusRangeSchema,
  points: z.array(nexusPointSchema),
  /** Latest cumulative totals, or null when the instance has never been scraped. */
  latest: nexusMetricsSchema.nullable(),
  /** Latest community-edition quota figures; null when the account cannot read them. */
  usage: nexusUsageSchema.nullable(),
  /** When the latest sample was taken. */
  latestTs: z.number().nullable(),
});
export type NexusSeries = z.infer<typeof nexusSeriesSchema>;

export const nexusRepositorySchema = z.object({
  name: z.string(),
  format: z.string(),
  type: z.string(),
  online: z.boolean(),
  size: z.number().nullable(),
});
export type NexusRepository = z.infer<typeof nexusRepositorySchema>;
