# Tasks — v0.5.2 db-instance password redact

## Phase 1 — Shared schemas

- [ ] Edit `packages/shared/src/schemas/databases.ts`:
  - Remove `password` from `dbInstanceResponseSchema`.
  - Add `dbInstanceRevealResponseSchema`.
  - Add `revealDbPasswordBodySchema` ({ currentPassword: z.string().min(1) }).
- [ ] Re-export from `packages/shared/src/schemas/index.ts`.
- [ ] `pnpm -F @dinopanel/shared build` green.

## Phase 2 — Backend redact + reveal

- [ ] Edit `apps/server/src/modules/databases/db-instances.service.ts`:
  - Strip `password` from `toResponse()`.
  - Add `async revealPassword(instanceId: string, requesterId: string, currentPassword: string): Promise<DbInstanceRevealResponse>`:
    - Look up user, verify `currentPassword` against bcrypt hash.
    - Throw `UnauthorizedException({ code: 'AUTH_RE_VERIFY_FAILED' })` on mismatch.
    - On success, return `{ password: row.password, revealedAt: now, expiresAt: now+30s }`.
- [ ] Edit `apps/server/src/modules/databases/databases.controller.ts`:
  - Add `@Post(':id/reveal-password')` handler.
  - Validate body via Zod pipe with `revealDbPasswordBodySchema`.
  - Apply `@Throttle(5, 60)` (5/min per user) — implement custom
    tracker that keys on user id, not IP.
- [ ] Wire audit interceptor — verify the action is captured. Ensure
  `currentPassword` is in the `redactSensitiveFields` list so it
  never lands in the audit body summary.

## Phase 3 — Backend tests

- [ ] Update `db-instances.service.test.ts`:
  - Assert `toResponse(row).password === undefined`.
  - Test `revealPassword` happy path returns `{ password, revealedAt, expiresAt }`.
  - Test `revealPassword` with wrong currentPassword throws
    `UnauthorizedException`.
- [ ] Add controller-level test for `POST /reveal-password`:
  - Returns 401 with code `AUTH_RE_VERIFY_FAILED` on bad password.
  - Returns 200 with the expected shape on good password.
  - Audit row is written.

## Phase 4 — Frontend

- [ ] Update typed response in `apps/web/src/hooks/use-databases.ts`
  (and any other consumer) to the new shape.
- [ ] Remove all `instance.password` reads from
  `apps/web/src/routes/databases/*` — replace with a "Reveal" button.
- [ ] Build the reveal modal:
  - Prompts for current user password.
  - On submit, POSTs to `/api/databases/:id/reveal-password`.
  - On 200, displays the password in a copyable field with a
    countdown to auto-hide.
  - On 401, surfaces the error inline (do not auto-close the modal).
- [ ] Add i18n keys (en + zh-TW) under `databases.reveal_password.*`.
- [ ] Update rotate-password flow: after rotating, the response no
  longer carries the password; the UI should automatically open
  the reveal modal if the operator wants to see the new value.

## Phase 5 — Frontend tests

- [ ] Component test for reveal modal happy path.
- [ ] Component test for reveal modal auth-failure path.

## Verification

- [ ] `pnpm typecheck` green.
- [ ] `pnpm lint` green.
- [ ] `pnpm test` green.
- [ ] `pnpm build` green.
- [ ] `pnpm test:e2e` — at minimum, the existing databases e2e
  specs (where present) still pass; ideally add one e2e for the
  reveal flow.
- [ ] Manual smoke: `curl ... GET /api/databases | jq '.[] | has("password")'`
  → all false.

## Closeout

- [ ] Commit (suggested split):
  - `feat(shared): split dbInstanceResponse into redacted + reveal (v0.5.2)`
  - `feat(databases): add /reveal-password endpoint with re-auth (v0.5.2)`
  - `fix(databases): remove password from toResponse() (v0.5.2)`
  - `feat(web): reveal-password modal + remove direct password reads (v0.5.2)`
- [ ] Update meta.json: status → completed, completedAt, verification.
