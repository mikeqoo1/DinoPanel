import { z } from 'zod';

// ---------------------------------------------------------------------------
// Container
// ---------------------------------------------------------------------------

export const containerStateSchema = z.enum([
  'created',
  'running',
  'paused',
  'restarting',
  'removing',
  'exited',
  'dead',
]);
export type ContainerState = z.infer<typeof containerStateSchema>;

export const containerPortSchema = z.object({
  ip: z.string().optional(),
  privatePort: z.number().int(),
  publicPort: z.number().int().optional(),
  type: z.enum(['tcp', 'udp', 'sctp']),
});
export type ContainerPort = z.infer<typeof containerPortSchema>;

export const containerSchema = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string(),
  imageId: z.string(),
  state: containerStateSchema,
  status: z.string(),
  ports: z.array(containerPortSchema),
  labels: z.record(z.string()),
  createdAt: z.number().int(),
});
export type Container = z.infer<typeof containerSchema>;

// ---------------------------------------------------------------------------
// Image
// ---------------------------------------------------------------------------

export const imageSchema = z.object({
  id: z.string(),
  repoTags: z.array(z.string()),
  size: z.number().int().nonnegative(),
  createdAt: z.number().int(),
  labels: z.record(z.string()).optional(),
});
export type Image = z.infer<typeof imageSchema>;

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

export const networkSchema = z.object({
  id: z.string(),
  name: z.string(),
  driver: z.string(),
  scope: z.string(),
});
export type Network = z.infer<typeof networkSchema>;

// ---------------------------------------------------------------------------
// Volume
// ---------------------------------------------------------------------------

export const volumeSchema = z.object({
  name: z.string(),
  driver: z.string(),
  mountpoint: z.string(),
});
export type Volume = z.infer<typeof volumeSchema>;

// ---------------------------------------------------------------------------
// ComposeStack
// ---------------------------------------------------------------------------

export const composeStackSchema = z.object({
  id: z.number().nullable(),
  name: z.string(),
  path: z.string(),
  source: z.enum(['registered', 'discovered']),
  services: z.array(z.string()),
  containerCount: z.number().int().nonnegative(),
  runningCount: z.number().int().nonnegative(),
});
export type ComposeStack = z.infer<typeof composeStackSchema>;

export const composeFileSchema = z.object({
  path: z.string(),
  content: z.string(),
  modifiedAt: z.number(),
});
export type ComposeFile = z.infer<typeof composeFileSchema>;

export const composeValidationSchema = z.object({
  valid: z.boolean(),
  errors: z
    .array(z.object({ line: z.number().optional(), message: z.string() }))
    .optional(),
  resolvedYaml: z.string().optional(),
});
export type ComposeValidation = z.infer<typeof composeValidationSchema>;
