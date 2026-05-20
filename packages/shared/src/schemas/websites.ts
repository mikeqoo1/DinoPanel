import { z } from 'zod';

// RFC 1035-conservative: labels 1–63 chars, total ≤ 253, no leading hyphen.
// Wildcards (*.example.com) are intentionally rejected at the schema layer —
// v0.3 issues SAN certs only, no wildcard support.
const DOMAIN_REGEX =
  /^(?=.{1,253}$)(?!-)[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})*$/;

export const domainSchema = z
  .string()
  .regex(DOMAIN_REGEX, 'Invalid domain');
export type Domain = z.infer<typeof domainSchema>;

export const upstreamUrlSchema = z
  .string()
  .url()
  .refine(
    (v) => v.startsWith('http://') || v.startsWith('https://'),
    'Upstream must use http:// or https://',
  );
export type UpstreamUrl = z.infer<typeof upstreamUrlSchema>;

// Site name = conf filename stem. Restricted to lowercase alnum + dash +
// underscore so it survives every filesystem + nginx include glob.
export const siteNameSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'Lowercase letters, digits, _ and - only');
export type SiteName = z.infer<typeof siteNameSchema>;

export const siteTypeSchema = z.enum(['static', 'reverse_proxy', 'php']);
export type SiteType = z.infer<typeof siteTypeSchema>;

// Type-specific payloads. Discriminated union → backend renders the right
// nginx template based on the discriminator.

export const staticSitePayloadSchema = z.object({
  type: z.literal('static'),
  indexFiles: z.array(z.string()).default(['index.html', 'index.htm']),
});
export type StaticSitePayload = z.infer<typeof staticSitePayloadSchema>;

export const reverseProxyPayloadSchema = z.object({
  type: z.literal('reverse_proxy'),
  upstream: upstreamUrlSchema,
  preserveHostHeader: z.boolean().default(false),
});
export type ReverseProxyPayload = z.infer<typeof reverseProxyPayloadSchema>;

export const phpPayloadSchema = z.object({
  type: z.literal('php'),
  // Phase 3 fills in fpm_socket / php_version etc. — declared here so the
  // schema surface is stable from Phase 1.
  phpVersion: z.enum(['8.3']).default('8.3'),
  documentIndex: z.array(z.string()).default(['index.php', 'index.html']),
});
export type PhpPayload = z.infer<typeof phpPayloadSchema>;

export const sitePayloadSchema = z.discriminatedUnion('type', [
  staticSitePayloadSchema,
  reverseProxyPayloadSchema,
  phpPayloadSchema,
]);
export type SitePayload = z.infer<typeof sitePayloadSchema>;

export const siteCreateSchema = z.object({
  name: siteNameSchema,
  primaryDomain: domainSchema,
  payload: sitePayloadSchema,
});
export type SiteCreate = z.infer<typeof siteCreateSchema>;

export const sitePatchSchema = z.object({
  primaryDomain: domainSchema.optional(),
  payload: sitePayloadSchema.optional(),
});
export type SitePatch = z.infer<typeof sitePatchSchema>;

export const siteCertInfoSchema = z.object({
  fullchainPath: z.string(),
  privkeyPath: z.string(),
});
export type SiteCertInfo = z.infer<typeof siteCertInfoSchema>;

export const siteResponseSchema = z.object({
  id: z.number().int(),
  name: siteNameSchema,
  // External rows (v0.4: managedByDinopanel=false) can carry whatever
  // server_name the operator wrote — including bare hostnames like
  // `_` or `localhost` that wouldn't pass domainSchema. Loosened to
  // `z.string()` so reconcile can surface those rows alongside
  // managed ones in the unified /websites list. Validation on create
  // still goes through `domainSchema` via siteCreateSchema.
  primaryDomain: z.string(),
  type: siteTypeSchema,
  payload: sitePayloadSchema,
  managedByDinopanel: z.boolean(),
  orphaned: z.boolean(),
  externalConfPath: z.string().nullable().optional(),
  certPaths: siteCertInfoSchema.nullable(),
  certExpiresAt: z.number().int().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type SiteResponse = z.infer<typeof siteResponseSchema>;

export const reconcileResponseSchema = z.object({
  scanned: z.number().int(),
  imported: z.number().int(),
  orphaned: z.number().int(),
  // v0.4: external confs (managed_by_dinopanel=false) imported from
  // the host's nginx tree. `imported` counts NEW external rows added
  // this round; `external` is the running total of external rows
  // post-reconcile. `serverNameConflicts` flags `server_name` values
  // that show up in more than one file — operator must pick a winner.
  external: z.number().int().default(0),
  serverNameConflicts: z.array(z.string()).default([]),
});
export type ReconcileResponse = z.infer<typeof reconcileResponseSchema>;
