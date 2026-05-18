# Scheduler

In-process cron-driven task runner added in v0.5. Sits behind
`/api/scheduler/*` (JWT-protected) and uses `node-cron@4` to fire
registered tasks in server local time. All persistence lives in the
`scheduled_tasks` + `scheduled_runs` SQLite tables.

## Task types

Five user-facing types are supported. Each implements `TaskRunner`
(`apps/server/src/modules/scheduler/task-runner.ts`) and returns a
`RunResult { exitCode, output, status: 'success' | 'failed' }`.
Output is capped at 64 KB with a `[truncated]` marker.

| Type | Payload | Notes |
|---|---|---|
| `shell` | `{ command: string }` | `/bin/sh -c <command>`, 5 min hard timeout via SIGKILL |
| `backup_files` | `{ sources: string[], targetDir: string }` | Delegates to `FilesService.compressToDisk()` — inherits `assertWritable` deny-list. Archive name: `backup-<iso>.tar.gz` |
| `clean_logs` | `{ path: string, olderThanDays: number }` | Path **must** start with `/var/log`, `/tmp`, `app.env.DATA_DIR`, or `~/dinopanel/logs` — rejected at create time with `CLEAN_LOGS_PATH_NOT_ALLOWED` |
| `restart_service` | `{ unit: string }` | `systemctl restart <unit>`; Zod regex `^[A-Za-z0-9_@-][A-Za-z0-9_@.-]*$` blocks `.` and `..` |
| `http_request` | `{ url, method, headers?, body? }` | `fetch()` with `AbortController` 30 s timeout; JSON content-type auto-set when body present |

Plus a built-in `purge` type, **hidden from the UI**, that powers
the audit-log retention dogfood (see below).

## Cron expressions

Validated via `cron-parser@5` at the controller boundary; invalid
strings return 400 `BAD_REQUEST`.

**Timezone: server local time.** No per-task timezone override.
The UI shows the resolved server offset next to each cron string so
operators don't get surprised when a daily 03:15 task runs at a
different wall-clock time than expected.

The frontend cron builder (`/system/scheduler` → Add Task) covers
five common modes — every-N-minutes, every-N-hours, daily HH:MM,
weekly on day-of-week, monthly on day-of-month — and emits the cron
string live. An "Advanced" toggle reveals a raw freeform input for
anything the builder can't express (e.g. `*/15 9-17 * * 1-5`).

## REST contract

All endpoints require a valid JWT in `Authorization: Bearer …`.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/scheduler/tasks` | Lists user-facing tasks. `?includeBuiltin=true` to also surface the purge task. |
| `POST` | `/api/scheduler/tasks` | Creates. Body matches `createScheduledTaskBodySchema`. Cron + per-type payload are validated server-side; on success the task is immediately registered with `node-cron`. |
| `PATCH` | `/api/scheduler/tasks/:id` | Edits. Built-in tasks reject with `TASK_BUILTIN_IMMUTABLE`. |
| `DELETE` | `/api/scheduler/tasks/:id` | Removes. Built-ins same as above. |
| `POST` | `/api/scheduler/tasks/:id/run` | Synchronously kicks off a run. Returns `{ runId }`. |
| `GET` | `/api/scheduler/tasks/:id/runs` | `?cursor=<startedAt>&limit=…` — paginated, ordered by `started_at DESC`. |

## Run lifecycle

1. `executeTask(taskId)` looks up the runner for the task type.
2. Inserts a `scheduled_runs` row with `status='running'`.
3. Invokes `runner.run(payload)`.
4. Updates the row with `status`, `exitCode`, `output`, `finishedAt`.

Server-restart recovery (`abortStaleRunningRuns`) runs at
`OnApplicationBootstrap` and marks any row left in `status='running'
AND finished_at IS NULL` as `aborted`, appending
`[aborted: server_restart]` to its output. This catches both crashes
and clean restarts mid-run.

## Built-in: audit-log purge

To dogfood the scheduler itself, v0.5 ships one built-in task:

| Name | `system.purge_operation_log` |
|---|---|
| Type | `purge` |
| Cron | `15 3 * * *` (daily 03:15 server local) |
| Action | `DELETE FROM operation_log WHERE created_at < now() - retentionDays * 86_400_000` |
| Retention | `settings['audit.retentionDays']`, default 30, configurable 1–365 via `PUT /api/audit/retention` or the Settings page card |
| Visibility | Hidden from the user-facing task list (filtered by `builtin = true` unless `?includeBuiltin=true`) |
| Mutability | Immutable — PATCH/DELETE return `TASK_BUILTIN_IMMUTABLE` |

`ensureBuiltins()` runs at boot and idempotently INSERTs this row
if it isn't already present.

## Out of scope for v0.5

- App-restart task type (no app store yet)
- Snapshot task type (no snapshot module)
- Database-backup task type (deferred to a future DB-module pass)
- Distributed scheduling across multiple panel nodes (the panel
  itself is single-host by design)
