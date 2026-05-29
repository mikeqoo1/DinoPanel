# Database Backups

Logical (dump-based) backup + restore for the five database engines
managed by the Databases module, added in v0.5. Sits behind
`/api/backups/*` and `/api/databases/:id/backups` (JWT-protected).
The frontend lives at `/backups` plus a Backups tab inside each
instance drawer. Backups are local-only on the panel host.

> v0.5 ships the backups feature across phases:
> Phase 1–3 = paths + driver interface + per-engine drivers,
> Phase 4 = scheduler `db_backup` task type,
> Phase 5 = frontend (`/backups` page + drawer tab + dialogs),
> Phase 6 = docs + Rocky smoke + release.

## How it works

A backup is a single compressed dump file plus a row in the
`backups` SQLite table. Each engine has a driver implementing the
`BackupDriver` interface (`apps/server/src/modules/backups/backup-driver.ts`).

`BackupsService.create()` does, in order:

1. Open a dump stream via the engine driver (`driver.dump()`).
2. Host-side gzip the stream — **unless** the driver sets
   `alreadyGzipped = true` (MongoDB only; see below).
3. Write the bytes to a file on disk.
4. Insert a `backups` row recording engine, source, byte size and
   status.
5. If both `retentionGroup` and `keepLastN` are present, run the
   retention prune synchronously.

If the dump or write fails, the service unlinks the partial file
(best-effort) and still records a `failed` row — `byteSize: 0` and
the error message truncated to 2000 characters — before re-throwing.
Failed backups show up in the list but cannot be downloaded or
restored.

Drivers emit **raw, uncompressed** bytes from `dump()` (the host adds
gzip), with MongoDB the documented exception.

## Storage layout

All backup files live under `BACKUPS_ROOT` (env var, default
`/opt/dinopanel/backups`). The module creates the root at bootstrap
with mode `0700`. Layout is hierarchical by engine then instance:

```
/opt/dinopanel/backups/            # mode 0700
├── mysql/
│   └── shop/                      # mode 0700
│       ├── 1716200000000-manual.sql.gz       # mode 0600
│       └── 1716203600000-scheduled.sql.gz
├── mariadb/
├── postgresql/
│   └── app/
│       └── 1716200000000-scheduled.sql.gz
├── redis/
│   └── cache/
│       └── 1716200000000-manual.rdb.gz
└── mongodb/
    └── analytics/
        └── 1716200000000-scheduled.archive.gz
```

### File naming

```
<unix-ts>-<source>.<ext>.gz
```

- `<unix-ts>` — Unix epoch in milliseconds (`Date.now()`).
- `<source>` — `manual` or `scheduled`.
- `<ext>` — per-engine dump extension (see the table below).
- `.gz` — every backup file is gzip-compressed.

### Permissions

| Object | Mode |
|---|---|
| `BACKUPS_ROOT` | `0700` (rwx------) |
| `<engine>/` and `<engine>/<instance>/` subdirs | `0700` |
| backup files | `0600` (rw-------) |

The write stream is opened with `0600` and the file is `chmod`'d to
`0600` after write, so the dump is never group/world readable on disk.

## Per-engine notes

| Engine | Extension | Final filename | Dump | Restore |
|---|---|---|---|---|
| mysql | `sql` | `<ts>-<source>.sql.gz` | `mysqldump -u<user> --all-databases --single-transaction --quick --routines --events` | `mysql -u<user>` (gunzipped SQL on stdin) |
| mariadb | `sql` | `<ts>-<source>.sql.gz` | same as mysql (shared mysql-family driver) | same as mysql |
| postgresql | `sql` | `<ts>-<source>.sql.gz` | `pg_dumpall -U<user> --clean --if-exists` | `psql -U<user> -d postgres` (dump on stdin) |
| redis | `rdb` | `<ts>-<source>.rdb.gz` | `BGSAVE` then stream `/data/dump.rdb` | container stop → replace RDB → container start |
| mongodb | `archive` | `<ts>-<source>.archive.gz` | `mongodump --archive --gzip --username <user> --password <pwd> --authenticationDatabase admin` | `mongorestore --archive --gzip --drop --username <user> --password <pwd> --authenticationDatabase admin` (archive on stdin) |

Passwords come from the `instance.password` field stored in the
`db_instances` table. The mysql family injects it via the `MYSQL_PWD`
environment variable and postgres via `PGPASSWORD` (so it never lands
on the command line). Redis inherits `REDISCLI_AUTH` baked into the
container at create time. MongoDB passes `--password` on the command
line — accepted under the single-tenant container posture documented
in the driver.

### MongoDB — natively gzipped `.archive.gz`

`mongodump --archive --gzip` already emits compressed bytes. The
driver sets `alreadyGzipped = true`, so the service writes the dump
stream straight to disk and **skips** the host-side gzip step (no
double compression). The file extension is `archive`, so the final
name is `<ts>-<source>.archive.gz`. On restore the host likewise does
not gunzip — the gzipped archive is piped directly into
`mongorestore --gzip`.

