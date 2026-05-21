# Spec — v0.5 database backups

Acceptance criteria gating each phase. All gates: typecheck pass,
lint pass, new+existing tests pass, build pass.

## Phase 1 — Foundation

### Schema

New `backups` table:

```sql
CREATE TABLE backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id INTEGER NOT NULL REFERENCES db_instances(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,            -- /opt/dinopanel/backups/<engine>/<instance>/<ts>.sql.gz
  byte_size INTEGER NOT NULL,         -- gzipped size on disk
  duration_ms INTEGER NOT NULL,       -- backup wall-clock time
  source TEXT NOT NULL,               -- 'manual' | 'scheduled'
  retention_group TEXT,               -- nullable; non-null for scheduled, used by prune
  keep_last_n INTEGER,                -- nullable; only set when retention_group set
  status TEXT NOT NULL,               -- 'success' | 'failed' (failed rows kept for log surface)
  error TEXT,                         -- nullable
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX backups_instance_idx ON backups(instance_id);
CREATE INDEX backups_retention_idx ON backups(instance_id, retention_group, created_at);
```

### Filesystem

- `/opt/dinopanel/backups/` exists, mode 0700 root, created by
  module bootstrap.
- Per-engine subdir `/opt/dinopanel/backups/<engine>/` (idempotent).
- Per-instance subdir created on first backup
  (`/opt/dinopanel/backups/<engine>/<instance-name>/`).
- File naming: `<unix-timestamp>-<source>.sql.gz` (e.g.
  `1716302400-manual.sql.gz`). Mongo override:
  `<timestamp>-<source>.archive.gz`.

### BackupDriver interface

```typescript
export interface BackupDriver {
  /** Engine this driver handles. */
  readonly engine: DbEngine;
  /** True when the dump output is already gzipped (mongo). */
  readonly alreadyGzipped: boolean;
  /** File extension before .gz (sql / archive). */
  readonly extension: string;
  /** Streams a backup from a running container. Throws on dump failure. */
  dump(args: { container: Docker.Container; instance: DbInstance }): Promise<NodeJS.ReadableStream>;
  /** Restores from a stream. Throws on restore failure. Idempotent at the engine level. */
  restore(args: { container: Docker.Container; instance: DbInstance; stream: NodeJS.ReadableStream }): Promise<void>;
}
```

### Gates

- [ ] `backups` migration lands and is idempotent (rerun on existing DB no-op).
- [ ] `BackupDriverRegistry.get(engine)` returns a driver for all 5 engines (stubbed for phase 1).
- [ ] Module wired into root AppModule; route stubs `GET /api/backups` returns `[]`.

## Phase 2 — Per-engine drivers

### Gates

- [ ] Each driver successfully dumps from a live container and the
  resulting file gzips → can be gunzipped + read by the matching
  client (`mysql < file.sql`, `psql < file.sql`, `mongorestore < file.archive`).
- [ ] Restore round-trip: create instance → write test row → dump
  → drop+recreate DB → restore → read row back. One e2e per engine.
- [ ] Auth uses root credentials from `db_instances.password` (no
  new credential storage path).
- [ ] Unit tests per driver against fake dockerode container
  (≥ 3 cases each: dump success / dump-cmd failure / auth failure).

### Engine-specific notes

- **mysql / mariadb:** `mysqldump -uroot -p$PASSWORD --all-databases --single-transaction --quick`. Restore: `mysql -uroot -p$PASSWORD`.
- **postgresql:** `pg_dumpall -U postgres --clean --if-exists`. Restore: `psql -U postgres`.
- **redis:** No streaming dump. Sequence: `redis-cli BGSAVE`, poll
  `LASTSAVE` until it increments, `cat /data/dump.rdb`. Restore:
  `FLUSHALL`, write to `/data/dump.rdb` while container stopped,
  restart container. Document this gotcha — redis restore needs
  a brief restart, not in-place stream.
- **mongodb:** `mongodump --archive --gzip --uri="..."`. Restore:
  `mongorestore --archive --gzip --drop`.

