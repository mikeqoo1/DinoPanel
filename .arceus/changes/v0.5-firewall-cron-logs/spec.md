# v0.5 — Spec (draft)

References `proposal.md` for context, scope, and the four resolved
decisions (2026-05-18). This spec turns those into concrete files,
endpoints, and gates. Anything not listed here is out of scope.

## Verification gates

- `pnpm typecheck` — 0 errors
- `pnpm lint` — 0 errors, 0 warnings
- `pnpm test` — ≥ 37 new vitest cases on top of the current suite
  (≈ firewall driver 13, scheduler 10, audit-log filter 7, log
  parsers 7)
- `pnpm build` — main bundle gzip stays under 140 kB
  (≤ 10 kB additional headroom for the three new route chunks; each
  route ships its own lazy chunk)
- `pnpm exec playwright test` — ≥ 3 new e2e (firewall list +
  rollback timer countdown rendering, scheduled task create + run
  now, log tail filter)

## Acceptance criteria

### Backend

#### 1. Firewall (`apps/server/src/modules/firewall/`)

- `FirewallDriver` interface with two implementations:
  - `UfwDriver` — `ufw status numbered` parser, `ufw allow|deny`
    builder.
  - `FirewalldDriver` — `firewall-cmd --list-all --permanent` +
    `--add-rich-rule`.
  - `firewall.module.ts` detects the active backend at startup
    (`which ufw` vs `which firewall-cmd`); throws on neither.
- REST endpoints under `/api/firewall/*`, JWT-protected:
  - `GET  /api/firewall/status` — `{ backend, enabled }`
  - `POST /api/firewall/enable`, `POST /api/firewall/disable`
  - `GET  /api/firewall/rules` — joins kernel rules with metadata
    table (see §4); rows without metadata get `external: true`
  - `POST /api/firewall/rules/stage` — writes the rule, starts a
    30-second confirm window, returns `{ stagedId, expiresAt }`
  - `POST /api/firewall/rules/:stagedId/confirm` — commits
  - `POST /api/firewall/rules/:stagedId/cancel` — explicit revert
  - `DELETE /api/firewall/rules/:id` — remove a confirmed rule
