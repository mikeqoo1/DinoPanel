import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { ChronyTracking, NtpStatus } from '@dinopanel/shared';
import { runCommand, assertSuccess } from '../../../common/shell/run-command';

export interface NtpDriver {
  /** True only for the real timedatectl-backed driver; false on Unavailable. */
  readonly available: boolean;
  getStatus(): Promise<NtpStatus>;
  listTimezones(): Promise<string[]>;
  setNtp(enabled: boolean): Promise<void>;
  setTimezone(tz: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Pure parsers — exported for golden-string unit tests (no DI).
// ---------------------------------------------------------------------------

/**
 * Parse `timedatectl show` (key=value). PREFERRED path: locale-proof and
 * stable across systemd versions (Rocky 9 ships these keys). Sample:
 *   Timezone=Asia/Taipei
 *   LocalRTC=no
 *   NTP=yes
 *   NTPSynchronized=yes
 *   TimeUSec=Tue 2026-06-02 09:13:09 CST
 */
export function parseTimedatectlShow(stdout: string): NtpStatus {
  const kv = new Map<string, string>();
  for (const line of stdout.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) kv.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  return {
    timezone: kv.get('Timezone') ?? '',
    ntpEnabled: kv.get('NTP') === 'yes',
    synchronized: kv.get('NTPSynchronized') === 'yes',
    rtcInLocalTz: kv.get('LocalRTC') === 'yes',
    localTime: kv.get('TimeUSec') ?? null,
    chrony: null,
  };
}

/**
 * Tolerant parser for the human `timedatectl status` block (fallback when
 * `show` is unavailable). Field LABELS stay English regardless of LC_TIME
 * (only the date VALUES localize, e.g. the zh_TW weekday "二"), so we parse
 * by label. Handles cross-version wording drift:
 *   NTP service: active|inactive|n/a   (modern: Rocky 9, Ubuntu 22.04)
 *   Network time on: yes|no            (systemd ~232-239)
 *   NTP enabled: yes|no                (systemd 219, RHEL/CentOS 7)
 * and System clock synchronized | NTP synchronized for the synced flag.
 */
export function parseTimedatectlStatus(stdout: string): NtpStatus {
  const field = (re: RegExp): string | null => {
    const m = re.exec(stdout);
    return m && m[1] ? m[1].trim() : null;
  };
  const isYes = (s: string | null): boolean => /^yes$/i.test(s ?? '');

  const tzRaw = field(/^\s*Time zone:\s*(.+)$/m);
  const timezone = tzRaw ? (tzRaw.split(/\s+/)[0] ?? '') : '';

  // NTP-enabled flag across wording variants.
  let ntpEnabled: boolean;
  const svc = field(/^\s*NTP service:\s*(\S+)/m);
  if (svc !== null) {
    ntpEnabled = /^active$/i.test(svc); // "inactive" / "n/a" => false
  } else {
    ntpEnabled = isYes(
      field(/^\s*Network time on:\s*(\S+)/m) ?? field(/^\s*NTP enabled:\s*(\S+)/m),
    );
  }

  const synchronized = isYes(
    field(/^\s*System clock synchronized:\s*(\S+)/m) ??
      field(/^\s*NTP synchronized:\s*(\S+)/m),
  );

  return {
    timezone,
    ntpEnabled,
    synchronized,
    rtcInLocalTz: isYes(field(/^\s*RTC in local TZ:\s*(\S+)/m)),
    localTime: field(/^\s*Local time:\s*(.+)$/m),
    chrony: null,
  };
}

/** Parse `chronyc tracking` ("Key : value" aligned). */
export function parseChronyTracking(stdout: string): ChronyTracking {
  const get = (re: RegExp): string | null => {
    const m = re.exec(stdout);
    return m && m[1] ? m[1].trim() : null;
  };
  const stratum = get(/^Stratum\s*:\s*(\d+)/m);
  return {
    referenceId: get(/^Reference ID\s*:\s*(.+)$/m),
    stratum: stratum ? Number(stratum) : null,
    leapStatus: get(/^Leap status\s*:\s*(.+)$/m),
  };
}

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

@Injectable()
export class TimedatectlNtpDriver implements NtpDriver {
  readonly available = true;

  // requireSudo is supplied by the module factory (from TOOLBOX_REQUIRE_SUDO).
  constructor(private readonly requireSudo: boolean) {}

  async getStatus(): Promise<NtpStatus> {
    const show = await runCommand('timedatectl', ['show']);
    let status: NtpStatus;
    if (show.exitCode === 0 && /^NTP=/m.test(show.stdout)) {
      status = parseTimedatectlShow(show.stdout);
    } else {
      const s = await runCommand('timedatectl', ['status']);
      assertSuccess(s, 'timedatectl status');
      status = parseTimedatectlStatus(s.stdout);
    }
    // Best-effort chrony enrichment — never fail (or stall) the whole read
    // on it; short timeout so a hung chronyd can't block the status call.
    try {
      const c = await runCommand('chronyc', ['tracking'], { timeoutMs: 3_000 });
      if (c.exitCode === 0) status.chrony = parseChronyTracking(c.stdout);
    } catch {
      /* chronyc absent (systemd-timesyncd backend) — leave chrony: null */
    }
    return status;
  }

  async listTimezones(): Promise<string[]> {
    const result = await runCommand('timedatectl', ['list-timezones']);
    assertSuccess(result, 'timedatectl list-timezones');
    return result.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  }

  async setNtp(enabled: boolean): Promise<void> {
    const result = await runCommand('timedatectl', ['set-ntp', enabled ? 'true' : 'false'], {
      sudo: this.requireSudo,
    });
    assertSuccess(result, `timedatectl set-ntp ${enabled}`);
  }

  async setTimezone(tz: string): Promise<void> {
    // `--` end-of-options guard so a value can never be parsed as a flag,
    // independent of the service-level allowlist (defense-in-depth).
    const result = await runCommand('timedatectl', ['set-timezone', '--', tz], {
      sudo: this.requireSudo,
    });
    assertSuccess(result, `timedatectl set-timezone ${tz}`);
  }
}

/**
 * Fallback when `timedatectl` is not on PATH (non-systemd host / container).
 * Every op 503s with `code: NTP_NOT_CONFIGURED` so the panel still boots;
 * GET /toolbox/status reports availability from `available` without calling
 * any of these. Mirrors UnavailableFirewallDriver (firewall.module.ts).
 */
export class UnavailableNtpDriver implements NtpDriver {
  readonly available = false;
  private throw503(): never {
    throw new ServiceUnavailableException({
      code: 'NTP_NOT_CONFIGURED',
      message: 'timedatectl is not installed on this host',
    });
  }
  getStatus(): Promise<NtpStatus> {
    this.throw503();
  }
  listTimezones(): Promise<string[]> {
    this.throw503();
  }
  setNtp(): Promise<void> {
    this.throw503();
  }
  setTimezone(): Promise<void> {
    this.throw503();
  }
}
