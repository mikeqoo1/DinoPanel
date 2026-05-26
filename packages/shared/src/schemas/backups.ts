import { z } from 'zod';
import { dbEngineSchema, dbInstanceNameSchema } from './databases.js';

// v0.5 backup module schemas. See
// .arceus/changes/v0.5-databases-backups/{proposal,spec,decisions}.md
// for the design context.

export const backupSourceSchema = z.enum(['manual', 'scheduled']);
export type BackupSource = z.infer<typeof backupSourceSchema>;

export const backupStatusSchema = z.enum(['success', 'failed']);
export type BackupStatus = z.infer<typeof backupStatusSchema>;

// Retention groups are arbitrary operator-defined labels (e.g.
// "nightly", "pre-deploy") so the scheduler can keep one bucket per
// schedule. Same constraints as instance names — keeps the on-disk
// shape lower-cased + dash-safe.
export const backupRetentionGroupSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'Lowercase letters, digits, and - only');
export type BackupRetentionGroup = z.infer<typeof backupRetentionGroupSchema>;

// keep_last_N — per-bucket cap. Default 7 from decisions.md D5.
export const backupKeepLastNSchema = z.number().int().min(1).max(365);

export const backupResponseSchema = z.object({
  id: z.number().int(),
  instanceId: z.number().int(),
  instanceName: dbInstanceNameSchema,
  engine: dbEngineSchema,
  filePath: z.string(),
  byteSize: z.number().int().min(0),
  durationMs: z.number().int().min(0),
  source: backupSourceSchema,
  retentionGroup: backupRetentionGroupSchema.nullable(),
  keepLastN: backupKeepLastNSchema.nullable(),
  status: backupStatusSchema,
  error: z.string().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type BackupResponse = z.infer<typeof backupResponseSchema>;

// POST /api/databases/:id/backups — body. Both fields together or
// neither: scheduler passes both, manual UI passes neither. Mixed is
// rejected so a manual button-press never accidentally enrols itself
// into a retention bucket.
export const createBackupBodySchema = z
  .object({
    retentionGroup: backupRetentionGroupSchema.optional(),
    keepLastN: backupKeepLastNSchema.optional(),
  })
  .refine(
    (v) =>
      (v.retentionGroup === undefined && v.keepLastN === undefined) ||
      (v.retentionGroup !== undefined && v.keepLastN !== undefined),
    {
      message: 'retentionGroup and keepLastN must be set together (or both omitted)',
    },
  );
export type CreateBackupBody = z.infer<typeof createBackupBodySchema>;

// POST /api/backups/:id/restore — body. `confirm` must match the
// target instance's name verbatim (typo-guard for the destructive op,
// matches the v0.4 delete-instance flow).
export const restoreBackupBodySchema = z.object({
  confirm: dbInstanceNameSchema,
});
export type RestoreBackupBody = z.infer<typeof restoreBackupBodySchema>;

// GET /api/backups — query. Cursor is the id of the last row in the
// previous page (created_at-desc ordering, so cursor = id < cursor).
export const listBackupsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.coerce.number().int().min(1).optional(),
  instanceId: z.coerce.number().int().min(1).optional(),
});
export type ListBackupsQuery = z.infer<typeof listBackupsQuerySchema>;
