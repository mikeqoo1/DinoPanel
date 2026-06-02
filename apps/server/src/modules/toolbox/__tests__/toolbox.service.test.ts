import { describe, it, expect, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import type { DiskBreakdown, DiskFilesystem, NtpStatus } from '@dinopanel/shared';
import { ToolboxService } from '../toolbox.service';
import type { NtpDriver } from '../drivers/ntp-driver';
import type { DiskDriver } from '../drivers/disk-driver';
import type { CleanerDriver } from '../drivers/cleaner-driver';
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

class FakeDiskDriver implements DiskDriver {
  available = true;
  listFilesystems = vi.fn<() => Promise<DiskFilesystem[]>>().mockResolvedValue([]);
  breakdown = vi
    .fn<(root: string) => Promise<DiskBreakdown>>()
    .mockResolvedValue({ root: '/var', total: 0, entries: [] });
}

function makeCleaner(): CleanerDriver {
  return {
    list: vi.fn().mockReturnValue([]),
    run: vi.fn().mockResolvedValue({ category: 'journald', freedBytes: null, detail: 'ok' }),
  } as unknown as CleanerDriver;
}

function makeService(opts: {
  ntp?: NtpDriver;
  disk?: DiskDriver;
  cleaner?: CleanerDriver;
  requireSudo?: boolean;
} = {}): ToolboxService {
  return new ToolboxService(
    opts.ntp ?? new FakeNtpDriver(),
    opts.disk ?? new FakeDiskDriver(),
    opts.cleaner ?? makeCleaner(),
    makeConfig(opts.requireSudo ?? true) as never,
    noopLogger as never,
  );
}

describe('ToolboxService — error re-wrap', () => {
  it('re-wraps a driver CommandError as a coded 503 HttpException, not a bare 500', async () => {
    const ntp = new FakeNtpDriver();
    ntp.getStatus.mockRejectedValueOnce(new CommandError('TOOL_MISSING', 'timedatectl: not installed'));
    const service = makeService({ ntp });

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
    const ntp = new FakeNtpDriver();
    const service = makeService({ ntp });
    await expect(service.setTimezone('Mars/Phobos')).rejects.toMatchObject({
      response: { code: 'TOOLBOX_INVALID_TIMEZONE' },
    });
    expect(ntp.setTimezone).not.toHaveBeenCalled();
  });

  it('applies a known timezone and returns the fresh status', async () => {
    const ntp = new FakeNtpDriver();
    const service = makeService({ ntp });
    const result = await service.setTimezone('Asia/Taipei');
    expect(ntp.setTimezone).toHaveBeenCalledWith('Asia/Taipei');
    expect(ntp.getStatus).toHaveBeenCalled();
    expect(result).toEqual(SAMPLE_STATUS);
  });
});

describe('ToolboxService — setNtp', () => {
  it('passes the enabled flag to the driver and returns the fresh status', async () => {
    const ntp = new FakeNtpDriver();
    const service = makeService({ ntp });
    const result = await service.setNtp(true);
    expect(ntp.setNtp).toHaveBeenCalledWith(true);
    expect(result).toEqual(SAMPLE_STATUS);
  });
});

describe('ToolboxService — getDisk', () => {
  it('rejects a path outside the SAFE_DU_ROOTS allowlist', async () => {
    const disk = new FakeDiskDriver();
    const service = makeService({ disk });
    await expect(service.getDisk('/etc')).rejects.toMatchObject({
      response: { code: 'TOOLBOX_DISK_PATH_NOT_ALLOWED' },
    });
    expect(disk.breakdown).not.toHaveBeenCalled();
  });

  it('returns filesystems with no breakdown when no path is given', async () => {
    const disk = new FakeDiskDriver();
    const service = makeService({ disk });
    const result = await service.getDisk();
    expect(disk.listFilesystems).toHaveBeenCalled();
    expect(disk.breakdown).not.toHaveBeenCalled();
    expect(result.breakdown).toBeNull();
  });

  it('runs a breakdown for an allowlisted path', async () => {
    const disk = new FakeDiskDriver();
    const service = makeService({ disk });
    const result = await service.getDisk('/var');
    expect(disk.breakdown).toHaveBeenCalledWith('/var');
    expect(result.breakdown).toEqual({ root: '/var', total: 0, entries: [] });
  });
});

describe('ToolboxService — cleaners', () => {
  it('delegates runCleaner to the cleaner driver', async () => {
    const cleaner = makeCleaner();
    const service = makeService({ cleaner });
    const result = await service.runCleaner('journald');
    expect(cleaner.run).toHaveBeenCalledWith('journald');
    expect(result).toMatchObject({ category: 'journald' });
  });

  it('exposes the cleaner availability list', () => {
    const cleaner = makeCleaner();
    const service = makeService({ cleaner });
    service.listCleaners();
    expect(cleaner.list).toHaveBeenCalled();
  });
});

describe('ToolboxService — status()', () => {
  it('reports ntp degraded (SUDO_UNAVAILABLE) and disk available', () => {
    // onApplicationBootstrap not run -> sudoProbeOk false; requireSudo true.
    const service = makeService({ requireSudo: true });
    expect(service.status().features).toEqual([
      { name: 'ntp', available: true, degraded: true, reason: 'SUDO_UNAVAILABLE' },
      { name: 'disk', available: true, degraded: false, reason: null },
    ]);
  });

  it('is not degraded when sudo is not required', () => {
    const service = makeService({ requireSudo: false });
    expect(service.status().features[0]).toEqual({
      name: 'ntp',
      available: true,
      degraded: false,
      reason: null,
    });
  });

  it('reports NTP_NOT_CONFIGURED / DISK_NOT_CONFIGURED when drivers are unavailable', () => {
    const ntp = new FakeNtpDriver();
    ntp.available = false;
    const disk = new FakeDiskDriver();
    disk.available = false;
    const service = makeService({ ntp, disk, requireSudo: false });
    expect(service.status().features).toEqual([
      { name: 'ntp', available: false, degraded: false, reason: 'NTP_NOT_CONFIGURED' },
      { name: 'disk', available: false, degraded: false, reason: 'DISK_NOT_CONFIGURED' },
    ]);
  });
});
