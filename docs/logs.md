# Logs

Aggregates five log sources behind `/api/logs/*` and surfaces them
at `/system/logs`. Added in v0.5.

## Sources

| Source | Backing | Endpoint | Pagination |
|---|---|---|---|
| System | `journalctl --no-pager -n <limit> -o short-iso` (optional `-g <grep>`) | `/api/logs/system` | top-N only |
| SSH | `journalctl --no-pager -u sshd -n <limit>` parsed for Accepted/Failed lines | `/api/logs/ssh` | top-N only |
| Operation | DB query on `operation_log` (written by `AuditInterceptor`) | `/api/logs/operation` | cursor on `created_at` |
| Login | DB query on `login_attempts` (written by `AuthService.login`) | `/api/logs/login` | cursor on `created_at` |
| Task | DB query on `scheduled_runs` | `/api/logs/tasks` | cursor on `started_at` |
| Website | **Not shipped in v0.5** | `/api/logs/website` returns 503 `FEATURE_PENDING` | — |

## Operation log (audit)

Every mutating REST request under `/api/*` (except `/api/auth/*`)
writes one row via `AuditInterceptor` (registered globally as an
`APP_INTERCEPTOR` in `app.module.ts`). Captured fields:

- `userId` — from `req.user` set by `JwtAuthGuard`; NULL for
  unauthenticated 401s
- `method`, `path` — `path` is the Fastify v5 `routeOptions.url`
  (route template, e.g. `/api/containers/:id/stop`), falling back
  to `request.url` when the route didn't match a handler
- `bodySummary` — JSON-stringified body with sensitive fields
  redacted (see below), capped at 1 KB with `[truncated]` marker
- `statusCode`, `durationMs`, `ip`, `userAgent`

### Redaction

`SENSITIVE_BODY_FIELDS` in
`apps/server/src/common/audit/sensitive-fields.ts` is the single
source of truth used by both:

- `AuditInterceptor.summarizeBody()` — iterates the list over the
  parsed body object before JSON.stringify
- `app.module.ts` pino redact paths — mapped to `req.body.<field>`
  form for fast-redact

Adding a new field to the constant updates both consumers.

### Coverage gap (design choice)

Handlers using `@Res({ passthrough: false })` bypass the NestJS
response pipeline, so the interceptor's `tap()` never fires. This
includes:

- `GET /api/files/download`
- `POST /api/files/archive-download`

These will not produce operation_log rows. The decision: these are
effectively reads even when their HTTP method is POST, and
audit-logging stream responses requires either monkey-patching the
Fastify reply or a separate middleware layer — both out of scope
for v0.5.

## Login log

`AuthService.login` writes a `login_attempts` row on every call:

| Outcome | `result` | `reason` |
|---|---|---|
| Wrong username | `fail` | `unknown_user` |
| Wrong password | `fail` | `bad_password` |
| Successful | `success` | NULL |

`ip` + `userAgent` come from the `meta` parameter passed by
`AuthController`. Failures to write the row are caught and logged
to pino with `auth.login_attempt_write_failed` — they never block
the login response.

## Retention

`operation_log` rows are deleted nightly at 03:15 by the built-in
scheduler task `system.purge_operation_log` (see
`docs/scheduler.md`). The retention day count is read from
`settings['audit.retentionDays']` at run time, default 30,
configurable 1–365 via:

- `PUT /api/audit/retention { days: number }`
- Settings page → "Operation log retention" card

Other log tables (`login_attempts`, `scheduled_runs`) currently
have **no retention** — they grow unboundedly. This is acceptable
for v0.5 because the row counts are dominated by `operation_log`
(every mutation writes one) and the other tables write at most a
few rows per minute under heavy use.

## REST contract summary

All endpoints require JWT auth.

```
GET /api/logs/system?limit=&grep=
GET /api/logs/ssh?limit=
GET /api/logs/operation?cursor=&limit=&userId=&path=&status=&from=&to=
GET /api/logs/login?cursor=&limit=&username=&result=
GET /api/logs/tasks?cursor=&limit=&taskId=
GET /api/logs/website  → 503 FEATURE_PENDING
```

Returns `{ items: T[], nextCursor: string | null }`. The
DB-backed sources support cursor pagination; the spawn-based
sources (system, ssh) return the top N entries from journalctl
and ignore cursor.

## WebSocket follow mode (deferred)

The spec called for `/ws/logs/system?follow=true` to stream
`journalctl --follow` output to the frontend. This is **not
implemented in v0.5** — Load more polling is adequate for the
current use cases. Adding it later means a single Gateway + xterm-
free virtualized list (the logs UI deliberately avoids xterm.js;
see `apps/web/src/routes/system/logs.tsx`).
