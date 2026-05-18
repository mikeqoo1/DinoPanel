import { z } from 'zod';

export const scheduledTaskTypeSchema = z.enum([
  'shell',
  'backup_files',
  'clean_logs',
  'restart_service',
  'http_request',
  'purge',
]);
export type ScheduledTaskType = z.infer<typeof scheduledTaskTypeSchema>;

export const userFacingTaskTypeSchema = z.enum([
  'shell',
  'backup_files',
  'clean_logs',
  'restart_service',
  'http_request',
]);
export type UserFacingTaskType = z.infer<typeof userFacingTaskTypeSchema>;

export const shellPayloadSchema = z.object({
  command: z.string().min(1),
});

export const backupFilesPayloadSchema = z.object({
  sources: z.array(z.string().min(1)).min(1),
  targetDir: z.string().min(1),
});

export const cleanLogsPayloadSchema = z.object({
  path: z.string().min(1),
  olderThanDays: z.number().int().positive(),
});

export const restartServicePayloadSchema = z.object({
  unit: z.string().regex(/^[A-Za-z0-9_@-][A-Za-z0-9_@.-]*$/),
});

export const httpRequestPayloadSchema = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).default('GET'),
  headers: z.record(z.string()).optional(),
  body: z.unknown().optional(),
});

export const purgePayloadSchema = z.object({
  table: z.literal('operation_log'),
});

export const scheduledTaskSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  type: scheduledTaskTypeSchema,
  cron: z.string(),
  payload: z.unknown(),
  enabled: z.boolean(),
  builtin: z.boolean(),
  createdAt: z.number().int(),
  nextRunAt: z.number().int().nullable(),
});
export type ScheduledTask = z.infer<typeof scheduledTaskSchema>;

export const createScheduledTaskBodySchema = z.object({
  name: z.string().min(1).max(120),
  type: userFacingTaskTypeSchema,
  cron: z.string().min(1),
  payload: z.unknown(),
  enabled: z.boolean().default(true),
});
export type CreateScheduledTaskBody = z.infer<typeof createScheduledTaskBodySchema>;

export const updateScheduledTaskBodySchema = createScheduledTaskBodySchema.partial();
export type UpdateScheduledTaskBody = z.infer<typeof updateScheduledTaskBodySchema>;

export const scheduledRunStatusSchema = z.enum(['running', 'success', 'failed', 'aborted']);
export type ScheduledRunStatus = z.infer<typeof scheduledRunStatusSchema>;

export const scheduledRunSchema = z.object({
  id: z.number().int(),
  taskId: z.number().int(),
  startedAt: z.number().int(),
  finishedAt: z.number().int().nullable(),
  status: scheduledRunStatusSchema,
  exitCode: z.number().int().nullable(),
  output: z.string().nullable(),
});
export type ScheduledRun = z.infer<typeof scheduledRunSchema>;
