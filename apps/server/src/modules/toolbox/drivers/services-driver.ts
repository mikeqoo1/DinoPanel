import { ServiceUnavailableException } from '@nestjs/common';
import type { ServiceUnit, SystemdAction } from '@dinopanel/shared';
import { runCommand, assertSuccess } from '../../../common/shell/run-command';

export interface ServicesDriver {
  /** True only for the real systemctl-backed driver; false on Unavailable. */
  readonly available: boolean;
  /** All `.service` units with runtime + enabled state. Read-only, no sudo. */
  list(): Promise<ServiceUnit[]>;
  /** start|stop|restart|enable|disable a unit (sudo -n). */
  action(unit: string, action: SystemdAction): Promise<void>;
  /**
   * Resolve an alias to its canonical unit Id (read-only, no sudo) so the
   * protected-units guard can be re-judged on the real target — a string
   * denylist alone can't see that e.g. `dbus-org.freedesktop.login1.service`
   * IS `systemd-logind.service`. Best-effort: returns the input on failure.
   */
  resolveCanonicalUnit(unit: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// Pure parsers — exported for golden-string tests (no DI).
// ---------------------------------------------------------------------------

interface RuntimeRow {
  name: string;
  loadState: string;
  activeState: string;
  subState: string;
  description: string;
}

/**
 * Parse `systemctl list-units --type=service --all --no-legend --no-pager
 * --plain`. Columns: UNIT LOAD ACTIVE SUB DESCRIPTION (description trails and
 * may contain spaces). `--no-legend` drops the header/footer; `--plain` drops
 * the tree glyphs, but a leading status bullet ("●") can still appear for
 * failed units, so we strip it. Rows that don't match (blank / stray) skip.
 */
export function parseSystemctlUnits(stdout: string): RuntimeRow[] {
  const out: RuntimeRow[] = [];
  for (const raw of stdout.split('\n')) {
    const line = raw.replace(/^[●*\s]+/, '').trimEnd();
    if (!line) continue;
    const m = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, name, loadState, activeState, subState, description] = m;
    if (!name!.endsWith('.service')) continue;
    out.push({
      name: name!,
      loadState: loadState!,
      activeState: activeState!,
      subState: subState!,
      description: (description ?? '').trim(),
    });
  }
  return out;
}

/**
 * Parse `systemctl list-unit-files --type=service --no-legend --no-pager
 * --plain` into a name→state map. Columns: UNIT_FILE STATE [VENDOR_PRESET]
 * (the preset column exists on newer systemd; we read only the first two).
 */
export function parseSystemctlUnitFiles(stdout: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of stdout.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(\S+)\s+(\S+)/.exec(line);
    if (!m) continue;
    const name = m[1]!;
    if (!name.endsWith('.service')) continue;
    map.set(name, m[2]!);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

export class SystemctlServicesDriver implements ServicesDriver {
  readonly available = true;

  // requireSudo supplied by the module factory (TOOLBOX_REQUIRE_SUDO). Reads
  // need no sudo; only the mutating action() runs under sudo -n.
  constructor(private readonly requireSudo: boolean) {}

  async list(): Promise<ServiceUnit[]> {
    const units = await runCommand(
      'systemctl',
      ['list-units', '--type=service', '--all', '--no-legend', '--no-pager', '--plain'],
      { timeoutMs: 15_000 },
    );
    assertSuccess(units, 'systemctl list-units');
    // Enabled state is best-effort enrichment; don't fail the whole list if
    // list-unit-files misbehaves on an odd host — swallow BOTH a non-zero exit
    // and a thrown CommandError (timeout / spawn error).
    let enabledByName = new Map<string, string>();
    try {
      const files = await runCommand(
        'systemctl',
        ['list-unit-files', '--type=service', '--no-legend', '--no-pager', '--plain'],
        { timeoutMs: 15_000 },
      );
      if (files.exitCode === 0) enabledByName = parseSystemctlUnitFiles(files.stdout);
    } catch {
      /* leave enabledState null on every unit */
    }
    return parseSystemctlUnits(units.stdout).map((u) => ({
      name: u.name,
      description: u.description,
      loadState: u.loadState,
      activeState: u.activeState,
      subState: u.subState,
      enabledState: enabledByName.get(u.name) ?? null,
    }));
  }

  async action(unit: string, action: SystemdAction): Promise<void> {
    // `--` end-of-options guard (the unit name is already shape-validated).
    const r = await runCommand('systemctl', [action, '--', unit], {
      sudo: this.requireSudo,
      timeoutMs: 30_000,
    });
    assertSuccess(r, `systemctl ${action} ${unit}`);
  }

  async resolveCanonicalUnit(unit: string): Promise<string> {
    // Read-only (no sudo). `Id` is systemd's canonical name for an alias.
    try {
      const r = await runCommand('systemctl', ['show', '-p', 'Id', '--value', '--', unit], {
        timeoutMs: 10_000,
      });
      const id = r.stdout.trim();
      return id || unit; // empty (unknown unit) => fall back to the given name
    } catch {
      return unit; // best-effort: a failed lookup must not block a legit action
    }
  }
}

/**
 * Fallback when `systemctl` is not on PATH (non-systemd host / container).
 * Every op 503s `SERVICES_NOT_CONFIGURED`; GET /toolbox/status reports
 * availability from `available` without calling these. Mirrors the NTP/Disk
 * Unavailable drivers.
 */
export class UnavailableServicesDriver implements ServicesDriver {
  readonly available = false;
  private throw503(): never {
    throw new ServiceUnavailableException({
      code: 'SERVICES_NOT_CONFIGURED',
      message: 'systemctl is not available on this host',
    });
  }
  list(): Promise<ServiceUnit[]> {
    this.throw503();
  }
  action(): Promise<void> {
    this.throw503();
  }
  resolveCanonicalUnit(): Promise<string> {
    this.throw503();
  }
}
