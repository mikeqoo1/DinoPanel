# v0.5 — Database backups + restore module

**Status:** ready (2026-05-21, awaiting Phase 1 kick-off)
**Target:** v0.5.0
**Depends on:** v0.4.3-pmm-inventory-readonly (the entire v0.4 line)
**Origin:** v0.4 shipped five engines as containers + a connection card,
but no backup story. `docs/databases.md` only documents a manual
"escape hatch" with `docker exec mysqldump > file.sql`. v0.5.0 closes
the gap with a real module.

## Problem

After v0.4 lands an operator has running DB instances with passwords
in the panel and data on disk — but no UI path for:

1. Taking a backup on demand (one-off, before a risky migration).
2. Scheduling recurring backups (nightly dumps, retained N copies).
3. Restoring from an existing backup (recover-from-broken-update).

The operational reality is that any panel managing production DBs
that doesn't ship backups is half-finished. 1Panel ships this in
v1.x. Closing this gap is the natural v0.5 chapter.

## Scope

**In:**

- Per-engine logical backup (dump-style) — mysqldump, pg_dump,
  mongodump, redis BGSAVE+RDB copy, mariadb-via-mysqldump.
- Local file storage under `/opt/dinopanel/backups/<engine>/<instance>/`
  with a `<timestamp>.sql.gz` naming convention.
- Manual create + list + delete + restore endpoints + UI.
- Cron-style scheduling via the existing v0.5 scheduler module —
  new `db_backup` task type, retention policy as task params.
- Restore-in-place — drop and recreate the target DB inside the
  same container; volume + container identity preserved.
- Retention prune — keep-last-N (default 7) executed at end of
  every successful backup.

**Out (deferred to v0.5.x or v0.6):**

- Physical / file-level backups (mariabackup, pg_basebackup, RDB
  snapshot under load) — needs LVM / docker volume coordination,
  complex, can fall back to docker volume snapshot for operators
  who need this.
- S3 / MinIO upstream storage — would add credentials UI + SDK
  dependency. Local first, remote later.
- Restore-to-new-instance (= clone DB) — separate UX, different
  scope, v0.6 candidate.
- Point-in-time recovery (PITR via binlog / WAL replay) — large
  scope, separate roadmap.
- Cross-engine restore (dump from mysql 8 to mariadb 11 etc.) —
  operator can run sql files manually.
- Encryption-at-rest for backup files — SecretsService territory,
  separate roadmap (v0.4 Q4 deferred).

## Six phases (estimate 7-10 dev-days)

### Phase 1 — Foundation (~1 day)

- `backups` table in SQLite (instance_id, file_path, byte_size,
  created_at, retention_group, source: 'manual' | 'scheduled').
- `/opt/dinopanel/backups/<engine>/<instance>/` dir bootstrap on
  module init (idempotent, mode 0700 root).
- `BackupDriver` interface — per engine, two methods:
  `dumpToStream(container, dbName?): Readable` and
  `restoreFromStream(container, sql: Readable): Promise<void>`.
- Engine registry mirror — `BackupDriverRegistry` (same pattern
  as v0.4's `DbEngineRegistry`).
- Module skeleton, route stubs.

### Phase 2 — Per-engine drivers (~2 days)

Each driver returns a Readable from `dumpToStream()` that the
service layer pipes through `zlib.createGzip()` into the host
file. Restore reverses: file → gunzip → exec stdin.

| Engine     | Dump command | Restore command |
| ---------- | --- | --- |
| mysql      | `mysqldump --all-databases --single-transaction --quick` | `mysql` |
| mariadb    | same as mysql (mariadb ships mysqldump) | same as mysql |
| postgresql | `pg_dumpall --clean --if-exists` | `psql` |
| redis      | `redis-cli SAVE` then `cat /data/dump.rdb` (no streaming SAVE; full snapshot) | `redis-cli FLUSHALL` + copy dump.rdb + restart |
| mongodb    | `mongodump --archive --gzip` (already gzipped, we skip the host gzip step) | `mongorestore --archive --gzip --drop` |

Auth: dump runs with the root credentials DinoPanel stored at
create-time. No new auth path.

### Phase 3 — Backups service + REST (~1.5 days)

REST endpoints under `/api/backups`:

```
POST   /api/databases/:id/backups          (create — sync, returns row)
GET    /api/databases/:id/backups          (list for instance)
GET    /api/backups                         (list all)
DELETE /api/backups/:backupId               (delete file + row)
POST   /api/backups/:backupId/restore       (restore-in-place + confirm)
GET    /api/backups/:backupId/download      (stream backup file out)
```

Retention prune runs on backup-create success: drop oldest files
+ rows for the same `(instance_id, retention_group)` past the
configured count (default 7).

### Phase 4 — Scheduler integration (~1 day)

Existing scheduler module supports 6 task types (per memory).
Adds a 7th: `db_backup` with params `{ instanceId, retentionGroup, keepLastN, cron }`.

Task runner calls into `BackupsService.create()` with
`source: 'scheduled'`. Failure raises a `task_log` row that the
log centre surfaces.

### Phase 5 — Frontend (~1.5 days)

- New `/backups` route — list view of all backups, filter by
  instance, sort by created_at.
- DB drawer (already exists from v0.4) gains a "Backups" tab —
  per-instance list + "Create backup now" button.
- Schedule UI lives in the existing `/scheduler` route (reuses
  task-create dialog with the new task type).
- Restore confirmation modal — type the instance name to
  confirm + "this drops the existing DB" red warning.
- Download button per backup (streams the gzip file).
- i18n keys under `backups.*` (zh-TW + en).

### Phase 6 — Docs + release (~1 day)

- New `docs/backups.md` with engine-specific notes (e.g., redis
  RDB is "best effort" since BGSAVE doesn't wait), retention
  semantics, restore-flow walkthrough, disk-usage advice.
- Update `docs/databases.md` to point at `docs/backups.md` and
  retire the "escape hatch" mention.
- README roadmap row for v0.5.
- Cut v0.5.0 release commit + tarball + Rocky 234 smoke
  (manual backup of `shop` PostgreSQL + restore round-trip).

## Resolved direction decisions

See `decisions.md`. Quick summary:

| ID | Decision |
| -- | -------- |
| Q1 | Logical (dump-style) backups only |
| Q2 | Local-only at `/opt/dinopanel/backups/` |
| Q3 | New `db_backup` scheduler task type |
| Q4 | Restore-in-place |
| Q5 | Keep-last-N retention (default 7) |
| Q6 | Docker exec stdout pipe + host gzip |

## What v0.5.0 is, what v0.5.0 isn't

**Is:** a manual + scheduled local backup story for the five DB
engines DinoPanel manages. Closes the most-asked v0.4 gap. Reuses
the existing scheduler + log-centre + drawer-UI infrastructure.

**Isn't:** a S3/remote storage adapter, a PITR system, a
cross-engine migration tool, encryption-at-rest, or a clone-DB
feature. Each is a separate roadmap candidate.

## Relation to other deferred work

- **v0.4 SecretsService (Q4 deferred):** backups contain plaintext
  data and (for SQL dumps) any plaintext secrets stored in DB
  rows. v0.5.0 inherits the same posture as v0.4 — DinoPanel runs
  as root, panel admin == OS admin. Backup files written 0600
  root. SecretsService is still a separate later concern.
- **v0.4.x-pmm-cards-conditional Option B (auto-register):** no
  interaction; v0.5 backups don't touch PMM.
- **archived v0.X multi-host PMM inventory:** no interaction.
