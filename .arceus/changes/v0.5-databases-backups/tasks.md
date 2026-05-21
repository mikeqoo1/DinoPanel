# Tasks — v0.5 database backups

Six phases per `proposal.md`. Each phase commits as a `feat(...)`
with the verification block; release cut happens at end of Phase 6.

## Phase 1 — Foundation

- [ ] Add `backups` table to `apps/server/src/database/schema.ts`
- [ ] Migration runs idempotently on existing DB (`CREATE TABLE IF NOT EXISTS`)
- [ ] Bootstrap `/opt/dinopanel/backups/` (mode 0700 root) in BackupsModule init
- [ ] `BackupDriver` interface in `apps/server/src/modules/backups/backup-driver.ts`
- [ ] `BackupDriverRegistry` provider (mirror `DbEngineRegistry` pattern)
- [ ] `BackupsModule` skeleton — controller stub returning `[]`
- [ ] Wire into `AppModule` root
- [ ] Phase 1 commit: `feat(backups): foundation (phase 1 of v0.5)`

## Phase 2 — Per-engine drivers

- [ ] `apps/server/src/modules/backups/drivers/mysql.backup-driver.ts`
- [ ] `apps/server/src/modules/backups/drivers/mariadb.backup-driver.ts` (shim over mysql impl)
- [ ] `apps/server/src/modules/backups/drivers/postgresql.backup-driver.ts`
- [ ] `apps/server/src/modules/backups/drivers/redis.backup-driver.ts` (BGSAVE + RDB copy + restart-on-restore)
- [ ] `apps/server/src/modules/backups/drivers/mongodb.backup-driver.ts` (`alreadyGzipped: true`)
- [ ] `BackupDriverRegistry` resolves all 5
- [ ] Driver-level unit tests against fake dockerode container — ≥ 3 cases per driver (dump success / dump-cmd failure / restore round-trip)
- [ ] Phase 2 commit: `feat(backups): per-engine drivers (phase 2 of v0.5)`

## Phase 3 — Service + REST

- [ ] `BackupsService.create({ instanceId, retentionGroup?, keepLastN?, source })`
- [ ] `BackupsService.list({ instanceId? })`
- [ ] `BackupsService.delete(backupId)` — file then row
- [ ] `BackupsService.restore({ backupId, confirmName })`
- [ ] `BackupsService.streamFile(backupId)` — for download
- [ ] Retention prune helper — invoked synchronously after `create` success
- [ ] Controller endpoints (6 routes per spec.md Phase 3)
- [ ] Audit interceptor coverage (mutating endpoints)
- [ ] Shared schemas (`@dinopanel/shared`): `backupResponseSchema`, `createBackupBodySchema`, `restoreBackupBodySchema`
- [ ] Service-level tests — ≥ 8 cases
- [ ] Phase 3 commit: `feat(backups): service + REST (phase 3 of v0.5)`

## Phase 4 — Scheduler integration

- [ ] Register `db_backup` task type in scheduler's task type registry
- [ ] Task params Zod schema
- [ ] Task runner — invokes `BackupsService.create({ source: 'scheduled' })`
- [ ] Cron string validation reuses existing cron-parser path
- [ ] Scheduler tests for the new task type — ≥ 4 cases
- [ ] Phase 4 commit: `feat(backups): scheduler db_backup task type (phase 4 of v0.5)`

## Phase 5 — Frontend

- [ ] `/backups` route — list view
- [ ] `useBackups({ instanceId? })` + mutation hooks in new `apps/web/src/hooks/use-backups.ts`
- [ ] DB drawer "Backups" tab (extend `database-drawer.tsx`)
- [ ] "Create backup now" button + toast
- [ ] Restore confirmation modal (typo-guard pattern from delete-instance)
- [ ] Download link per row (`<a download>`)
- [ ] Schedule UI hook — task-create dialog gets the new task type option
- [ ] i18n keys `backups.*` (zh-TW + en)
- [ ] Sidebar adds `/backups` link with icon
- [ ] Phase 5 commit: `feat(backups): frontend (phase 5 of v0.5)`

## Phase 6 — Docs + release v0.5.0

- [ ] `docs/backups.md` — full module doc
- [ ] `docs/databases.md` — retire escape hatch, point at backups
- [ ] `README.md` roadmap row for v0.5.0
- [ ] `.arceus/changes/README.md` index — flip v0.5-databases-backups to completed
- [ ] Version bump 0.4.8 → 0.5.0 (4 package.json files)
- [ ] Rocky 234 smoke checklist:
  - [ ] Manual backup of `shop` PostgreSQL → gzip file at expected path
  - [ ] `gunzip -c <file> | head` shows valid SQL preamble
  - [ ] Restore round-trip: write test row → backup → drop test row → restore → read row back
  - [ ] Scheduled backup test via `* * * * *` cron for 90 seconds, then delete schedule
  - [ ] Retention prune: create 8 quick backups, confirm 7 remain
- [ ] Release commit: `release(v0.5.0): database backups module`
- [ ] Tarball + scp to 234

## Smoke deferral (optional)

If Rocky 234 isn't reachable at cut time, ship code-only + flag
in meta.json that smoke is deferred. v0.4-databases used this
pattern (S6 / S7 deferred when Rocky lacked PMM).

## Phase rollback safety

- Phase 1 + 2 + 3 commits are reversible without data risk (no
  existing user backups can break since no backups exist yet).
- Phase 4 onwards touches scheduler — if a task_type registration
  regresses scheduler boot, revert the single phase commit.
- Restore-in-place is the only operation with real data-loss risk
  for users. The Phase 3 implementation MUST require the
  typo-guard confirm string before destroying the existing DB.
