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
