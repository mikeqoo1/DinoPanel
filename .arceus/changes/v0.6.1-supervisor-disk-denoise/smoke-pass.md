# v0.6.1 Toolbox (Supervisor + disk de-noise) — Rocky 234 smoke pass

**Date:** 2026-06-03
**Host:** `emts-rd-01.concords.com.tw` / `192.168.199.234:9999` (Rocky 9.4)
**Build:** v0.6.1 (`35ef1e7`), deployed by operator via `install.sh`
(`server/package.json` = 0.6.1, `dinopanel` service active + enabled,
**runs as root**)
**Driver:** `scripts/smoke-toolbox-234.sh` (TOKEN auth, from the dev workstation)

## Results

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| S1 | boot tools-present | ✅ PASS | `GET /toolbox/status` lists **3 features** — `ntp`, `disk`, **`services`** — all `available:true`; cleaners all available; firewall `{fail2ban:false}` |
| S2 | boot tool-absent contract | ✅ PASS | fail2ban not installed → `GET /firewall/fail2ban/jails` → **400 `FAIL2BAN_NOT_AVAILABLE`** |
| S3 | NTP round-trip | ✅ PASS | set-ntp + set-timezone round-trip via sudo (root), state unchanged |
| S4 | fail2ban list+unban | ⏭️ N/A | fail2ban not installed on 234 (covered by S2 live + unit tests) |
| S5 | journald vacuum + docker prune | ⏭️ deferred | opt-in (`RUN_CLEANERS=1`), not run against prod |
| **S6** | **services list + protected guard** | ✅ **PASS** | **180 `.service` units listed, all `.service`**; protected guard verified LIVE: `stop dinopanel.service` → `SERVICE_PROTECTED` (self), `stop sshd.service` → `SERVICE_PROTECTED` (critical), **`stop ssh.socket` → `SERVICE_PROTECTED`** (the `.service`-only guard — the HIGH review finding, blocked live) |

### Disk de-noise (Phase 1) — confirmed live

`GET /toolbox/disk` returns **27 filesystem rows, 15 of them `overlay`**
(the docker-layer noise from the v0.6.0 screenshot), every row carries
`fstype`, distinct fstypes `[devtmpfs, overlay, tmpfs, vfat, xfs]`. The web
default-hides the pseudo/overlay rows, so the table shows only the real
storage (xfs `/` + `/home`, vfat `/boot/efi`) with a "show system
filesystems" toggle to reveal the rest.

## Notes

- **Panel runs as root on 234**, so `sudo -n systemctl …` succeeds without
  the `/etc/sudoers.d/dinopanel-toolbox` `systemctl` lines — those matter
  only for a non-root operator deployment. The real lock-out protection is
  the **code-level** protected-units guard, which S6 verified live.
- A *successful* mutating action (e.g. restarting a benign unit) was NOT
  run against prod — the smoke deliberately exercises only the
  non-destructive refusals. The success path + argv are covered by the
  unit tests, and the guard is verified both in tests and live (S6).
