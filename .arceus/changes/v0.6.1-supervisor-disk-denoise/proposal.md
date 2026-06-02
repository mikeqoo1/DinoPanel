# v0.6.1 — Supervisor (systemd) + disk-table de-noise

A v0.6.x supplement on top of the shipped v0.6.0 toolbox. Two items,
both surfaced right after the v0.6.0 Rocky 234 deploy.

## 1. Disk-table de-noise

**Problem (seen in the v0.6.0 smoke):** on a docker host, `df` lists
every `overlay2 .../merged` mount — dozens of identical rows (each
showing the shared root figure) plus pseudo filesystems
(`proc`/`sysfs`/`cgroup`/`tmpfs`/`devtmpfs`). The toolbox disk tab
renders them all, burying the handful of real filesystems.

**Fix:** switch `df -PB1` → `df -PTB1` to add the **fstype** column
(POSIX, never localized). The API returns every filesystem *plus*
`fstype`; the web default-hides pseudo/overlay rows (via a shared
`PSEUDO_FSTYPES` set) behind a **"show system filesystems"** toggle.
Filtering is by **fstype**, not mount path, so an unusual-but-real
mount is never hidden.

## 2. Supervisor — systemd service management

1Panel's "Supervisor" manages supervisord programs; DinoPanel instead
ships **systemd `.service` management**, because both supported distros
(Rocky/Ubuntu) are systemd and the codebase already shells `systemctl`
(scheduler `restart_service`, nginx reload, the firewalld driver).
supervisord was rejected: it needs a separate install + per-program
config, is niche, and diverges from the existing grain.

Shipped as a **4th toolbox tab ("服務 / Services")**, mirroring the
NTP/Disk driver pattern (which-probe → real driver vs
`UnavailableServicesDriver` 503, `sudo -n`, `hostOp` re-wrap):

- **Read** (no sudo): list `.service` units with load/active/sub state,
  description, and enabled state (merge `systemctl list-units` +
  `list-unit-files`).
- **Write** (sudo -n): `start` / `stop` / `restart` / `enable` /
  `disable`, each `systemctl <action> -- <unit>`.

### Tiered protected-units guard (the safety core)

A single source of truth in `@dinopanel/shared` (server enforces it;
the web uses it to disable buttons):

- **SELF** (`dinopanel.service`) — refuse **all** mutation. Managing the
  panel's own unit from inside the panel is nonsensical and a stop/
  restart would kill the request mid-flight.
- **CRITICAL** (`sshd`/`ssh`, `firewalld`, `ufw`, `NetworkManager`/
  `systemd-networkd`, `dbus`/`dbus-broker`, `systemd-logind`,
  `systemd-journald`) — refuse **stop** + **disable** (the lockout/
  brick-the-box ops); **allow** start/restart/enable (restarting sshd
  doesn't drop live connections).
- **everything else** — all actions allowed.

A refused mutation returns `400 SERVICE_PROTECTED` with a clear reason.

## Non-goals (this cut)

- supervisord (rejected, see above).
- Swap-file editing — stays deferred (still a candidate for a later
  v0.6.x).
- Per-unit log viewer / `journalctl` tail — the Log Centre already
  exists; a per-service journal view can be a later supplement.
- Editing unit files / creating new services — out of scope; this
  manages existing units only.
- Container "services" — Databases/Backups/PHP-FPM are managed by their
  own modules; systemd is the host-service boundary here.

## Verification posture

Stateless, no migration. Each phase: typecheck · lint · test · build,
plus an adversarial review on the guardrail-bearing backend phase.
Release cut bumps 0.6.0 → 0.6.1; Rocky 234 smoke via an extended
`scripts/smoke-toolbox-234.sh` (services list + a safe protected-unit
refusal assertion).
