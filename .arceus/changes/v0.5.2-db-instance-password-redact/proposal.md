# v0.5.2 — Redact `dbInstance.password` from API responses

**Status:** draft (2026-05-27)
**Priority:** P0 — security blocker, must ship before v0.5.0 release
**Origin:** check-spec multi-agent review, Layer 2 Databases/Backups audit

## What broke

`DbInstancesService.toResponse()` packages the plaintext database
password into every `DbInstanceResponse` returned by the API:

```ts
// apps/server/src/modules/databases/db-instances.service.ts:519-534 (abridged)
private toResponse(row: DbInstance): DbInstanceResponse {
  return {
    id: row.id,
    name: row.name,
    engine: row.engine,
    imageTag: row.imageTag,
    hostPort: row.hostPort,
    status: row.status,
    password: row.password,        //  ← plaintext password in response
    rootUser: row.rootUser,
    createdAt: row.createdAt,
    // ...
  };
}
```

Every read path hits this:
- `GET /api/databases` — **lists every instance's password in one
  response**.
- `GET /api/databases/:id`.
- `POST /api/databases` (creation response).
- `PATCH /api/databases/:id`.
- `POST /api/databases/:id/rotate-password`.
- `POST /api/databases/:id/start|stop|restart` — these mutate state
  and then return the new instance shape, **with the password**.

## Why this is bigger than "plaintext password in DB"

The panel's `decisions.md Q3` consciously accepts plaintext-in-SQLite
for v0.4 (single-tenant, root-on-host posture — encrypting at rest
doesn't add real value when the panel server is already root). That
decision is defensible.

**But returning the password on every read** is a different question.
It widens the attack surface from "anyone with the SQLite file" to
"anyone with a panel JWT or a browser dev-tools window." Concretely:

- The frontend Databases list page calls `GET /api/databases` on
  every navigation — passwords cross the wire on every page load
  and sit in the React Query cache (browser memory + devtools
  Network tab) for 30s+.
- Anyone shoulder-surfing the operator's browser sees the password.
- Anyone who can read browser memory (a malicious extension, an XSS
  on the panel itself) reads every managed DB credential.
- The browser HTTP cache (if any layer caches the response) holds
  all passwords.

## Why the gap exists

The v0.4 spec wired `dbInstance.password` through the schema as
part of the data model and never explicitly considered the
plaintext-on-the-wire angle. The shared Zod schema
`@dinopanel/shared/schemas/databases` includes `password: z.string()`
in the response type; both ends silently honor it.

## Fix

Three-part:

**Part A — Schema split.** Define two types in
`packages/shared/src/schemas/databases.ts`:

- `DbInstanceResponse` (public, returned by list/get/mutations) —
  **no `password` field**.
- `DbInstanceRevealResponse` (returned only by the reveal endpoint
  below) — includes `{ password: string }` plus a freshness
  timestamp.

**Part B — Strip from `toResponse()`.** Remove `password` from the
serializer. Frontend updates: remove the field from the typed
expectation; pages that previously displayed it now show a
"Reveal" button.

**Part C — Add a dedicated reveal endpoint.**
`POST /api/databases/:id/reveal-password` — requires the *current
user's* password to be sent in the request body (re-auth), validates
it the same way as `changePassword` does, and on success returns
`{ password, revealedAt, expiresAt }`. The reveal is logged in the
audit log explicitly (action: `db_instance.password_reveal`,
target: instance id).

The reveal endpoint pattern is already familiar to operators — it
mirrors the way Cloudflare DNS-01 tokens (`/settings`) and the
ACME private keys are gated.

## Trade-off accepted

Listing the panel's own root credentials behind a re-auth step is a
small friction increase for the operator workflow. It is the
correct trade-off: a fresh re-auth is required precisely *because*
the value is sensitive enough to warrant the friction.

## Out of scope

- Encrypting the password at rest in SQLite — separate v0.6
  proposal already implicit in `decisions.md Q3` (`TODO(v0.5):
  encrypt via SecretsService`). This change does **not** solve
  the at-rest problem; it solves the at-wire / at-cache problem.
- Audit-log redaction depth (separate WARN-level concern).
