import { describe, it, expect } from 'vitest';
import {
  serviceActionAllowed,
  normalizeServiceUnit,
  serviceActionBodySchema,
  SUPERVISOR_CRITICAL_UNITS,
  SUPERVISOR_SELF_UNIT,
} from '../services';

const ALL_ACTIONS = ['start', 'stop', 'restart', 'enable', 'disable'] as const;

describe('serviceActionAllowed — tiered protected-units guard', () => {
  it('refuses ALL actions on the panel self unit (incl. bare name)', () => {
    for (const a of ALL_ACTIONS) {
      expect(serviceActionAllowed(SUPERVISOR_SELF_UNIT, a).allowed).toBe(false);
      expect(serviceActionAllowed('dinopanel', a).allowed).toBe(false);
    }
  });

  it('refuses stop/disable on critical units but allows start/restart/enable', () => {
    for (const unit of ['sshd', 'firewalld.service', 'NetworkManager', 'systemd-journald']) {
      expect(serviceActionAllowed(unit, 'stop').allowed).toBe(false);
      expect(serviceActionAllowed(unit, 'disable').allowed).toBe(false);
      expect(serviceActionAllowed(unit, 'restart').allowed).toBe(true);
      expect(serviceActionAllowed(unit, 'start').allowed).toBe(true);
      expect(serviceActionAllowed(unit, 'enable').allowed).toBe(true);
    }
  });

  it('allows every action on an ordinary unit', () => {
    for (const a of ALL_ACTIONS) {
      expect(serviceActionAllowed('crond.service', a).allowed).toBe(true);
      expect(serviceActionAllowed('my-app', a).allowed).toBe(true);
    }
  });

  it('refuses any non-.service unit type (socket/target/mount bypass)', () => {
    for (const unit of ['ssh.socket', 'dbus.socket', 'multi-user.target', 'home.mount', 'foo.timer']) {
      expect(serviceActionAllowed(unit, 'stop').allowed).toBe(false);
      expect(serviceActionAllowed(unit, 'start').allowed).toBe(false);
    }
  });

  it('carries a reason string when refused', () => {
    expect(serviceActionAllowed('sshd', 'stop').reason).toMatch(/protected/i);
    expect(serviceActionAllowed('dinopanel', 'restart').reason).toMatch(/panel/i);
  });
});

describe('normalizeServiceUnit', () => {
  it('appends .service only when there is no type suffix', () => {
    expect(normalizeServiceUnit('sshd')).toBe('sshd.service');
    expect(normalizeServiceUnit('sshd.service')).toBe('sshd.service');
    expect(normalizeServiceUnit('foo.socket')).toBe('foo.socket');
  });
});

describe('serviceActionBodySchema', () => {
  it('accepts a valid unit + action', () => {
    expect(serviceActionBodySchema.safeParse({ unit: 'nginx.service', action: 'restart' }).success).toBe(true);
    expect(serviceActionBodySchema.safeParse({ unit: 'foo@bar.service', action: 'start' }).success).toBe(true);
  });

  it('rejects a leading-dash / injection unit name or unknown action', () => {
    expect(serviceActionBodySchema.safeParse({ unit: '-x', action: 'restart' }).success).toBe(false);
    expect(serviceActionBodySchema.safeParse({ unit: 'a;reboot', action: 'restart' }).success).toBe(false);
    expect(serviceActionBodySchema.safeParse({ unit: 'a b', action: 'restart' }).success).toBe(false);
    expect(serviceActionBodySchema.safeParse({ unit: 'nginx.service', action: 'nuke' }).success).toBe(false);
  });

  it('the critical set includes sshd', () => {
    expect(SUPERVISOR_CRITICAL_UNITS.has('sshd.service')).toBe(true);
  });
});
