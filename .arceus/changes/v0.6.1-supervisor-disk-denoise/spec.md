# Spec — v0.6.1 (acceptance criteria)

## Disk de-noise

- `df` is invoked as `df -PTB1`; `parseDf` reads 7 positional columns
  (Filesystem, **Type**, 1-blocks, Used, Available, Capacity, Mounted-on),
  skips the localized header, rejects non-numeric block rows as before.
- `DiskFilesystem` gains `fstype: string`. `diskFilesystemSchema` updated;
  shared rebuilt.
- `@dinopanel/shared` exports `PSEUDO_FSTYPES: ReadonlySet<string>` and
  `isRealFilesystem(fstype): boolean` (false for pseudo set + `fuse.*`).
- The disk tab default-renders only real filesystems; a "show system
  filesystems" toggle reveals all. Toggle defaults OFF (hidden).
- The API (`GET /toolbox/disk`) returns ALL filesystems incl. `fstype`.
- Tests: `parseDf` golden incl. overlay/tmpfs/cgroup rows → fstype
  parsed; `isRealFilesystem` accepts ext4/xfs/btrfs/vfat, rejects
  overlay/tmpfs/proc/`fuse.sshfs`.

## Supervisor (systemd)

### Driver / API
- `which('systemctl')` → `SystemctlServicesDriver(requireSudo)` else
  `UnavailableServicesDriver` (503 `SERVICES_NOT_CONFIGURED` on every op).
- `GET /toolbox/services` → `ServiceUnit[]` = merge of
  `systemctl list-units --type=service --all --no-legend --no-pager --plain`
  (name, activeState, subState, description) and
  `systemctl list-unit-files --type=service --no-legend --no-pager --plain`
  (enabled state). Reads need no sudo.
- `POST /toolbox/services/action` body `{ unit, action }`
  (`action ∈ start|stop|restart|enable|disable`), ZodValidationPipe.
  → `serviceAction(unit, action)`: protected-guard, then
  `sudo -n systemctl <action> -- <unit>`; returns the fresh unit row
  (or `{ ok: true }`).
- `GET /toolbox/status` features[] gains `services`
  (`available` = driver.available; `degraded` = requireSudo &&
  !sudoProbeOk; reason `SERVICES_NOT_CONFIGURED` / `SUDO_UNAVAILABLE`).

### Protected-units guard (shared, single source)
- `serviceActionAllowed(unit, action): { allowed: boolean, reason? }` in
  `@dinopanel/shared`:
  - normalize: append `.service` if the name has no `.`.
  - SELF (`dinopanel.service`) → all actions refused.
  - CRITICAL set → `stop`/`disable` refused; others allowed.
  - else → allowed.
- Service calls it before shelling out; refusal → `400 SERVICE_PROTECTED`
  `{ reason }`. The unit name is also shape-validated (safe-name regex,
  ≤128) — reject pre-shell with `SERVICE_INVALID_UNIT`.

### Web
- New `/toolbox` tab "服務 / Services" (lazy, `pickTab` updated, nav).
- Table: name, description, active/sub badge, enabled badge; per-row
  buttons start/stop/restart/enable/disable. Buttons for actions that
  `serviceActionAllowed` refuses are **disabled** (shared helper), with a
  tooltip/title. "not configured" gate off `GET /toolbox/status`.
- `useServicesList()` + `useServiceAction()` hooks; `toolboxKeys.services`;
  mutation invalidates services list.
- i18n `toolbox.tabs.services` + `toolbox.services.*` in en + zh-TW
  (parity test stays green).

### Tests
- Parsers: `parseSystemctlUnits`, `parseSystemctlUnitFiles` golden.
- `serviceActionAllowed`: self → all refused; sshd stop/disable refused
  but restart/start/enable allowed; an ordinary unit (e.g. `crond`) →
  all allowed; bare-name normalization (`sshd` == `sshd.service`).
- Service-level: protected mutation → `SERVICE_PROTECTED`; invalid unit
  name → `SERVICE_INVALID_UNIT`; `UnavailableServicesDriver` → 503.

## Release / docs / smoke
- `docs/toolbox.md`: Services section + extend the `Cmnd_Alias` with
  `systemctl start|stop|restart|enable|disable *`; document the code
  denylist + that self-unit is `dinopanel.service`.
- Bump 0.6.0 → 0.6.1 (4 package.json). README + README_zh-TW roadmap row
  for v0.6.1. i18n parity green.
- Smoke (extend `scripts/smoke-toolbox-234.sh`): `GET /toolbox/services`
  returns units incl. `dinopanel`/`sshd`; a protected mutation (e.g.
  `stop sshd`) returns `400 SERVICE_PROTECTED` (assert, non-destructive);
  optionally a safe `restart`-of-a-benign-unit behind opt-in.
- Gate every phase: typecheck · lint · test · build. Adversarial review
  on Phase 2 (guard correctness).
