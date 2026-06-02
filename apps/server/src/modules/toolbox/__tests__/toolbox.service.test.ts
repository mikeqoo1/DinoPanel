import { describe, it, expect, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import type { DiskBreakdown, DiskFilesystem, NtpStatus, ServiceUnit, SystemdAction } from '@dinopanel/shared';
import { ToolboxService } from '../toolbox.service';
import type { NtpDriver } from '../drivers/ntp-driver';
import { UnavailableNtpDriver } from '../drivers/ntp-driver';
import type { DiskDriver } from '../drivers/disk-driver';
import { UnavailableDiskDriver } from '../drivers/disk-driver';
import type { CleanerDriver } from '../drivers/cleaner-driver';
import type { ServicesDriver } from '../drivers/services-driver';
import { UnavailableServicesDriver } from '../drivers/services-driver';
import { CommandError } from '../../../common/shell/run-command';

const noopLogger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() };

function makeConfig(requireSudo = true, isDev = false) {
  return {
    get: vi.fn().mockReturnValue({ env: { TOOLBOX_REQUIRE_SUDO: requireSudo }, isDev }),
  };
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

class FakeServicesDriver implements ServicesDriver {
  available = true;
  list = vi.fn<() => Promise<ServiceUnit[]>>().mockResolvedValue([]);
  action = vi.fn<(unit: string, action: SystemdAction) => Promise<void>>().mockResolvedValue(undefined);
  // default: identity (no alias) — the alias test overrides this
  resolveCanonicalUnit = vi
    .fn<(unit: string) => Promise<string>>()
    .mockImplementation((unit) => Promise.resolve(unit));
}

function makeService(opts: {
  ntp?: NtpDriver;
  disk?: DiskDriver;
  cleaner?: CleanerDriver;
  services?: ServicesDriver;
  requireSudo?: boolean;
  isDev?: boolean;
} = {}): ToolboxService {
  return new ToolboxService(
    opts.ntp ?? new FakeNtpDriver(),
    opts.disk ?? new FakeDiskDriver(),
    opts.cleaner ?? makeCleaner(),
    opts.services ?? new FakeServicesDriver(),
    makeConfig(opts.requireSudo ?? true, opts.isDev ?? false) as never,
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

describe('ToolboxService — stderr redaction (carry from Phase 1)', () => {
  it('does NOT forward host stderr to the client in production (isDev=false)', async () => {
    const ntp = new FakeNtpDriver();
    ntp.getStatus.mockRejectedValueOnce(
      new CommandError('COMMAND_FAILED', 'timedatectl failed', 'sensitive host stderr'),
    );
    const service = makeService({ ntp, isDev: false });

    const caught = (await service.getNtpStatus().catch((e: unknown) => e)) as HttpException;
    expect(caught).toBeInstanceOf(HttpException);
    expect(caught.getResponse()).toMatchObject({ code: 'TOOLBOX_COMMAND_FAILED' });
    expect(caught.getResponse()).not.toHaveProperty('details');
    // The full stderr is preserved in the server log, never silently dropped.
    expect(noopLogger.warn).toHaveBeenCalledWith(
      { kind: 'COMMAND_FAILED', stderr: 'sensitive host stderr' },
      'toolbox.command_failed',
    );
  });

  it('surfaces stderr in details in development (isDev=true)', async () => {
    const ntp = new FakeNtpDriver();
    ntp.getStatus.mockRejectedValueOnce(
      new CommandError('COMMAND_FAILED', 'timedatectl failed', 'sensitive host stderr'),
    );
    const service = makeService({ ntp, isDev: true });

    const caught = (await service.getNtpStatus().catch((e: unknown) => e)) as HttpException;
    expect(caught.getResponse()).toMatchObject({ details: { stderr: 'sensitive host stderr' } });
  });
});

describe('ToolboxService — unavailable drivers degrade to 503', () => {
  it('getNtpStatus 503s NTP_NOT_CONFIGURED when timedatectl is absent', async () => {
    const service = makeService({ ntp: new UnavailableNtpDriver() });
    const caught = (await service.getNtpStatus().catch((e: unknown) => e)) as HttpException;
    expect(caught).toBeInstanceOf(HttpException);
    expect(caught.getStatus()).toBe(503);
    expect(caught.getResponse()).toMatchObject({ code: 'NTP_NOT_CONFIGURED' });
  });

  it('setTimezone 503s NTP_NOT_CONFIGURED (the allowlist read hits the Unavailable driver)', async () => {
    const service = makeService({ ntp: new UnavailableNtpDriver() });
    const caught = (await service.setTimezone('Asia/Taipei').catch((e: unknown) => e)) as HttpException;
    expect(caught.getStatus()).toBe(503);
    expect(caught.getResponse()).toMatchObject({ code: 'NTP_NOT_CONFIGURED' });
  });

  it('getDisk 503s DISK_NOT_CONFIGURED when df is absent', async () => {
    const service = makeService({ disk: new UnavailableDiskDriver() });
    const caught = (await service.getDisk().catch((e: unknown) => e)) as HttpException;
    expect(caught).toBeInstanceOf(HttpException);
    expect(caught.getStatus()).toBe(503);
    expect(caught.getResponse()).toMatchObject({ code: 'DISK_NOT_CONFIGURED' });
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

  it('listTimezones delegates to the driver', async () => {
    const ntp = new FakeNtpDriver();
    const service = makeService({ ntp });
    await expect(service.listTimezones()).resolves.toEqual(['Asia/Taipei', 'UTC']);
    expect(ntp.listTimezones).toHaveBeenCalled();
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

  it('rejects a sub-path of an allowlisted root (exact-match, not prefix-match)', async () => {
    const disk = new FakeDiskDriver();
    const service = makeService({ disk });
    // '/var' is allowlisted, but the gate is exact-match — '/var/foo' must not slip through.
    await expect(service.getDisk('/var/foo')).rejects.toMatchObject({
      response: { code: 'TOOLBOX_DISK_PATH_NOT_ALLOWED' },
    });
    expect(disk.breakdown).not.toHaveBeenCalled();
  });

  it('returns filesystems + safeRoots with no breakdown when no path is given', async () => {
    const disk = new FakeDiskDriver();
    const service = makeService({ disk });
    const result = await service.getDisk();
    expect(disk.listFilesystems).toHaveBeenCalled();
    expect(disk.breakdown).not.toHaveBeenCalled();
    expect(result.breakdown).toBeNull();
    expect(result.safeRoots).toContain('/var');
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
  it('reports ntp + services degraded (SUDO_UNAVAILABLE) and disk available', () => {
    // onApplicationBootstrap not run -> sudoProbeOk false; requireSudo true.
    const service = makeService({ requireSudo: true });
    expect(service.status().features).toEqual([
      { name: 'ntp', available: true, degraded: true, reason: 'SUDO_UNAVAILABLE' },
      { name: 'disk', available: true, degraded: false, reason: null },
      { name: 'services', available: true, degraded: true, reason: 'SUDO_UNAVAILABLE' },
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

  it('reports *_NOT_CONFIGURED when drivers are unavailable', () => {
    const ntp = new FakeNtpDriver();
    ntp.available = false;
    const disk = new FakeDiskDriver();
    disk.available = false;
    const services = new FakeServicesDriver();
    services.available = false;
    const service = makeService({ ntp, disk, services, requireSudo: false });
    expect(service.status().features).toEqual([
      { name: 'ntp', available: false, degraded: false, reason: 'NTP_NOT_CONFIGURED' },
      { name: 'disk', available: false, degraded: false, reason: 'DISK_NOT_CONFIGURED' },
      { name: 'services', available: false, degraded: false, reason: 'SERVICES_NOT_CONFIGURED' },
    ]);
  });
});

describe('ToolboxService — services (Supervisor) protected-units guard', () => {
  it('refuses ALL mutation of the panel\'s own unit (dinopanel.service)', async () => {
    const services = new FakeServicesDriver();
    const service = makeService({ services });
    for (const action of ['start', 'stop', 'restart', 'enable', 'disable'] as const) {
      const caught = (await service.serviceAction('dinopanel.service', action).catch((e) => e)) as HttpException;
      expect(caught.getResponse()).toMatchObject({ code: 'SERVICE_PROTECTED' });
    }
    expect(services.action).not.toHaveBeenCalled();
  });

  it('refuses stop/disable on a critical unit but allows restart (bare name normalized)', async () => {
    const services = new FakeServicesDriver();
    const service = makeService({ services });

    for (const action of ['stop', 'disable'] as const) {
      const caught = (await service.serviceAction('sshd', action).catch((e) => e)) as HttpException;
      expect(caught.getResponse()).toMatchObject({ code: 'SERVICE_PROTECTED' });
    }
    await expect(service.serviceAction('sshd', 'restart')).resolves.toEqual({ ok: true });
    expect(services.action).toHaveBeenCalledWith('sshd', 'restart');
  });

  it('allows every action on an ordinary unit', async () => {
    const services = new FakeServicesDriver();
    const service = makeService({ services });
    await expect(service.serviceAction('crond.service', 'restart')).resolves.toEqual({ ok: true });
    expect(services.action).toHaveBeenCalledWith('crond.service', 'restart');
  });

  it('rejects an injection-shaped unit name before shelling out', async () => {
    const services = new FakeServicesDriver();
    const service = makeService({ services });
    const caught = (await service.serviceAction('-x;reboot', 'restart').catch((e) => e)) as HttpException;
    expect(caught.getResponse()).toMatchObject({ code: 'SERVICE_INVALID_UNIT' });
    expect(services.action).not.toHaveBeenCalled();
  });

  it('refuses a non-.service unit type — closes the ssh.socket / multi-user.target bypass', async () => {
    const services = new FakeServicesDriver();
    const service = makeService({ services });
    for (const unit of ['ssh.socket', 'dbus.socket', 'multi-user.target']) {
      const caught = (await service.serviceAction(unit, 'stop').catch((e) => e)) as HttpException;
      expect(caught.getResponse()).toMatchObject({ code: 'SERVICE_PROTECTED' });
    }
    expect(services.action).not.toHaveBeenCalled();
  });

  it('refuses an ALIAS of a protected unit by resolving its canonical Id', async () => {
    const services = new FakeServicesDriver();
    // systemd resolves this alias to systemd-logind.service (a CRITICAL unit).
    services.resolveCanonicalUnit.mockResolvedValue('systemd-logind.service');
    const service = makeService({ services });
    const caught = (await service
      .serviceAction('dbus-org.freedesktop.login1.service', 'stop')
      .catch((e) => e)) as HttpException;
    expect(caught.getResponse()).toMatchObject({ code: 'SERVICE_PROTECTED' });
    expect(services.action).not.toHaveBeenCalled();
  });

  it('listServices 503s SERVICES_NOT_CONFIGURED on the Unavailable driver', async () => {
    const service = makeService({ services: new UnavailableServicesDriver() });
    const caught = (await service.listServices().catch((e) => e)) as HttpException;
    expect(caught.getStatus()).toBe(503);
    expect(caught.getResponse()).toMatchObject({ code: 'SERVICES_NOT_CONFIGURED' });
  });
});