### Redis — container restart caveat

Redis dump:

1. `redis-cli LASTSAVE` to capture the pre-save timestamp.
2. `redis-cli BGSAVE` to kick off a background save.
3. Poll `LASTSAVE` every 500 ms (bounded by a 5-minute ceiling)
   until it advances past the captured value.
4. `cat /data/dump.rdb` to stream the resulting RDB.

Redis **restore causes brief downtime**. There is no live in-place
import for an RDB, so the driver stops the container, writes the new
RDB to a temp file, `chmod`s it, atomically renames it into place,
then starts the container again. The instance is unavailable for the
duration of that stop/start cycle. Plan redis restores accordingly.

## Retention

Retention is keep-last-N, scoped **per `(instance, retention_group)`**:

- A backup carries an optional `retentionGroup` (label) and
  `keepLastN` (1–365). The scheduler form pre-fills `keepLastN: 7`
  (the design default from `decisions.md` D5); the API itself enforces
  no default, so supply it explicitly. Both must be set together or
  both omitted — mixing them is rejected at the API boundary
  (`retentionGroup` regex: `^[a-z0-9][a-z0-9-]*$`, max 32 chars).
- Pruning keeps the newest N **successful** backups within each
  `(instance_id, retention_group)` tuple and deletes the surplus
  oldest-first (both the file and the DB row).
- **Manual backups with no retention group are exempt** — a manual
  backup created without `retentionGroup`/`keepLastN` is never pruned
  automatically. Delete it yourself when you no longer need it.
- Prune runs **synchronously right after a successful create**, and
  only when both `retentionGroup` and `keepLastN` are present on that
  create call. There is no separate periodic sweep — retention is
  enforced as a side effect of taking the next backup in the same
  group.
- Prune is best-effort: a prune failure is logged via `logger.warn()`
  and **never** fails the parent backup. The backup you just took
  still succeeds even if cleaning up an old one errored.

The practical consequence: a retention group only shrinks when you
keep feeding it. A scheduled task pointed at group `daily` with
`keepLastN: 7` self-trims to seven files; a group that stops running
keeps whatever it last had.

## Manual backup walkthrough

From the UI: open a database instance drawer, go to the **Backups**
tab, and click **Create backup now**. On success a toast shows the
file size and the duration in seconds. A manual backup defaults to no
retention group, so it stays until you delete it.

Via the API:

```bash
# Manual backup, no retention (kept until manually deleted)
curl -X POST -H 'Authorization: Bearer <jwt>' -H 'Content-Type: application/json' \
  -d '{}' \
  http://127.0.0.1:9999/api/databases/1/backups

# Manual backup that participates in a retention group
curl -X POST -H 'Authorization: Bearer <jwt>' -H 'Content-Type: application/json' \
  -d '{"retentionGroup":"manual-adhoc","keepLastN":5}' \
  http://127.0.0.1:9999/api/databases/1/backups
```

`retentionGroup` and `keepLastN` must be supplied together or not at
all. Source is always `manual` for this endpoint.

## Scheduled backup walkthrough

Scheduled backups run through the scheduler's `db_backup` task type
(registered by `BackupsModule` at bootstrap via
`SchedulerService.registerRunner('db_backup', …)`). When the task
fires, the runner calls `BackupsService.create()` with `source:
'scheduled'`.

Two layers of configuration, and it's important to keep them straight:

- **The cron expression lives on the task row's own `cron` column**,
  validated by the scheduler controller — it is *not* part of the
  task payload.
- **The payload** (`dbBackupPayloadSchema`) carries exactly three
  fields: `instanceId`, `retentionGroup`, `keepLastN`.

From the UI: go to `/system/scheduler` → **Add Task**, choose task
type `db_backup`, then:

1. Select the target database instance.
2. Enter a retention group (lowercase letters / digits / `-`, 1–32
   chars).
3. Enter keep-last-N (1–365).
4. Build the cron schedule — the builder offers every-N-minutes,
   every-N-hours, daily, weekly and monthly modes, or a freeform cron
   string.

The submit button stays disabled until the name, cron, and all
required payload fields are valid. See `docs/scheduler.md` for the
cron semantics (server local time, no per-task timezone) and the run
lifecycle.

## Restore walkthrough

> **Restore is DESTRUCTIVE and restore-in-place.** It drops and
> recreates the database **inside the same container** the instance
> already runs in. There is no restore-to-a-new-instance and no clone.

What happens on restore:

1. The service reads the backup file, gunzipping on the host (except
   MongoDB, whose archive is fed gzipped to `mongorestore --gzip`).
2. The stream is piped into the engine's restore command against the
   **existing** container:
   - mysql / mariadb → `mysql -u<user>` on stdin
   - postgresql → `psql -U<user> -d postgres` on stdin (the dump was
     taken with `--clean --if-exists`)
   - mongodb → `mongorestore --archive --gzip --drop` on stdin
   - redis → container stop, RDB replaced atomically, container start
     (**brief downtime** — see the redis note above)

