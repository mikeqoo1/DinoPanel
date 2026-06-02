import { z } from 'zod';

// v0.6.1 Supervisor — systemd `.service` management (toolbox "services" tab).
// systemd is the service manager on both supported distros; this manages
// existing units only (no unit-file editing / creation).

// systemd unit names: letters/digits/_/@/./- only, no leading dash (so a value
// can never be read as a systemctl flag), bounded length. We append ".service"
// when there is no type suffix before comparing to the protected sets.
const UNIT_NAME_REGEX = /^[A-Za-z0-9_@][A-Za-z0-9_@.-]*$/;
export const serviceUnitNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(UNIT_NAME_REGEX, 'Invalid systemd unit name');

export const systemdActionSchema = z.enum(['start', 'stop', 'restart', 'enable', 'disable']);
export type SystemdAction = z.infer<typeof systemdActionSchema>;

// One systemd .service unit (merge of `systemctl list-units` runtime state +
// `systemctl list-unit-files` enabled state).
export const serviceUnitSchema = z.object({
  name: z.string(), // e.g. "sshd.service"
  description: z.string(), // unit Description (may be empty)
  loadState: z.string(), // loaded | not-found | masked | ...
  activeState: z.string(), // active | inactive | failed | activating | ...
  subState: z.string(), // running | exited | dead | ...
  // enabled state from list-unit-files: enabled | disabled | static | masked |
  // generated | ...; null when the unit isn't present in list-unit-files.
  enabledState: z.string().nullable(),
});
export type ServiceUnit = z.infer<typeof serviceUnitSchema>;

// POST /toolbox/services/action
export const serviceActionBodySchema = z.object({
  unit: serviceUnitNameSchema,
  action: systemdActionSchema,
});
export type ServiceActionBody = z.infer<typeof serviceActionBodySchema>;

// ---------------------------------------------------------------------------
// Protected-units guard — the SINGLE SOURCE of truth. The server enforces it
// (400 SERVICE_PROTECTED) and the web uses it to disable the matching buttons,
// so the denylist is never duplicated.
// ---------------------------------------------------------------------------

/**
 * The panel's own systemd unit (install.sh sets SERVICE_NAME=dinopanel). ALL
 * mutation is refused: managing the panel from inside the panel is nonsensical
 * and a stop/restart would kill the request mid-flight. If you rename the unit
 * you lose this guard — manage the panel from the shell instead.
 */
export const SUPERVISOR_SELF_UNIT = 'dinopanel.service';

/**
 * Critical host units: `stop` + `disable` are refused (these are the
 * lock-yourself-out / brick-the-box ops); `start`/`restart`/`enable` are
 * allowed (e.g. restarting sshd does NOT drop existing connections).
 */
export const SUPERVISOR_CRITICAL_UNITS: ReadonlySet<string> = new Set([
  'sshd.service',
  'ssh.service',
  'firewalld.service',
  'ufw.service',
  'NetworkManager.service',
  'systemd-networkd.service',
  'dbus.service',
  'dbus-broker.service',
  'systemd-logind.service',
  'systemd-journald.service',
]);

/** Append ".service" when there is no type suffix (systemd's own default). */
export function normalizeServiceUnit(unit: string): string {
  return unit.includes('.') ? unit : `${unit}.service`;
}

export interface ServiceActionVerdict {
  allowed: boolean;
  reason?: string;
}

/**
 * Tiered protected-units guard. SELF → all refused; CRITICAL → stop/disable
 * refused; everything else allowed. Used by the server (enforce) and the web
 * (disable buttons).
 */
export function serviceActionAllowed(unit: string, action: SystemdAction): ServiceActionVerdict {
  const name = normalizeServiceUnit(unit);
  // Manage `.service` units ONLY. Without this, a `.socket`/`.target`/`.mount`
  // variant of a protected unit (e.g. `ssh.socket` on socket-activated sshd,
  // or `multi-user.target`) would slip past the `.service`-keyed tiers below
  // and re-open the very lock-out the guard exists to prevent.
  if (!name.endsWith('.service')) {
    return {
      allowed: false,
      reason: `Only systemd .service units can be managed here (got "${name}")`,
    };
  }
  if (name === SUPERVISOR_SELF_UNIT) {
    return {
      allowed: false,
      reason: `${SUPERVISOR_SELF_UNIT} is the panel's own service and cannot be controlled from here`,
    };
  }
  if (SUPERVISOR_CRITICAL_UNITS.has(name) && (action === 'stop' || action === 'disable')) {
    return {
      allowed: false,
      reason: `${name} is a protected system service — ${action} is refused (use a terminal if you must)`,
    };
  }
  return { allowed: true };
}