- **Rollback safeguard (proposal §1)**:
  - In-memory `Map<stagedId, { rule, revertFn, timer }>`.
  - `expiresAt = now + 30_000` (proposal says "30 seconds to
    confirm"; the 60s budget in proposal covers staging + grace).
  - On timer fire OR cancel call, run `revertFn` (driver-specific
    `ufw delete`/`firewall-cmd --remove-rich-rule`) and drop the
    entry.
  - **Confirm endpoint flow** (must be atomic w.r.t. crash):
    1. Write `confirming_at = now` to `firewall_rule_meta`, flush
       to disk (better-sqlite3 is synchronous so the row is durable
       once the statement returns).
    2. Cancel the in-memory timer + remove from map.
    3. Write `confirmed_at = now`, return 200.
    If the server crashes between step 1 and step 3, the row has
    `confirming_at` set but `confirmed_at` NULL — the boot scan
    below preserves it.
  - **Server-restart recovery**: on boot, the in-memory map is
    empty but the kernel still has any staged rules. Startup hook
    scans `firewall_rule_meta` with the condition
    `confirmed_at IS NULL AND confirming_at IS NULL AND staged_at
    < now - 60s` and reverts each match via the driver. Rules with
    `confirming_at` set are left alone — they represent a confirm
    request that landed at the server (may or may not have replied
    before crash), and reverting them would silently invalidate
    work the user believes succeeded. After the sweep, rows with
    `confirming_at` set but `confirmed_at` NULL are promoted to
    `confirmed_at = confirming_at` so future queries treat them as
    normal confirmed rules.
- **Self-protect**: refuse rules that would deny the panel's bind
  port (from `app.env.PORT`, default 9999) or SSH (22 unless the
  user has set `app.env.SSH_PORT`). The endpoint returns 400 with
  code `FIREWALL_SELF_LOCKOUT` unless the request body contains
  `acknowledgeSelfLockout: true`.
- **Fail2Ban**: only registered if `which fail2ban-client` succeeds
  at module init. Endpoints `GET /api/firewall/fail2ban/banned`,
  `POST /api/firewall/fail2ban/unban`. Gate UI on `GET
  /api/firewall/status` returning `fail2ban: true`.

#### 2. Scheduler (`apps/server/src/modules/scheduler/`)

- `SchedulerService` — singleton, uses `node-cron` (MIT, ~6 kB to
  server deps, no client cost).
- **Timezone**: cron expressions fire in **server local time**
  (node-cron default). No per-task timezone override. The UI
  shows the resolved server offset next to each cron string so
  operators don't get surprised. Documented in `docs/scheduler.md`.
- 5 task types, each implemented as a class implementing
  `TaskRunner { type: string; run(payload): Promise<RunResult> }`:
  - `ShellTaskRunner` — `child_process.spawn`, captures stdout +
    stderr + exit code, 5-minute hard timeout.
  - `BackupFilesTaskRunner` — uses `FilesService.compressToDisk()`
    (added in v0.2.1, exported by `FilesModule`).
    `SchedulerModule` must declare `imports: [FilesModule]`.
    Source paths are absolute and subject to `FilesService`'s
    existing `assertWritable` deny-list.
  - `CleanLogsTaskRunner` — deletes files older than N days under
    a user-specified path. **The path MUST start with one of**:
    `/var/log/`, `/tmp/`, the configured `app.env.DATA_DIR` (panel
    state), or `~/dinopanel/logs/` (resolved against the panel
    user's home). Other prefixes are rejected at config time with
    `code: 'CLEAN_LOGS_PATH_NOT_ALLOWED'`. Implemented via
    `fs.readdir` + `fs.stat` + `fs.unlink` (no shell).
  - `RestartServiceTaskRunner` — `systemctl restart <unit>`.
    Allowlist regex: `^[A-Za-z0-9_@-][A-Za-z0-9_@.-]*$` (must not
    start with `.`, blocks both `.` and `..` as unit names without
    relying on systemd's downstream validation).
  - `HttpRequestTaskRunner` — `fetch()` with method, headers
    (JSON-stringified map), optional JSON body, 30-second
    timeout.
- REST endpoints under `/api/scheduler/*`, JWT-protected:
  - `GET    /api/scheduler/tasks` — list with `nextRunAt`
  - `POST   /api/scheduler/tasks` — create
  - `PATCH  /api/scheduler/tasks/:id` — edit cron / payload /
    enabled
  - `DELETE /api/scheduler/tasks/:id`
  - `POST   /api/scheduler/tasks/:id/run` — run-now
  - `GET    /api/scheduler/tasks/:id/runs?cursor=…` — paginated
    run log
- **Cron parsing**: validate with `cron-parser` (lightweight, no
  runtime) at the API boundary; reject 400 `BAD_REQUEST` on
  invalid expressions.
- **Persistence**: tasks survive restarts. On boot, load enabled
  tasks and schedule them; previously-running runs are marked
  `aborted` with reason `server_restart`.
- **Dogfood**: at boot, ensure a built-in task
  `system.purge_operation_log` exists (cron `15 3 * * *`, daily
  03:15) running an internal `purge` task type that DELETEs
  `operation_log WHERE created_at < now - retentionDays`.
  Retention pulled from `settings` key `audit.retentionDays`
  (default 30).

#### 3. Logs (`apps/server/src/modules/logs/`)

- One service per source, behind `LogsController` REST + WS:
  - `SystemLogReader` — spawns `journalctl --no-pager -n <limit>`
    (or tails `/var/log/syslog` fallback). `--follow` mode wired
    through `/ws/logs/system?follow=true`.
  - `SshLogReader` — `journalctl -u sshd -n <limit>` parsed for
    `Accepted`/`Failed` lines into `{ ts, status, user, ip }`.
  - `OperationLogReader` — DB query on `operation_log` with
    filter (user, path glob, status, time range), cursor pagination
    on `created_at + id`.
  - `LoginLogReader` — DB query on `sessions` joined with `users`,
    plus failed-login rows from a new `login_attempts` table that
    the existing auth module writes to (auth module gets a small
    patch — see §6).
  - `TaskLogReader` — DB query on `scheduler_runs` (see §4).
- REST endpoints:
  - `GET /api/logs/system?cursor=&follow=false&grep=…&limit=200`
  - `GET /api/logs/ssh?cursor=&filter=…`
  - `GET /api/logs/operation?cursor=&user=&path=&status=&from=&to=`
  - `GET /api/logs/login?cursor=&user=&result=`
  - `GET /api/logs/tasks?cursor=&taskId=&status=`
  - `GET /ws/logs/system?follow=true&grep=…` (system only; others
    don't need streaming)
- **NOT shipped**: `/api/logs/website` — controller returns 503
  with `code: 'FEATURE_PENDING'` and message
  `"Available after v0.3"`. Frontend renders this server message.

#### 4. Audit log middleware (`apps/server/src/common/audit/`)

- `AuditInterceptor` — global NestJS interceptor that, **for non-GET
  requests under `/api/*` excluding `/api/auth/*`**, writes a row
  to `operation_log` after the response.
- Captures:
  - `userId` (from `req.user`; NULL for unauthenticated 401s — we
    still log the attempt minus auth endpoints)
  - `method`, `path` — `path` is the route template, accessed via
    Fastify v5's `request.routeOptions.url` (NOT `routerPath`,
    which was removed in v5). Fallback to `request.url` if
    `routeOptions.url` is `undefined` (404s, raw HTTP without a
    matched route).
  - `bodySummary` — JSON-stringified body with sensitive fields
    redacted, length cap 1 KB. Redaction is keyed off a new
    shared constant `SENSITIVE_BODY_FIELDS = ['password',
    'oldPassword', 'newPassword', 'refreshToken']` exported from
    `apps/server/src/common/audit/sensitive-fields.ts`. The same
    constant feeds `app.module.ts`'s pino `redact.paths` (mapped
    to `req.body.<field>` form there). One list, two consumers —
    keeps the two redact policies from drifting apart.
  - `statusCode`
  - `durationMs`
  - `ip`, `userAgent`
- **Coverage gap (design choice)**: handlers using
  `@Res({ passthrough: false })` bypass NestJS's response
  pipeline, so the interceptor's `tap()` never fires. This
  includes the existing `/api/files/download` and
  `/api/files/archive-download` endpoints. These will not appear
  in `operation_log`. Acceptable for v0.5 — they're effectively
  reads even when method is POST. Document in
  `docs/logs.md` to pre-empt the "missing audit row" bug report.
- Failures to write the audit row MUST NOT fail the response — log
  to pino with `audit.write_failed` and move on.

### Database schema additions (`apps/server/src/database/schema.ts`)

```ts
export const firewallRuleMeta = sqliteTable('firewall_rule_meta', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  port: integer('port').notNull(),
  proto: text('proto', { enum: ['tcp', 'udp', 'any'] }).notNull(),
  source: text('source'), // null = anywhere
  action: text('action', { enum: ['allow', 'deny'] }).notNull(),
  comment: text('comment'),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: integer('created_at').notNull().$defaultFn(() => Date.now()),
  stagedAt: integer('staged_at'),         // set during 30s window
  confirmingAt: integer('confirming_at'), // set on confirm endpoint entry (crash-safety guard)
  confirmedAt: integer('confirmed_at'),   // set after confirm endpoint completes
});

export const scheduledTasks = sqliteTable('scheduled_tasks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  type: text('type', {
    enum: ['shell', 'backup_files', 'clean_logs', 'restart_service',
           'http_request', 'purge'],
  }).notNull(),
  cron: text('cron').notNull(),
  payload: text('payload', { mode: 'json' }).notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  builtin: integer('builtin', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull().$defaultFn(() => Date.now()),
});

export const scheduledRuns = sqliteTable('scheduled_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  taskId: integer('task_id').notNull()
    .references(() => scheduledTasks.id, { onDelete: 'cascade' }),
  startedAt: integer('started_at').notNull(),
  finishedAt: integer('finished_at'),
  status: text('status', {
    enum: ['running', 'success', 'failed', 'aborted'],
  }).notNull(),
  exitCode: integer('exit_code'),
  output: text('output'), // capped at 64 KB; oversize → "[truncated]"
}, (t) => ({
  taskIdx: index('idx_scheduled_runs_task').on(t.taskId),
  startedIdx: index('idx_scheduled_runs_started').on(t.startedAt),
}));

export const operationLog = sqliteTable('operation_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').references(() => users.id),
  method: text('method').notNull(),
  path: text('path').notNull(),
  bodySummary: text('body_summary'),
  statusCode: integer('status_code').notNull(),
  durationMs: integer('duration_ms').notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: integer('created_at').notNull().$defaultFn(() => Date.now()),
}, (t) => ({
  createdIdx: index('idx_operation_log_created').on(t.createdAt),
  userIdx: index('idx_operation_log_user').on(t.userId),
  pathIdx: index('idx_operation_log_path').on(t.path),
}));

export const loginAttempts = sqliteTable('login_attempts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull(),
  result: text('result', { enum: ['success', 'fail'] }).notNull(),
  reason: text('reason'), // 'bad_password', 'unknown_user', 'locked'
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: integer('created_at').notNull().$defaultFn(() => Date.now()),
}, (t) => ({
  createdIdx: index('idx_login_attempts_created').on(t.createdAt),
  usernameIdx: index('idx_login_attempts_username').on(t.username),
}));
```

A migration file in `apps/server/src/database/migrate.ts` adds these
tables idempotently (current pattern).

### Frontend (`apps/web/src/routes/`)

**There is no existing `/system` route yet** — the System info we
have today lives as widgets inside `dashboard.tsx` (`useSystemInfo`
hook, backed by `SystemModule`'s service). v0.5 introduces a new
top-level `/system` route as the operational-posture container,
hosting four tabs. Tab structure:

```
/system            ← NEW route, Tabs container
  ├─ /system           (Overview tab — see below)
  ├─ /system/firewall  (new)
  ├─ /system/scheduler (new)
  └─ /system/logs      (new)
```

- **New file**: `routes/system/index.tsx` hosts `<Tabs>` from
  shadcn/ui with four entries. Each non-overview tab is a
  `React.lazy(() => import('./system/<name>'))` chunk so the
  default Overview load doesn't pay for firewall/scheduler/logs.
- **New file**: `routes/system/overview.tsx` — Overview tab.
  Consumes the existing `useSystemInfo` hook (currently used by
  `dashboard.tsx`) and renders OS / uptime / load / services
  status. The dashboard widget stays for now; deciding whether to
  deprecate the dashboard copy in favor of `/system` is left to a
  v0.5 polish task (Phase 5) once we can see the new page in
  context.
- **Wiring**: `App.tsx` gains a `/system/*` route (lazy), and the
  sidebar gains a 系統 / System entry (icon: `Settings2` or
  similar from `lucide-react`, slotted after `總覽 / Dashboard`
  and before `容器 / Containers`).
- **Firewall tab** (`routes/system/firewall.tsx`):
  - Toggle row for enabled state.
  - Rules table with action / port / proto / source / comment /
    creator / external badge.
  - "Add rule" `<Dialog>` collecting allow/deny + port + proto +
    source + comment + self-lockout checkbox (only shown when the
    rule matches the panel port or SSH port).
  - **Rollback modal**: on stage success, opens a modal
    `<AlertDialog>` with a visible 30-second countdown
    (`useEffect` + `setInterval`). Buttons: "確認保留" (POST
    confirm) / "立即撤銷" (POST cancel). If the countdown hits 0
    and no action, the modal auto-closes and the rule list
    refetches (server already reverted).
- **Scheduler tab** (`routes/system/scheduler.tsx`):
  - Task list with name / type / cron (human-readable + raw on
    hover) / next run / last status / enabled toggle.
  - "Add task" `<Dialog>`:
    - Type select (5 user-facing types; `purge` is hidden — it's
      the built-in dogfood).
    - Type-specific payload form (shell command textarea, backup
      path picker reusing files-module file picker, etc.).
    - **Cron input**: builder by default with mode select
      (`every-N-minutes` / `every-N-hours` / `daily-at` /
      `weekly-on` / `monthly-on`) + numeric/time inputs; live
      preview of generated cron string. "Advanced" toggle reveals
      a raw text input that takes over (builder disabled).
  - "Run now" button per task; row expands to show last 5 runs.
- **Logs tab** (`routes/system/logs.tsx`):
  - Inner sub-tabs: 系統 / SSH / 操作 / 登入 / 任務 / 網站(待 v0.3).
  - Shared list view: filter bar (grep / user / status / time
    range — fields differ per source), cursor pagination
    (`Load more`), follow toggle (system only).
  - Render lines into a plain virtualized `<div>` list (e.g.
    `react-virtuoso` if already in deps; otherwise a hand-rolled
    windowed list). **Do NOT reuse the container-log viewer** —
    that is xterm.js-based and would drag ~72 kB gzip of terminal
    code into the logs chunk for no benefit (these logs are
    structured rows, not ANSI streams). The only thing worth
    borrowing from container logs is the WS subscribe hook
    pattern.
- i18n keys (zh-TW + en) for all new copy, mirroring existing
  conventions.

### Shared schemas (`packages/shared/src/schemas/`)

- New files: `firewall.ts`, `scheduler.ts`, `logs.ts`.
- Re-export from `index.ts`.
- Zod schemas mirror the DB rows + the request/response payloads
  listed above. Types inferred via `z.infer<>`.

### Auth module patch (`apps/server/src/modules/auth/`)

- `AuthService.login` writes one row to `login_attempts` per call:
  result + reason on failure, IP + UA from request. No new
  endpoint; this is purely a side-effect to feed §3 LoginLogReader.

## Tests

### Unit (vitest)

- **Firewall driver**: 13 cases
  - UfwDriver: parse `status numbered` golden output (≥ 3 row
    shapes including IPv6, port-range), build `allow`/`deny`
    commands, error mapping (not installed, permission denied).
  - FirewalldDriver: parse `--list-all` golden output, build
    rich-rule string, error mapping.
  - Detection: throws on neither installed.
  - **Confirm-flight crash race**: stage a rule, simulate
    confirm-handler crash after writing `confirming_at` but before
    `confirmed_at`; boot scan preserves the row (does NOT revert)
    and promotes `confirming_at` → `confirmed_at`.
- **Scheduler**: 10 cases
  - Cron parse / next-fire computation.
  - Each TaskRunner: happy-path mocked, timeout path, error path.
  - Server-restart reload: enabled tasks rescheduled, running
    runs marked `aborted`.
  - Self-protect: rejects rules matching panel/ssh port without
    ack.
- **Audit interceptor**: 7 cases
  - Non-GET writes a row; GET does not; `/api/auth/*` skipped.
  - Body redaction works for every field in
    `SENSITIVE_BODY_FIELDS` (`password`, `oldPassword`,
    `newPassword`, `refreshToken`).
  - Path uses `request.routeOptions.url` when set, falls back to
    `request.url` when not (404 case).
  - Body summary length cap (1 KB) truncates with `[truncated]`.
  - Write failure does not fail the response.
- **Log parsers**: 7 cases
  - SSH `Accepted`/`Failed` line parsing including IPv6.
  - System log empty / very large line handling.
  - Operation/Login/Task DB queries paginate by composite cursor.

### e2e (playwright)

- `e2e/firewall.spec.ts` — list renders, "Add rule" dialog stages
  a rule, countdown modal shows, click confirm, rule appears as
  confirmed. (Run gated on `process.env.DINOPANEL_E2E_FIREWALL ===
  '1'` because most CI sandboxes lack ufw.)
- `e2e/scheduler.spec.ts` — create a `shell` task (`echo hi`),
  click "Run now", run log shows success + output.
- `e2e/logs.spec.ts` — operation tab shows a row matching the
  POST that created the scheduler task above (cross-test
  validation that the audit interceptor is live).

## Out of scope (deferred to a later cycle)

- iptables direct manipulation.
- Multi-host firewall sync.
- ELK / Loki shipping.
- Website log subview (v0.3 prerequisite).
- Backup / app-restart / snapshot task types (no underlying
  feature yet).
- Configurable audit redact list (hard-coded for v0.5).
- Custom dashboard widgets over scheduled-run metrics.

## Estimate

Backend ≈ 9 dev-days, frontend ≈ 6 dev-days, tests + polish ≈ 2
dev-days → ~ 3.5 weeks single-developer at the project's typical
pace. Matches proposal sizing.
