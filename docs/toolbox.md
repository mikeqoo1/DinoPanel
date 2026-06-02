# Toolbox (v0.6)

The Toolbox module groups small host-maintenance tools behind
`/api/toolbox/*`, plus the Fail2Ban view which extends the firewall
module at `/api/firewall/fail2ban/*`. The frontend lives at
`/toolbox` with one tab per tool (NTP, Fail2Ban, Disk).

v0.6.0 ships three tools:

- **NTP / time-sync** — read time-sync state, toggle NTP, change the
  system timezone (via `timedatectl`, with optional `chronyc`
  enrichment).
- **Fail2Ban** — read-only jail list + counters + banned IPs, manual
  ban, per-IP unban (extends `firewall.service`, see
  [`docs/firewall.md`](firewall.md)).
- **Disk** — `df` filesystem usage, a `du` per-directory breakdown over
  a closed root allowlist, and curated tool-owned cleaners (journald
  vacuum, package-cache clean, docker prune).

> Deferred to later v0.6.x / v0.7: swap-file editing, supervisor, MFA,
> passkey — see `.arceus/changes/v0.6-toolbox/decisions.md` (D1).

## Design posture: nothing the tool doesn't own

Every Toolbox operation is **tool-owned and path-less or allowlisted** —
there is no arbitrary-path input that runs as root:

- **Disk breakdown** (`GET /toolbox/disk?path=`) is gated by a closed,
  **exact-match** root allowlist (`SAFE_DU_ROOTS`:
  `/var`, `/usr`, `/home`, `/opt`, `/var/log`, `/var/lib`). `/var/foo`
  is rejected even though `/var` is allowed — it is membership, not a
  prefix test. The `du` call additionally uses a `--` end-of-options
  guard.
- **Cleaners** (`POST /toolbox/clean`) take a **closed category enum**
  (`journald | package_cache | docker_prune`), never a filesystem path.
  Each cleaner's underlying tool owns what it deletes. `docker_prune`
  mirrors `docker system prune` — stopped containers + dangling images
  only, **never volumes**. (A `/tmp` sweep was deliberately dropped:
  a blanket wipe risks active sockets/locks. See decisions P2-a/P2-b.)
