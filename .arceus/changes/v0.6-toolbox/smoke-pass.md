# v0.6.0 Toolbox — Rocky 234 smoke pass

**Date:** 2026-06-02
**Host:** Rocky Linux 9.4, `192.168.199.234:9999` (Xeon Gold 5218, 600+ days uptime)
**Build:** v0.6.0 (`f240ad2`), deployed by operator via `install.sh`
**Driver:** `scripts/smoke-toolbox-234.sh` (TOKEN auth, run from the dev workstation against the live API)

Version badge confirms `DinoPanel v0.6.0`; `/toolbox` renders the three tabs
(時間同步 / Fail2Ban / 磁碟與清理); the disk tab parses real `df` output
(root/home/boot + docker overlay mounts).

## Results

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| S1 | boot tools-present | ✅ PASS | `GET /toolbox/status` → `ntp`+`disk` both `available:true, degraded:false`; `GET /toolbox/cleaners` → `journald`/`package_cache`/`docker_prune` all available; `GET /firewall/status` → `{backend:"firewalld", enabled:true, fail2ban:false}` |
| S2 | boot tool-absent contract | ✅ PASS | fail2ban not installed on this host (`fail2ban:false`); `GET /firewall/fail2ban/jails` → **400 `FAIL2BAN_NOT_AVAILABLE`** (degrades cleanly, not a 500) — a genuine live exercise of the absent-tool path |
| S3 | NTP round-trip | ✅ PASS | current `timezone=Asia/Taipei ntpEnabled=true`; `POST /toolbox/ntp/set {enabled:true}` and `POST /toolbox/ntp/timezone {timezone:"Asia/Taipei"}` both round-trip with state unchanged → the `sudo -n` mutate path works on the deployed host |
| S4 | fail2ban list + ban/unban | ⏭️ N/A | fail2ban not installed on 234, so the ban/unban round-trip is not exercisable here. The absence contract is verified by S2 (live 400) + the unit tests (`FAIL2BAN_NOT_AVAILABLE` / `assertJailExists` / invalid-name). Re-run after `dnf install fail2ban` + a configured jail for full live coverage. |
| S5 | journald vacuum + docker prune | ⏭️ deferred | Opt-in (`RUN_CLEANERS=1`); deliberately not run against the production box (journald vacuum to 500M + docker prune mutate host state). Availability confirmed in S1; cleaner logic covered by `cleaner-driver.test.ts`. |

**Automated S1–S3 PASSED** (S2 includes a real live absent-tool path). S4 is a host
condition (fail2ban absent), S5 is an operator-opt-in deferral — neither is a defect.

## Notes / followups (non-blocking)

- **Disk table is verbose on a docker host**: `df -PB1` surfaces every docker
  `overlay2` `.../merged` mount (each shows the shared root figure, e.g.
  169.5 GB / 629.7 GB / 27%). Accurate but noisy. A future UX tweak could
  collapse/group `overlay`+`tmpfs` rows or dedup by backing device. Not a v0.6
  blocker.
- **fail2ban**: install + configure a jail on 234 to light up the Fail2Ban tab
  and exercise S4 live (currently shows the "not configured" state, by design).
