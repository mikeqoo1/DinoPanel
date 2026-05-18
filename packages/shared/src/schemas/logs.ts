import { z } from 'zod';

export const logSourceSchema = z.enum(['system', 'ssh', 'operation', 'login', 'task']);
export type LogSource = z.infer<typeof logSourceSchema>;

// ---------------------------------------------------------------------------
// System log
// ---------------------------------------------------------------------------

export const systemLogLineSchema = z.object({
  ts: z.number().int(),
  line: z.string(),
});
export type SystemLogLine = z.infer<typeof systemLogLineSchema>;

// ---------------------------------------------------------------------------
// SSH log
// ---------------------------------------------------------------------------

export const sshLogEntrySchema = z.object({
  ts: z.number().int(),
  status: z.enum(['accepted', 'failed']),
  user: z.string().nullable(),
  ip: z.string().nullable(),
});
export type SshLogEntry = z.infer<typeof sshLogEntrySchema>;

// ---------------------------------------------------------------------------
// Operation log (audit)
// ---------------------------------------------------------------------------

export const operationLogEntrySchema = z.object({
  id: z.number().int(),
  userId: z.number().int().nullable(),
  method: z.string(),
  path: z.string(),
  bodySummary: z.string().nullable(),
  statusCode: z.number().int(),
  durationMs: z.number().int(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.number().int(),
});
export type OperationLogEntry = z.infer<typeof operationLogEntrySchema>;

// ---------------------------------------------------------------------------
// Login log
// ---------------------------------------------------------------------------

export const loginLogEntrySchema = z.object({
  id: z.number().int(),
  username: z.string(),
  result: z.enum(['success', 'fail']),
  reason: z.string().nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.number().int(),
});
export type LoginLogEntry = z.infer<typeof loginLogEntrySchema>;

// ---------------------------------------------------------------------------
// Cursor pagination
// ---------------------------------------------------------------------------

export const logCursorQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type LogCursorQuery = z.infer<typeof logCursorQuerySchema>;

export const logPageSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
