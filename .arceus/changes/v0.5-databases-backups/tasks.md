# Tasks — v0.5 database backups

Six phases per `proposal.md`. Each phase commits as a `feat(...)`
with the verification block; release cut happens at end of Phase 6.

## Phase 1 — Foundation

- [x] Add `backups` table to `apps/server/src/database/schema.ts`
- [x] Migration runs idempotently on existing DB (drizzle-kit `0005_giant_gargoyle.sql`, drizzle migrator checkpoints via `__drizzle_migrations`)
- [x] Bootstrap `/opt/dinopanel/backups/` (mode 0700 root) in BackupsModule init (`BackupsService.onModuleInit`)
- [x] `BackupDriver` interface in `apps/server/src/modules/backups/backup-driver.ts`
- [x] `BackupDriverRegistry` provider (mirror `DbEngineRegistry` pattern)
- [x] `BackupsModule` skeleton — controller stub returning `[]`
- [x] Wire into `AppModule` root
- [x] Phase 1 commit: `feat(backups): foundation (phase 1 of v0.5)`

## Phase 2 — Per-engine drivers

- [x] `apps/server/src/modules/backups/drivers/mysql.backup-driver.ts`
- [x] `apps/server/src/modules/backups/drivers/mariadb.backup-driver.ts` (shim over mysql impl via `mysql-family.ts`)
- [x] `apps/server/src/modules/backups/drivers/postgresql.backup-driver.ts`
- [x] `apps/server/src/modules/backups/drivers/redis.backup-driver.ts` (BGSAVE + LASTSAVE poll + RDB copy + container stop/start on restore)
- [x] `apps/server/src/modules/backups/drivers/mongodb.backup-driver.ts` (`alreadyGzipped: true`)
- [x] `BackupDriverRegistry` resolves all 5 (Phase 1)
- [x] Shared `exec-stream.ts` helper (demuxed dump stream / stdin restore pipe / buffering exec for redis-cli LASTSAVE)
- [x] Driver-level unit tests against fake dockerode container — 23 tests total (exec-stream 8, mysql/mariadb 4, postgresql 3, redis 4, mongodb 4)
- [x] Phase 2 commit: `feat(backups): per-engine drivers (phase 2 of v0.5)`

## Phase 3 — Service + REST

- [x] `BackupsService.create({ instanceId, retentionGroup?, keepLastN?, source })`
- [x] `BackupsService.list({ instanceId?, limit, cursor? })`
- [x] `BackupsService.delete(backupId)` — file then row, tolerates ENOENT
- [x] `BackupsService.restore({ backupId, confirm })` — typo-guard + gunzip on host (mongo skips)
- [x] `BackupsService.streamFile(backupId)` — for download (Readable + filename + byteSize)
- [x] `pruneRetention` helper — invoked synchronously after `create` success; manual rows exempt (retention_group=null)
- [x] Controller endpoints — split into `BackupsController` (/api/backups) + `BackupsByDatabaseController` (/api/databases/:id/backups)
- [x] Audit interceptor coverage — global APP_INTERCEPTOR auto-covers; bodies carry no sensitive fields (createBody=retentionGroup/keepLastN, restoreBody=confirm)
- [x] Shared schemas (`@dinopanel/shared/schemas/backups`): `backupResponseSchema`, `createBackupBodySchema` (retentionGroup+keepLastN must be paired), `restoreBackupBodySchema`, `listBackupsQuerySchema`
- [x] Service-level tests — 13 cases (create×5, list×1, delete×2, restore×3, streamFile×2)
- [x] Phase 3 commit: `feat(backups): service + REST (phase 3 of v0.5)`

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