Guards:

- The request body **must** include `confirm`, and it must exactly
  equal the target instance's name. A mismatch is rejected with
  `BACKUP_RESTORE_CONFIRM_MISMATCH`. This is the typo guard.
- Only backups with `status='success'` can be restored; a failed
  backup is rejected with `BACKUP_NOT_RESTORABLE`.

From the UI: click **Restore** on a backup row (disabled for failed
backups). The confirmation dialog shows a red warning that the
database will be dropped and requires you to type the exact instance
name before the Restore button enables.

Via the API:

```bash
# Restore — confirm MUST equal the instance name exactly
curl -X POST -H 'Authorization: Bearer <jwt>' -H 'Content-Type: application/json' \
  -d '{"confirm":"shop"}' \
  http://127.0.0.1:9999/api/backups/42/restore
```

## REST contract

All endpoints require a valid JWT in `Authorization: Bearer …`.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/backups` | Lists all backups. Query: `?limit=…&cursor=…&instanceId=…`. Returns `{ items, nextCursor }` (`nextCursor` is `null` on the last page). |
| `DELETE` | `/api/backups/:backupId` | Deletes one backup. `204 No Content`. |
| `POST` | `/api/backups/:backupId/restore` | Restore-in-place. Body requires `confirm` = instance name. |
| `GET` | `/api/backups/:backupId/download` | Streams the gzip file with `Content-Disposition: attachment` and a gzip `Content-Type`. Throws `BACKUP_FILE_MISSING` if the file is gone from disk. |
| `GET` | `/api/databases/:id/backups` | Lists backups for one instance (hard limit 200). |
| `POST` | `/api/databases/:id/backups` | Creates a manual backup. Optional `retentionGroup` + `keepLastN` (both-or-neither). |

Examples:

```bash
# List all backups (paginated)
curl -H 'Authorization: Bearer <jwt>' \
  'http://127.0.0.1:9999/api/backups?limit=50'

# List backups for one instance
curl -H 'Authorization: Bearer <jwt>' \
  http://127.0.0.1:9999/api/databases/1/backups

# Download a backup to a file
curl -H 'Authorization: Bearer <jwt>' \
  http://127.0.0.1:9999/api/backups/42/download -o backup.sql.gz

# Delete a backup (file + DB row)
curl -X DELETE -H 'Authorization: Bearer <jwt>' \
  http://127.0.0.1:9999/api/backups/42
```

The `/backups` page renders a flat table (instance, engine, source,
size, created, status, actions). Failed backups show a destructive
status badge and have Download and Restore disabled. Download uses an
authenticated blob fetch rather than a bare link, and the list pages
via a **Load more** button.

## Disk usage

Backups accumulate on the panel host under `BACKUPS_ROOT`. Because
retention only prunes within an active `(instance, retentionGroup)`
tuple and only when that group keeps running, you are responsible for
keeping the footprint in check:

```bash
# Total backup footprint
du -sh /opt/dinopanel/backups

# Per-instance breakdown
du -sh /opt/dinopanel/backups/*/*

# Largest individual backups
ls -lhS /opt/dinopanel/backups/mysql/shop
```

Guidance:

- Always set a `retentionGroup` + `keepLastN` on **scheduled** tasks
  so they self-trim; an unbounded schedule will fill the disk.
- Manual ad-hoc backups (no retention group) are never auto-pruned —
  delete them when done.
- All files are gzip-compressed already; the on-disk size is the
  compressed size.

## Out of scope for v0.5

- **Physical backups** — backups are logical dumps only (no
  filesystem/volume snapshots).
- **Remote / S3 targets** — backups are local-only under
  `BACKUPS_ROOT`. No off-host upload.
- **Restore to a new instance / clone** — restore is in-place into
  the existing container only.
- **Point-in-time recovery (PITR)** — no binlog/WAL replay; you
  restore a discrete dump.
- **Cross-engine restore** — a backup restores only to its own engine.
- **At-rest encryption** — backup files are gzipped, not encrypted.
  They sit at `0600` under a `0700` tree; protect the host the same
  way you protect the database data dirs (see the Databases doc's
  credentials decision).

## Related files

- `apps/server/src/modules/backups/` — module, service, controller
- `apps/server/src/modules/backups/backup-driver.ts` — driver interface
- `apps/server/src/modules/backups/drivers/` — per-engine drivers
- `apps/server/src/modules/backups/paths.ts` — storage layout + naming
- `apps/server/src/modules/scheduler/` — `db_backup` task runner
- `apps/web/src/routes/backups/` — `/backups` page
- `apps/web/src/routes/databases/backups-tab-content.tsx` — drawer tab
- `apps/web/src/routes/databases/restore-backup-dialog.tsx` — restore confirm
