/**
 * Fields whose values must be replaced with the redaction marker before
 * leaving the process — written to audit rows, emitted in pino logs, etc.
 *
 * Single source of truth: AuditInterceptor iterates this array over the
 * parsed body object, while app.module.ts maps it through `req.body.${field}`
 * for pino's fast-redact path format. Adding a new field here updates both
 * consumers.
 */
export const SENSITIVE_BODY_FIELDS = [
  'password',
  'oldPassword',
  'newPassword',
  'refreshToken',
] as const;

export type SensitiveBodyField = (typeof SENSITIVE_BODY_FIELDS)[number];

export const REDACTION_PLACEHOLDER = '[redacted]';

export const pinoRedactPaths = SENSITIVE_BODY_FIELDS.map((f) => `req.body.${f}`);
