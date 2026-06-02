import { describe, it, expect, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import type { NtpStatus } from '@dinopanel/shared';
import { ToolboxService } from '../toolbox.service';
import type { NtpDriver } from '../drivers/ntp-driver';
import { CommandError } from '../../../common/shell/run-command';

const noopLogger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() };

function makeConfig(requireSudo = true) {
  return { get: vi.fn().mockReturnValue({ env: { TOOLBOX_REQUIRE_SUDO: requireSudo } }) };
}

const SAMPLE_STATUS: NtpStatus = {
  timezone: 'Asia/Taipei',
  ntpEnabled: true,
  synchronized: true,
  rtcInLocalTz: false,
  localTime: null,
  chrony: null,
};

class FakeNtpDriver implements NtpDriver {
  available = true;
  getStatus = vi.fn<() => Promise<NtpStatus>>().mockResolvedValue(SAMPLE_STATUS);
  listTimezones = vi.fn<() => Promise<string[]>>().mockResolvedValue(['Asia/Taipei', 'UTC']);
  setNtp = vi.fn<(enabled: boolean) => Promise<void>>().mockResolvedValue(undefined);
  setTimezone = vi.fn<(tz: string) => Promise<void>>().mockResolvedValue(undefined);
}

function makeService(driver: NtpDriver, requireSudo = true): ToolboxService {
  return new ToolboxService(driver, makeConfig(requireSudo) as never, noopLogger as never);
}

describe('ToolboxService — error re-wrap', () => {
  it('re-wraps a driver CommandError as a coded 503 HttpException, not a bare 500', async () => {
    const driver = new FakeNtpDriver();
    driver.getStatus.mockRejectedValueOnce(
      new CommandError('TOOL_MISSING', 'timedatectl: not installed'),
    );
    const service = makeService(driver);

    let caught: unknown;
    try {
      await service.getNtpStatus();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).getStatus()).toBe(503);
    expect((caught as HttpException).getResponse()).toMatchObject({ code: 'TOOLBOX_TOOL_MISSING' });
  });
});

describe('ToolboxService — setTimezone', () => {
  it('rejects an unknown timezone before shelling out', async () => {
    const driver = new FakeNtpDriver();
    const service = makeService(driver);
    await expect(service.setTimezone('Mars/Phobos')).rejects.toMatchObject({
      response: { code: 'TOOLBOX_INVALID_TIMEZONE' },
    });
    expect(driver.setTimezone).not.toHaveBeenCalled();
  });

  it('applies a known timezone and returns the fresh status', async () => {
    const driver = new FakeNtpDriver();
    const service = makeService(driver);
    const result = await service.setTimezone('Asia/Taipei');
    expect(driver.setTimezone).toHaveBeenCalledWith('Asia/Taipei');
    expect(driver.getStatus).toHaveBeenCalled();
    expect(result).toEqual(SAMPLE_STATUS);
  });
});

describe('ToolboxService — setNtp', () => {
  it('passes the enabled flag to the driver and returns the fresh status', async () => {
    const driver = new FakeNtpDriver();
    const service = makeService(driver);
    const result = await service.setNtp(true);
    expect(driver.setNtp).toHaveBeenCalledWith(true);
    expect(result).toEqual(SAMPLE_STATUS);
  });
});

describe('ToolboxService — status()', () => {
  it('reports degraded with SUDO_UNAVAILABLE when sudo is required but the boot probe has not passed', () => {
    // onApplicationBootstrap not run -> sudoProbeOk stays false; requireSudo=true.
    const service = makeService(new FakeNtpDriver(), true);
    expect(service.status().features).toEqual([
      { name: 'ntp', available: true, degraded: true, reason: 'SUDO_UNAVAILABLE' },
    ]);
  });

  it('is not degraded when sudo is not required', () => {
    const service = makeService(new FakeNtpDriver(), false);
    expect(service.status().features).toEqual([
      { name: 'ntp', available: true, degraded: false, reason: null },
    ]);
  });

  it('reports NTP_NOT_CONFIGURED when the driver is unavailable', () => {
    const driver = new FakeNtpDriver();
    driver.available = false;
    const service = makeService(driver, false);
    expect(service.status().features).toEqual([
      { name: 'ntp', available: false, degraded: false, reason: 'NTP_NOT_CONFIGURED' },
    ]);
  });
});
