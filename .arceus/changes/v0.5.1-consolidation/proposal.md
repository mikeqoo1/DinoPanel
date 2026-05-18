# v0.5.1 — Consolidation: Manual smoke pass + dogfood on Rocky

**Status:** draft
**Target:** v0.5.1 (~1 week, mostly testing)
**Depends on:** v0.5-firewall-cron-logs (all five phases shipped)

## Context

v0.5 shipped five phases of operational tooling (firewall, scheduler,
log centre, audit interceptor) and was deployed onto a real Rocky
Linux 9.4 host (192.168.199.234) on 2026-05-18. The deployment also
flushed out two release-pipeline bugs that are now fixed in
`cdb182b`:

- `build-release.sh` didn't rewrite `workspace:*` for npm
- `install.sh` didn't install `shared/`'s own runtime deps (`zod`)

What's left from v0.5 is the **four manual smoke-pass items** in
`tasks.md` Phase 5 — none of which can run in CI / dev because they
need a real firewall daemon, real systemd, and real time elapsing.

## Goals

1. **Validate firewall rollback safeguard live on Rocky**
   - Stage an allow rule via the UI
   - Watch the 30s countdown modal
   - Three sub-cases:
     a. Click Confirm → rule keeps, `confirmed_at` populated
     b. Click Revert → driver removes rule, meta row gone
     c. Close tab → timer expires, auto-revert fires, meta row gone

2. **Validate audit log dogfood**
   - Every UI mutation (settings save, scheduler create, firewall
     stage/confirm) lands as a row in `operation_log`
   - Body redaction works: changing password leaves `[redacted]`
     in `bodySummary`, never the plaintext

3. **Validate scheduler dogfood**
   - `system.purge_operation_log` task visible via
     `?includeBuiltin=true` in DB / API (hidden in UI by design)
   - Lower `audit.retentionDays` to 1, generate audit rows older
     than that, manually trigger purge via SQL/API, verify trim
   - (Optional) wait for 03:15 cron actual fire

4. **Confirm firewall driver detection**
   - Already validated: `firewalld` picked, real rules parsed
     (3306 / 4567 / 8986 etc.), all flagged `external: true`

## Non-goals (deferred to v0.6+)

- ufw smoke pass (would need a Debian/Ubuntu VM)
- Multi-host validation
- WebSocket follow mode for system log (still deferred)
- Anything that needs an actual config change to scope

## Open items / known limitations to surface

- **Audit retention test loop**: lowering retentionDays to 1 then
  Run-now-ing the purge is the fastest validation, but it doesn't
  exercise the actual `15 3 * * *` cron fire. Note both in
  `docs/scheduler.md` as "tested two paths: Run-now + scheduled".
- **PMM detour reminder**: this host runs PMM agents
  (postgres_exporter / qan_mysql_slowlog_agent visible in
  /system/logs). Once smoke pass passes we should also wire the
  Settings → PMM URL on this real host as a dogfood of the
  monitoring side-quest.
