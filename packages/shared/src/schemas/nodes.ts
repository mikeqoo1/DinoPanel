import { z } from 'zod';
import { containerStateSchema } from './containers.js';

// ---------------------------------------------------------------------------
// Remote node registration
// ---------------------------------------------------------------------------

// Hostname or IPv4: starts with alphanumeric so the value can never be
// misread as an SSH option flag (injection guard, layer 1 of 2 — `--`
// end-of-options in buildSshArgs is the second layer).
const HOST_REGEX = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;

// Username: lowercase letter, digit or underscore start (real-world accounts like
// `110084-mike` exist), then lowercase letters, digits, underscores, dots or
// hyphens. Never starts with "-" so it cannot be misread as an SSH option.
const USER_REGEX = /^[a-z0-9_][a-z0-9_.-]*$/;

// Shared field definitions — one source of truth for both stored data and
// API input so that a compromised DB row cannot supply a value that bypasses
// the injection guards.
const hostField = z
  .string()
  .min(1)
  .regex(HOST_REGEX, 'Invalid hostname/IPv4 (must not start with "-")');
const userField = z
  .string()
  .regex(USER_REGEX, 'Invalid username (expected ^[a-z0-9_][a-z0-9_.-]*$)');
const portField = z.number().int().min(1).max(65535);

export const remoteNodeSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(64),
  host: hostField,
  port: portField,
  user: userField,
});
export type RemoteNode = z.infer<typeof remoteNodeSchema>;

export const createNodeSchema = z.object({
  name: z.string().min(1).max(64),
  host: hostField,
  user: userField,
  port: portField.default(22),
});
export type CreateNode = z.infer<typeof createNodeSchema>;

// ---------------------------------------------------------------------------
// Remote node metrics (slim — no net/diskIo, not reusing MetricsSnapshot)
// ---------------------------------------------------------------------------

export const remoteNodeMetricsSchema = z.object({
  ts: z.number(),
  cpu: z.object({
    usage: z.number(),
    loadAvg: z.tuple([z.number(), z.number(), z.number()]),
  }),
  mem: z.object({
    used: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    free: z.number().int().nonnegative(),
  }),
  disks: z.array(
    z.object({
      mount: z.string(),
      fstype: z.string(),
      used: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
    }),
  ),
  uptimeSec: z.number().int().nonnegative(),
});
export type RemoteNodeMetrics = z.infer<typeof remoteNodeMetricsSchema>;

// ---------------------------------------------------------------------------
// Remote containers (slim — no ports/labels, not reusing containerSchema)
// ---------------------------------------------------------------------------

export const remoteContainerSchema = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string(),
  state: containerStateSchema,
  status: z.string(),
});
export type RemoteContainer = z.infer<typeof remoteContainerSchema>;

export const containerEngineSchema = z.enum(['docker', 'podman']);
export type ContainerEngine = z.infer<typeof containerEngineSchema>;

export const remoteContainersResponseSchema = z.object({
  /** An engine binary exists on the node (kept for compat; see `engine`). */
  dockerAvailable: z.boolean(),
  /** Which engine answered; null when none is installed or the marker was missing. */
  engine: containerEngineSchema.nullable(),
  /** Engine exists but the SSH user cannot open its socket (e.g. not in the docker group). */
  permissionDenied: z.boolean(),
  containers: z.array(remoteContainerSchema),
});
export type RemoteContainersResponse = z.infer<typeof remoteContainersResponseSchema>;
