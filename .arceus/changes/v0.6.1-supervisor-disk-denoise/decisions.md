# Decisions — v0.6.1

Operator-confirmed on 2026-06-02 (two forks asked; the rest are
recommended defaults adopted).

## S1 — Supervisor = systemd, not supervisord (CONFIRMED)

**Decision:** manage systemd `.service` units (list/status +
start/stop/restart/enable/disable). NOT supervisord.

**Why:** both supported distros are systemd; the codebase already
shells `systemctl` (scheduler `restart_service`, `nginx.service`
reload/start/stop, the firewalld driver). supervisord needs a separate
install + per-program config, is niche, and diverges from the grain.

**Rejected:** supervisord parity (high variance, extra dependency);
"both" (doubles the guardrail surface, busts the .1 size).

## S2 — Full lifecycle + tiered protection (CONFIRMED)

**Decision:** allow `start/stop/restart/enable/disable`, gated by a
three-tier guard (single source in `@dinopanel/shared`):

- **SELF** = `dinopanel.service` → refuse **all** mutation.
- **CRITICAL** = `sshd.service`, `ssh.service`, `firewalld.service`,
  `ufw.service`, `NetworkManager.service`, `systemd-networkd.service`,
  `dbus.service`, `dbus-broker.service`, `systemd-logind.service`,
  `systemd-journald.service` → refuse **stop** + **disable**; allow
  start/restart/enable.
- **else** → all allowed.

Refusal → `400 SERVICE_PROTECTED`. The guard helper
`serviceActionAllowed(unit, action)` lives in shared so the server
enforces it AND the web disables the corresponding buttons (no
duplicated denylist).

**Why this shape:** the operator picked "full lifecycle + tiered". The
self-refusal removes the only truly unrecoverable case (stopping the
panel from itself); CRITICAL refusing stop/disable blocks the
lock-out/brick ops while still allowing the legitimate `restart sshd`.

## S3 — Disk de-noise via `df -PTB1` + fstype filter (recommended default)

**Decision:** add `-T` (fstype column). API returns ALL filesystems +
`fstype`. The web default-hides `PSEUDO_FSTYPES` and offers a "show
system filesystems" toggle. Filter is by **fstype**, never by path.

`PSEUDO_FSTYPES` (default-hidden): `overlay`, `tmpfs`, `devtmpfs`,
`proc`, `sysfs`, `cgroup`, `cgroup2`, `mqueue`, `debugfs`, `tracefs`,
`bpf`, `pstore`, `securityfs`, `configfs`, `fusectl`, `hugetlbfs`,
`binfmt_misc`, `autofs`, `nsfs`, `efivarfs`, `ramfs`, `squashfs`,
and any `fuse.*`.

**Why fstype not path:** research showed path/source heuristics are
fragile (cgroup variants, tmpfs at odd paths) and device-dedup adds
stat() latency + mis-merges overlays. fstype is POSIX, never localized,
and keeps unusual-but-real mounts visible.

**Why default-hide + toggle (not server-drop):** the API stays honest
(full data, small payload); de-noise is presentation; the operator can
always see everything. `tmpfs` is included in the hidden set because on
a busy host the `/run/user/*` rows are themselves noise — the toggle
brings them back.

## S4 — Stateless, no staging (recommended default)

**Decision:** no drizzle table, no migration, live `systemctl` query
only. No 30s staged-confirm window (the firewall pattern) — it is
unnecessary because self-mutation is hard-refused outright, so there is
no "accidentally stopped the panel" case to recover from.

## S5 — Privilege: reuse TOOLBOX_REQUIRE_SUDO (recommended default)

**Decision:** reads (`list-units`, `list-unit-files`) need no sudo;
mutations run `sudo -n systemctl <action> -- <unit>`. Extend the
`DINOPANEL_TOOLBOX` sudoers `Cmnd_Alias` with
`systemctl start|stop|restart|enable|disable *`. The protected-units
denylist is enforced in **code** — sudoers cannot encode "all units
except dinopanel", and a wildcard there is fine because the code guard
is the real boundary. `--` end-of-options guard on the unit arg.

## Open implementation notes

- **Self unit name** is hardcoded `dinopanel.service` (install.sh sets
  `SERVICE_NAME=dinopanel`). Documented in docs/toolbox.md; if an
  operator renames the unit they lose the self-guard (acceptable, rare).
- **enabled state**: merge `systemctl list-unit-files --type=service`
  (UNIT STATE) into the `list-units` rows; a unit absent from
  list-unit-files (transient) defaults `enabled: null`.
- **Unit-name validation**: reuse the safe-name shape
  `/^[A-Za-z0-9_@.\\-]+$/` bounded to 128 chars; append `.service` when
  no `.` suffix before comparing to the protected sets.
