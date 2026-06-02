import { describe, it, expect } from 'vitest';
import { HttpException } from '@nestjs/common';
import {
  parseTimedatectlShow,
  parseTimedatectlStatus,
  parseChronyTracking,
  UnavailableNtpDriver,
} from '../drivers/ntp-driver';

// Real `timedatectl show` from a Rocky/dev host (key=value, locale-proof).
const SHOW_GOLDEN = `Timezone=Asia/Taipei
LocalRTC=no
CanNTP=yes
NTP=yes
NTPSynchronized=yes
TimeUSec=Tue 2026-06-02 09:13:09 CST
RTCTimeUSec=Tue 2026-06-02 09:13:09 CST
`;

// Real `timedatectl status` (note the localized zh_TW weekday "二" in the
// VALUES — labels stay English, which is why we parse by label).
const STATUS_ROCKY9_GOLDEN = `               Local time: 二 2026-06-02 09:13:09 CST
           Universal time: 二 2026-06-02 01:13:09 UTC
                 RTC time: 二 2026-06-02 01:13:09
                Time zone: Asia/Taipei (CST, +0800)
System clock synchronized: yes
              NTP service: active
          RTC in local TZ: no
`;

// systemd 219 (RHEL/CentOS 7) wording — the cross-version fallback branch:
// "NTP enabled:" / "NTP synchronized:" instead of the modern labels.
const STATUS_SYSTEMD219_GOLDEN = `      Local time: Mon 2026-06-02 14:23:11 CST
  Universal time: Mon 2026-06-02 06:23:11 UTC
        RTC time: Mon 2026-06-02 06:23:10
       Time zone: Asia/Taipei (CST, +0800)
     NTP enabled: yes
NTP synchronized: yes
 RTC in local TZ: no
      DST active: n/a
`;

const CHRONY_GOLDEN = `Reference ID    : C0A87B01 (192.168.123.1)
Stratum         : 2
Ref time (UTC)  : Mon Jun 02 06:23:00 2026
System time     : 0.000000075 seconds slow of NTP time
Leap status     : Normal
`;

describe('parseTimedatectlShow (primary, key=value)', () => {
  it('parses the show block', () => {
    expect(parseTimedatectlShow(SHOW_GOLDEN)).toEqual({
      timezone: 'Asia/Taipei',
      ntpEnabled: true,
      synchronized: true,
      rtcInLocalTz: false,
      localTime: 'Tue 2026-06-02 09:13:09 CST',
      chrony: null,
    });
  });

  it('maps NTP=no / NTPSynchronized=no to false', () => {
    const out = parseTimedatectlShow('Timezone=UTC\nLocalRTC=yes\nNTP=no\nNTPSynchronized=no\n');
    expect(out.ntpEnabled).toBe(false);
    expect(out.synchronized).toBe(false);
    expect(out.rtcInLocalTz).toBe(true);
    expect(out.timezone).toBe('UTC');
  });
});

describe('parseTimedatectlStatus (fallback, human block)', () => {
  it('parses the modern Rocky 9 block with a localized weekday value', () => {
    expect(parseTimedatectlStatus(STATUS_ROCKY9_GOLDEN)).toEqual({
      timezone: 'Asia/Taipei',
      ntpEnabled: true,
      synchronized: true,
      rtcInLocalTz: false,
      localTime: '二 2026-06-02 09:13:09 CST',
      chrony: null,
    });
  });

  it('falls back to "NTP enabled:" / "NTP synchronized:" on systemd 219', () => {
    const out = parseTimedatectlStatus(STATUS_SYSTEMD219_GOLDEN);
    expect(out.ntpEnabled).toBe(true);
    expect(out.synchronized).toBe(true);
    expect(out.timezone).toBe('Asia/Taipei');
  });

  it('reports false for "NTP service: inactive" and a missing sync line', () => {
    const out = parseTimedatectlStatus(
      'NTP service: inactive\nSystem clock synchronized: no\nTime zone: UTC (UTC, +0000)\n',
    );
    expect(out.ntpEnabled).toBe(false);
    expect(out.synchronized).toBe(false);
    expect(out.timezone).toBe('UTC');
    expect(out.localTime).toBeNull();
  });

  it('treats "NTP service: n/a" as not enabled', () => {
    const out = parseTimedatectlStatus('NTP service: n/a\nTime zone: UTC (UTC, +0000)\n');
    expect(out.ntpEnabled).toBe(false);
  });
});

describe('parseChronyTracking', () => {
  it('extracts referenceId / stratum / leapStatus', () => {
    expect(parseChronyTracking(CHRONY_GOLDEN)).toEqual({
      referenceId: 'C0A87B01 (192.168.123.1)',
      stratum: 2,
      leapStatus: 'Normal',
    });
  });
});

describe('UnavailableNtpDriver — degrades to 503 when timedatectl is absent', () => {
  const driver = new UnavailableNtpDriver();

  it('reports available=false without touching the host', () => {
    expect(driver.available).toBe(false);
  });

  it.each([
    ['getStatus', () => driver.getStatus()],
    ['listTimezones', () => driver.listTimezones()],
    ['setNtp', () => driver.setNtp()],
    ['setTimezone', () => driver.setTimezone()],
  ])('%s 503s with NTP_NOT_CONFIGURED', (_name, op) => {
    let caught: unknown;
    try {
      void op();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).getStatus()).toBe(503);
    expect((caught as HttpException).getResponse()).toMatchObject({ code: 'NTP_NOT_CONFIGURED' });
  });
});
