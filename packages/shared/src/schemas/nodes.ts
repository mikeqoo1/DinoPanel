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
  /** A sudo password is stored (encrypted) for this node — the password itself is never returned. */
  hasSudo: z.boolean().optional(),
});
export type RemoteNode = z.infer<typeof remoteNodeSchema>;

export const createNodeSchema = z.object({
  name: z.string().min(1).max(64),
  host: hostField,
  user: userField,
  port: portField.default(22),
  /**
   * Optional sudo password for `user` (v0.6.8). Lets the panel run the read-only container
   * inventory as root so rootless Podman containers of *other* users are listed too.
   * Stored encrypted, sent to the node on stdin only.
   */
  sudoPassword: z.string().min(1).max(256).optional(),
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

export const containerEngineSchema = z.enum(['docker', 'podman']);
export type ContainerEngine = z.infer<typeof containerEngineSchema>;

export const remoteContainerSchema = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string(),
  state: containerStateSchema,
  status: z.string(),
  /** Which engine listed it. */
  engine: containerEngineSchema,
  /** OS user whose `ps` produced it (rootless Podman is per-user; docker is the SSH/sudo user). */
  owner: z.string(),
});
export type RemoteContainer = z.infer<typeof remoteContainerSchema>;

/** Outcome of one `<engine> ps` run as one user. */
export const remoteEngineStatusSchema = z.object({
  engine: containerEngineSchema,
  owner: z.string(),
  ok: z.boolean(),
  /** Engine exists but this user may not open its socket (e.g. not in the docker group). */
  permissionDenied: z.boolean(),
});
export type RemoteEngineStatus = z.infer<typeof remoteEngineStatusSchema>;

export const remoteContainersResponseSchema = z.object({
  /** At least one engine binary exists on the node (kept for compat). */
  dockerAvailable: z.boolean(),
  /** The stored sudo password was rejected — nothing could be listed. */
  sudoFailed: z.boolean(),
  engines: z.array(remoteEngineStatusSchema),
  containers: z.array(remoteContainerSchema),
});
export type RemoteContainersResponse = z.infer<typeof remoteContainersResponseSchema>;