- **Timezone** (`POST /toolbox/ntp/timezone`) is validated three ways:
  a Zod shape regex (no leading dash, so it can't be read as a flag),
  a service-level allowlist check against the host's own
  `timedatectl list-timezones`, and a `--` end-of-options guard.
- **Fail2Ban** ban/unban validates the IP and checks the jail against
  the **live jail list** (`assertJailExists`) before mutating; jail
  names are shape-validated (no leading dash, bounded length).

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `TOOLBOX_REQUIRE_SUDO` | `true` | Warn at boot if `sudo -n true` fails; also drives the `sudo -n` posture for mutating `timedatectl`, the cleaners, and **all** `fail2ban-client` calls. Set `false` in development or when the panel already runs as root. |

`TOOLBOX_REQUIRE_SUDO` is shared: the firewall module reuses it for the
`fail2ban-client` sudo posture rather than introducing a second knob.

## Sudoers contract

DinoPanel runs as an unprivileged user and shells out via `sudo -n`
(non-interactive) for every *mutating* host command. Read-only reads
(`timedatectl show`/`status`/`list-timezones`, `df`, `du`) do **not**
use sudo; `fail2ban-client` is run under sudo for every call (its
socket is root-owned, including `ping`/`status`).

Per decision **D4**, all of it is covered by **one consolidated
`Cmnd_Alias`**. Add this to `/etc/sudoers.d/dinopanel-toolbox`
(mode `0440`) once at install time:

```
# /etc/sudoers.d/dinopanel-toolbox   (mode 0440, validate with: visudo -cf)
Cmnd_Alias DINOPANEL_TOOLBOX = \
    /usr/bin/timedatectl set-ntp *, \
    /usr/bin/timedatectl set-timezone -- *, \
    /usr/bin/journalctl --vacuum-size=500M, \
    /usr/bin/dnf clean all, \
    /usr/bin/apt-get clean, \
    /usr/bin/fail2ban-client ping, \
    /usr/bin/fail2ban-client status, \
    /usr/bin/fail2ban-client status *, \
    /usr/bin/fail2ban-client set * banip *, \
    /usr/bin/fail2ban-client set * unbanip *, \
    /usr/bin/fail2ban-client start *, \
    /usr/bin/fail2ban-client stop *

dinopanel ALL=(root) NOPASSWD: DINOPANEL_TOOLBOX
```

Notes:

- Replace `dinopanel` with the account the panel runs under.
- Binary paths differ by distro — confirm with
  `command -v timedatectl journalctl dnf apt-get fail2ban-client` and
  adjust the absolute paths. A line whose binary doesn't exist on the
  host simply never matches (harmless), so it's safe to keep both
  `dnf clean all` and `apt-get clean` and let the host use the one it
  has.
- The panel spawns the bare binary name and lets `sudo` resolve it
  against its own `secure_path`. The alias path must equal **that**
  resolved path — a mismatch on a binary that *is* present (e.g.
  `timedatectl`/`journalctl` under `/bin` on a non-merged-`/usr` host)
  is a silent `PERMISSION_DENIED` 503, not a harmless no-match. On the
  supported merged-`/usr` distros (Rocky/Alma/RHEL 8+, current
  Ubuntu/Debian) `/bin` → `/usr/bin`, so `/usr/bin/*` is correct;
  if in doubt, verify the policy actually matches with `sudo -ln`.
- The journald cap (`--vacuum-size=500M`) is a server-pinned constant
  (never from the request body) precisely so the sudoers rule can pin
  the exact flag.
- Validate before reloading sudo:
  `sudo visudo -cf /etc/sudoers.d/dinopanel-toolbox`.

On boot `ToolboxService` runs `sudo -n true` as a probe. If it fails and
`TOOLBOX_REQUIRE_SUDO=true` (the default), the module logs a clear
warning pointing at this file and `GET /toolbox/status` reports the
affected feature as `degraded` with `reason: "SUDO_UNAVAILABLE"`. The
panel still boots — no tool takes the process down.

## Degraded / unavailable behavior

The module never crashes the panel because a host tool is missing.
Each tool probes its binary at boot (`which`) and selects either the
real driver or an `Unavailable*` stub:

| Tool | Binary | When absent |
| --- | --- | --- |
| NTP | `timedatectl` | every op → `503 NTP_NOT_CONFIGURED` |
| Disk | `df` | every op → `503 DISK_NOT_CONFIGURED` |
| Cleaner: journald | `journalctl` | `503 JOURNALD_NOT_AVAILABLE` |
| Cleaner: package_cache | `dnf` / `apt-get` | `503 NO_PACKAGE_MANAGER` |
| Cleaner: docker_prune | docker socket | `503 DOCKER_UNREACHABLE` |
| Fail2Ban | `fail2ban-client ping` | mutations → `400 FAIL2BAN_NOT_AVAILABLE` |

`GET /toolbox/status` and `GET /toolbox/cleaners` report availability
up-front (computed from the boot probes, without calling the tools), so
the UI hides or disables what the host can't do rather than surfacing a
runtime error.

## Error responses & host stderr

Host-command failures are re-wrapped into coded `HttpException`s
(`TOOLBOX_*` / `FIREWALL_*`) by the shared `commandErrorToHttp` helper
in `common/shell/run-command.ts`. As of Phase 4 the **raw host `stderr`
is never forwarded to the client in production** — it can leak
filesystem paths and config internals. The full stderr is logged
server-side (`toolbox.command_failed` / `firewall.command_failed`); it
is only included in the response `details.stderr` when `NODE_ENV` is
`development`. This is a shared-layer fix, so the firewall module
inherits the same behavior.

## SELinux / AppArmor

The Toolbox tools operate on host state managed by their own daemons
(`systemd-timedated`, `journald`, the package manager, `fail2ban`,
the docker socket) and need no DinoPanel-specific filesystem labeling.
The only requirement is the sudoers grant above. On SELinux-enforcing
hosts the commands run under the operator's existing sudo context, so
no extra `semanage`/`restorecon` step is needed for the Toolbox itself.
