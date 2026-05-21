# Decisions — v0.5 database backups

Six load-bearing decisions resolved at activation. Each has the
operator's product preference + the engineering trade-off.

## D1 (Q1) — Logical (dump-style) backups, not physical

**Decision:** Use per-engine logical dump commands
(`mysqldump` / `pg_dumpall` / `mongodump` / `redis SAVE+RDB copy`).
**Reject** physical / file-level backups (mariabackup, pg_basebackup,
LVM snapshots).

**Why:**
- Logical dumps work across engine minor versions (mysql 8.0 → 8.4
  upgrade with restore-from-dump just works; physical can refuse).
- Smaller surface area — no LVM coordination, no docker volume
  freeze, no engine-internal hot-backup protocol per engine.
- Disadvantage (size + speed) is acceptable for the panel's target
  scale: dev/staging/small-prod DBs measured in GBs, not TBs.
- Operators who genuinely need physical can already use
  `docker volume snapshot` + a cron — that's a five-line escape
  hatch, not a missing module.

**Re-evaluate:** if any operator surfaces a TB-scale managed DB
where logical dumps don't fit. None today.

## D2 (Q2) — Local file storage only

**Decision:** Backups land at
`/opt/dinopanel/backups/<engine>/<instance>/<timestamp>.<ext>.gz`
on the panel host. No S3, no MinIO, no remote target in v0.5.0.

**Why:**
- v0.4 establishes `/opt/dinopanel/` as DinoPanel's owned root —
  backups join `sites/` and `databases/` under the same hierarchy.
- Remote storage adds: credentials UI, SDK dependency
  (aws-sdk-v3 ~2 MB), partial-upload retry semantics, network
  failure surfaces. None warranted before basic backups exist.
- Local backups colocated with the DB host are the lower-bound
  durable copy — fine for "before a migration" / "in case I broke
  prod" use cases.

**Re-evaluate:** v0.5.x can add a remote-target adapter (S3 / SFTP).
The schema already records `file_path` so a future migration to
remote URIs is non-breaking.

## D3 (Q3) — Schedule via existing scheduler module, new `db_backup` task type

**Decision:** Reuse the v0.5-firewall-cron-logs scheduler module
(6 existing task types per `project_status_v05_shipped` memory).
Add a 7th type `db_backup`. Task params: `{ instanceId,
retentionGroup, keepLastN, cron }`.

**Why:**
- Scheduler already has: cron-parser, node-cron runner,
  task_log surfacing, `/scheduler` UI, error handling.
- Reinventing any of that for a backups-only scheduler is wrong.
- UI lives where operators expect it — same dialog they use for
  other scheduled tasks.

**Re-evaluate:** none — this is the clear right answer.

## D4 (Q4) — Restore-in-place, not restore-to-new-instance

**Decision:** Restore drops + recreates the target DB **inside the
existing container** (same volume, same credentials, same port).
No new-container creation as part of restore.

**Why:**
- Restore-to-new = "clone DB", which is a distinct UX (operator
  picks new name, new port, optionally new image tag). Conflating
  the two would mean operator hits restore expecting recovery and
  silently gets a duplicate.
- Recovery is the primary use case ("I broke prod, give me last
  night's data"). Restore-in-place is what that maps to.
- Clone-DB is a real v0.6 candidate, on a separate roadmap row.

**Re-evaluate:** when v0.6 ships clone — at that point restore +
clone share underlying primitives but diverge in UX.

## D5 (Q5) — Keep-last-N retention, default 7

**Decision:** Each `(instance_id, retention_group)` keeps the last
N backups, configured per scheduled task. Default N=7. Pruning runs
synchronously at end of every successful backup-create, dropping
oldest file + DB row first.

**Why:**
- Simpler mental model than days-based ("keep 7 latest" vs "keep
  backups newer than 7 days" — the latter is ambiguous when
  schedules change).
- Predictable disk footprint — operator knows max N files × max
  size.
- One-off / manual backups are exempt (`retention_group=null`),
  so operators can pin a known-good before a risky change.

**Re-evaluate:** days-based retention can ship in v0.5.x as a
parallel option. Schema reserves room
(`retention_policy: 'count' | 'days'`).

## D6 (Q6) — Docker exec stdout pipe + host gzip

**Decision:** Backup writes go: `docker exec <container> <dumpCmd>` →
NodeJS stream → `zlib.createGzip()` → host file. No in-container
tmpfile, no bind-mounted intermediate directory.

**Why:**
- Single code path across all 5 engines (just the `dumpCmd` differs).
- No container-side disk pressure during backup — the dump
  streams out as it's generated.
- Restore mirrors: host file → gunzip stream → `docker exec -i`
  stdin → restore command.
- Exception: `mongodump --archive --gzip` produces a gzipped
  archive natively, so we skip the host gzip step for Mongo
  (driver flag `alreadyGzipped: true`).

**Re-evaluate:** none — clean and uniform.

## Non-decisions worth recording

- **Encryption-at-rest for backup files:** out of scope. v0.5
  inherits v0.4's plaintext stance per `v0.4-databases/decisions.md`
  Q3 — root-only file perms (0600), panel admin = OS admin.
- **Backup of DinoPanel's own SQLite:** out of scope of this
  module. The panel DB is small (config + audit log) and falls
  under "back up `/opt/dinopanel/` directory" rather than per-DB
  module work.
- **Cross-host backup target (rsync to another machine):** out of
  scope. Operator can `rsync` `/opt/dinopanel/backups/` to anywhere
  via a separate `db_backup`-completion script hook in a later
  release if desired.
