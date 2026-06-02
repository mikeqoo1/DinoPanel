import { describe, it, expect } from 'vitest';
import { HttpException } from '@nestjs/common';
import {
  parseSystemctlUnits,
  parseSystemctlUnitFiles,
  UnavailableServicesDriver,
} from '../drivers/services-driver';

// `systemctl list-units --type=service --all --no-legend --no-pager --plain`.
// The failed unit carries a leading status bullet even under --plain; a stray
// non-.service line must be ignored; descriptions may contain spaces.
const UNITS_GOLDEN = `sshd.service      loaded active   running OpenSSH server daemon
nginx.service     loaded active   running A high performance web server
crond.service     loaded inactive dead    Command Scheduler
● broken.service  loaded failed   failed  A Broken Unit With Spaces
proc-fs.mount     loaded active   mounted Not a service, must be ignored
`;

// `systemctl list-unit-files --type=service --no-legend --no-pager --plain`
// (newer systemd has a 3rd VENDOR PRESET column we ignore).
const UNIT_FILES_GOLDEN = `sshd.service     enabled  enabled
nginx.service    disabled disabled
crond.service    static   -
`;

describe('parseSystemctlUnits', () => {
  it('parses unit/load/active/sub/description, strips the bullet, ignores non-services', () => {
    expect(parseSystemctlUnits(UNITS_GOLDEN)).toEqual([
      { name: 'sshd.service', loadState: 'loaded', activeState: 'active', subState: 'running', description: 'OpenSSH server daemon' },
      { name: 'nginx.service', loadState: 'loaded', activeState: 'active', subState: 'running', description: 'A high performance web server' },
      { name: 'crond.service', loadState: 'loaded', activeState: 'inactive', subState: 'dead', description: 'Command Scheduler' },
      { name: 'broken.service', loadState: 'loaded', activeState: 'failed', subState: 'failed', description: 'A Broken Unit With Spaces' },
    ]);
  });

  it('returns [] for empty output', () => {
    expect(parseSystemctlUnits('')).toEqual([]);
  });
});

describe('parseSystemctlUnitFiles', () => {
  it('maps unit name to its enabled state (first two columns)', () => {
    const map = parseSystemctlUnitFiles(UNIT_FILES_GOLDEN);
    expect(map.get('sshd.service')).toBe('enabled');
    expect(map.get('nginx.service')).toBe('disabled');
    expect(map.get('crond.service')).toBe('static');
    expect(map.size).toBe(3);
  });
});

describe('UnavailableServicesDriver — degrades to 503 when systemctl is absent', () => {
  const driver = new UnavailableServicesDriver();

  it('reports available=false', () => {
    expect(driver.available).toBe(false);
  });

  it.each([
    ['list', () => driver.list()],
    ['action', () => driver.action()],
    ['resolveCanonicalUnit', () => driver.resolveCanonicalUnit()],
  ])('%s 503s with SERVICES_NOT_CONFIGURED', (_name, op) => {
    let caught: unknown;
    try {
      void op();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).getStatus()).toBe(503);
    expect((caught as HttpException).getResponse()).toMatchObject({ code: 'SERVICES_NOT_CONFIGURED' });
  });
});
