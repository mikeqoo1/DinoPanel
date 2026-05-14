import { z } from 'zod';

const safePath = z
  .string()
  .min(1)
  .refine((p) => !p.includes('\0'), 'Path must not contain null bytes')
  .refine((p) => p.startsWith('/'), 'Path must be absolute');

export const fileEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  type: z.enum(['file', 'directory', 'symlink', 'other']),
  size: z.number().int().nonnegative(),
  mode: z.number().int(),
  mtime: z.number().int(),
  uid: z.number().int(),
  gid: z.number().int(),
  owner: z.string().optional(),
  group: z.string().optional(),
  isHidden: z.boolean(),
  linkTarget: z.string().optional(),
});
export type FileEntry = z.infer<typeof fileEntrySchema>;

export const listQuerySchema = z.object({
  path: safePath,
  showHidden: z.boolean().optional().default(false),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export const listResponseSchema = z.object({
  path: z.string(),
  entries: z.array(fileEntrySchema),
});
export type ListResponse = z.infer<typeof listResponseSchema>;

export const writeSchema = z.object({
  path: safePath,
  content: z.string(),
});
export type WriteInput = z.infer<typeof writeSchema>;

export const mkdirSchema = z.object({
  path: safePath,
  recursive: z.boolean().optional().default(true),
});
export type MkdirInput = z.infer<typeof mkdirSchema>;

export const renameSchema = z.object({
  from: safePath,
  to: safePath,
});
export type RenameInput = z.infer<typeof renameSchema>;

export const pathOnlySchema = z.object({ path: safePath });
export type PathOnlyInput = z.infer<typeof pathOnlySchema>;

export const chmodSchema = z.object({
  path: safePath,
  mode: z.number().int().min(0).max(0o7777),
});
export type ChmodInput = z.infer<typeof chmodSchema>;

export const chownSchema = z.object({
  path: safePath,
  uid: z.number().int().nonnegative(),
  gid: z.number().int().nonnegative(),
});
export type ChownInput = z.infer<typeof chownSchema>;

export const compressSchema = z.object({
  paths: z.array(safePath).min(1),
  dest: safePath,
  format: z.enum(['zip', 'tar.gz']),
});
export type CompressInput = z.infer<typeof compressSchema>;

export const extractSchema = z.object({
  archive: safePath,
  dest: safePath,
});
export type ExtractInput = z.infer<typeof extractSchema>;
