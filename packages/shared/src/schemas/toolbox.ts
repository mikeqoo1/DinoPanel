import { z } from 'zod';

// v0.6 toolbox module schemas. Phase 1: NTP / time-sync (parsed from the
// host `timedatectl`). Future toolbox features (fail2ban view, disk, swap)
// append to toolboxStatusSchema.features without changing the API shape.

// IANA timezone names: "/"-separated segments of letters, digits, +, -, _
// (e.g. "UTC", "Asia/Taipei", "America/Argentina/Buenos_Aires", "Etc/GMT+8").
// Anchored + bounded char class, linear-time (no catastrophic backtracking).
// This is only a cheap shape/injection guard — the value is re-validated
// against `timedatectl list-timezones` in the service before being applied.
// First segment cannot start with '-' (no real zone does), so a value can
// never be misread as a `timedatectl` option flag even if the service-level
// allowlist were ever removed.
const TIMEZONE_REGEX = /^[A-Za-z0-9+_][A-Za-z0-9+_-]*(?:\/[A-Za-z0-9+_-]+)*$/;

// `chronyc tracking` enrichment, present only when chronyd is the backend.
export const chronyTrackingSchema = z.object({
  referenceId: z.string().nullable(),
  stratum: z.number().int().nullable(),
  leapStatus: z.string().nullable(),
});
export type ChronyTracking = z.infer<typeof chronyTrackingSchema>;

// GET /toolbox/ntp — current time-sync state.
export const ntpStatusSchema = z.object({
  // `Timezone=` / "Time zone:" left token, e.g. "Asia/Taipei".
  timezone: z.string(),
  // `NTP=yes` — the NTP sync service is enabled.
  ntpEnabled: z.boolean(),
  // `NTPSynchronized=yes` / "System clock synchronized: yes".
  synchronized: z.boolean(),
  // `LocalRTC=yes` — RTC runs in local time rather than UTC.
  rtcInLocalTz: z.boolean(),
  // Raw local-time display string as emitted by the host (its exact format
  // differs between the `show` and `status` parse paths); null when absent.
  localTime: z.string().nullable(),
  // chronyd detail when present; null on systemd-timesyncd / no chrony.
  chrony: chronyTrackingSchema.nullable(),
});
export type NtpStatus = z.infer<typeof ntpStatusSchema>;

// POST /toolbox/ntp/set — enable or disable the NTP sync service.
export const setNtpBodySchema = z.object({
  enabled: z.boolean(),
});
export type SetNtpBody = z.infer<typeof setNtpBodySchema>;

// POST /toolbox/ntp/timezone — change the system timezone.
export const setTimezoneBodySchema = z.object({
  timezone: z
    .string()
    .min(1)
    .max(64)
    .regex(TIMEZONE_REGEX, 'Invalid timezone (expected e.g. Asia/Taipei or UTC)'),
});
export type SetTimezoneBody = z.infer<typeof setTimezoneBodySchema>;

// One toolbox sub-feature's availability (GET /toolbox/status). `available`
// = the backing tool exists; `degraded` = present but limited (e.g. sudo
// required but the boot probe failed); `reason` carries a code hint when
// unavailable/degraded, null otherwise.
export const toolboxFeatureSchema = z.object({
  name: z.string(),
  available: z.boolean(),
  degraded: z.boolean(),
  reason: z.string().nullable(),
});
export type ToolboxFeature = z.infer<typeof toolboxFeatureSchema>;

// GET /toolbox/status — feature availability list.
export const toolboxStatusSchema = z.object({
  features: z.array(toolboxFeatureSchema),
});
export type ToolboxStatus = z.infer<typeof toolboxStatusSchema>;

// --- v0.6 Phase 2: disk usage (read-only) ----------------------------------

// One mounted filesystem parsed from `df -PB1` (POSIX columns, raw bytes).
export const diskFilesystemSchema = z.object({
  source: z.string(), // backing device, e.g. "/dev/sda9", "tmpfs"
  mount: z.string(), // mount point, e.g. "/"
  total: z.number().int().nonnegative(),
  used: z.number().int().nonnegative(),
  available: z.number().int().nonnegative(),
  // 0..100; null for pseudo filesystems whose Capacity is "-".
  usePercent: z.number().int().min(0).max(100).nullable(),
});
export type DiskFilesystem = z.infer<typeof diskFilesystemSchema>;

// One depth-1 child from `du -x -d1 <root>`.
export const diskBreakdownEntrySchema = z.object({
  path: z.string(),
  bytes: z.number().int().nonnegative(),
});
export type DiskBreakdownEntry = z.infer<typeof diskBreakdownEntrySchema>;

export const diskBreakdownSchema = z.object({
  root: z.string(), // always one of the service's SAFE_DU_ROOTS
  total: z.number().int().nonnegative(),
  entries: z.array(diskBreakdownEntrySchema), // largest first
});
export type DiskBreakdown = z.infer<typeof diskBreakdownSchema>;

// GET /toolbox/disk — mounted filesystems + optional per-directory breakdown.
export const diskUsageSchema = z.object({
  filesystems: z.array(diskFilesystemSchema),
  breakdown: diskBreakdownSchema.nullable(), // present only when ?path= was a SAFE root
  // The roots the breakdown picker may request (the server's allowlist), so
  // the UI is self-describing and doesn't hardcode the list.
  safeRoots: z.array(z.string()),
});
export type DiskUsage = z.infer<typeof diskUsageSchema>;

// --- v0.6 Phase 2: curated cleaners ----------------------------------------

// Closed set of tool-owned cleaners. Every category is path-less — the tool
// owns the targets — so the body is a pure enum with NO path field. (A /tmp
// sweep was deliberately deferred: a blanket wipe risks active sockets/locks,
// and an age-based deleter was already excluded as too dangerous.)
export const cleanCategorySchema = z.enum([
  'journald', // journalctl --vacuum-size=<cap>
  'package_cache', // dnf clean all | apt-get clean (host-detected)
  'docker_prune', // dockerode pruneContainers + pruneImages (dangling-only)
]);
export type CleanCategory = z.infer<typeof cleanCategorySchema>;

// POST /toolbox/clean — run one cleaner.
export const cleanBodySchema = z.object({
  category: cleanCategorySchema,
});
export type CleanBody = z.infer<typeof cleanBodySchema>;

export const cleanResultSchema = z.object({
  category: cleanCategorySchema,
  // Bytes reclaimed when the tool reports it (docker SpaceReclaimed); null when
  // it does not (journald vacuum, dnf/apt clean).
  freedBytes: z.number().int().nonnegative().nullable(),
  detail: z.string(),
});
export type CleanResult = z.infer<typeof cleanResultSchema>;

// GET /toolbox/cleaners — per-category availability.
export const toolboxCleanerSchema = z.object({
  category: cleanCategorySchema,
  available: z.boolean(),
  reason: z.string().nullable(),
});
export type ToolboxCleaner = z.infer<typeof toolboxCleanerSchema>;

export const cleanersListSchema = z.object({
  cleaners: z.array(toolboxCleanerSchema),
});
export type CleanersList = z.infer<typeof cleanersListSchema>;