## Phase 3 — Service + REST

### Gates

- [ ] `POST /api/databases/:id/backups` — sync, returns the created
  `backups` row. Body optional `{ retentionGroup?: string; keepLastN?: number }`.
- [ ] `GET /api/databases/:id/backups` — list for instance,
  newest first.
- [ ] `GET /api/backups` — list all, paginated (?limit, ?cursor).
- [ ] `DELETE /api/backups/:backupId` — deletes file then row.
  Returns 204.
- [ ] `POST /api/backups/:backupId/restore` — body
  `{ confirm: <instanceName> }` (typo-guard like delete-instance
  flow). Returns the now-restored `db_instances` row.
- [ ] `GET /api/backups/:backupId/download` — streams gzip file
  with Content-Disposition. No re-compression.
- [ ] Retention prune: invoked on backup-create success, drops
  files + rows for `(instance_id, retention_group)` exceeding
  `keep_last_n`. Oldest first. Manual backups (retention_group=null) exempt.
- [ ] Audit interceptor logs all mutating endpoints (matches v0.4
  pattern).
- [ ] Service-level tests ≥ 8 cases (happy paths + retention prune +
  audit-log redaction of file_path).

## Phase 4 — Scheduler `db_backup` task type

### Gates

- [ ] New task type registered in scheduler's task type registry.
- [ ] Task params validated via Zod:
  `{ instanceId: number; retentionGroup: string; keepLastN: number; cron: string }`.
- [ ] Task runner invokes `BackupsService.create()` with
  `source: 'scheduled'`. Both success + failure paths produce
  task_log rows.
- [ ] Cron-string validated at task-create time (reuse existing
  cron-parser path).
- [ ] Existing scheduler tests still pass; new ≥ 4 cases for the
  new task type.

## Phase 5 — Frontend

### Gates

- [ ] `/backups` route lists all backups with: instance name,
  engine badge, source (manual/scheduled), size, created_at,
  download + delete + restore buttons.
- [ ] DB drawer (from v0.4) gains a "Backups" tab — per-instance
  list + "Create backup now" button.
- [ ] "Create backup now" mutation surfaces toast on completion
  with size + duration.
- [ ] Restore confirmation modal — type instance name + red
  warning that the current DB will be dropped.
- [ ] Download streams the gzip file via `<a download>` link.
- [ ] Schedule creation lives in `/scheduler` route (reuse existing
  task-create dialog with the new task type option).
- [ ] i18n keys under `backups.*` (zh-TW + en) — section title,
  empty state, button labels, restore-confirm copy.

## Phase 6 — Docs + release

### Gates

- [ ] `docs/backups.md` covers: how-it-works overview, per-engine
  notes (redis restart caveat, mongo gzipped archive),
  retention semantics, restore walkthrough, disk-usage advice.
- [ ] `docs/databases.md` updated — backup section points at
  `docs/backups.md`, "escape hatch" mention retired.
- [ ] `README.md` roadmap row for v0.5.
- [ ] `.arceus/changes/README.md` index updated.
- [ ] Version bump 0.4.8 → 0.5.0 (4 package.json files only —
  v0.4.7 made sidebar version Vite-injected, so no manual sidebar
  string change).
- [ ] Release commit pattern: `release(v0.5.0): database backups module`.
- [ ] Rocky 234 smoke — manual backup of `shop` PostgreSQL, verify
  gzip file lands at expected path, gunzip + restore round-trip,
  scheduled backup runs once via temp cron `* * * * *`.

## Out-of-scope (explicit non-goals)

- Physical / file-level backups.
- S3 / MinIO / SFTP remote targets.
- Restore-to-new-instance (clone DB).
- Point-in-time recovery (PITR).
- Cross-engine restore (mysql 8 dump → mariadb 11 etc.).
- Backup file encryption at rest.
- Backup of DinoPanel's own SQLite or `/opt/dinopanel/` tree —
  that's an OS-level concern.
