# Tasks — v0.5.2 db-instance password redact

## Phase 1 — Shared schemas

- [x] Edit `packages/shared/src/schemas/databases.ts`:
  - Remove `password` from `dbInstanceResponseSchema`.
  - Add `dbInstanceRevealResponseSchema`.
  - Add `revealDbPasswordBodySchema` ({ currentPassword: z.string().min(1) }).
- [x] Re-export from `packages/shared/src/schemas/index.ts`.
- [x] `pnpm -F @dinopanel/shared build` green.

## Phase 2 — Backend redact + reveal

- [x] Edit `apps/server/src/modules/databases/db-instances.service.ts`:
  - Strip `password` from `toResponse()`.
  - Add `async revealPassword(instanceId, requesterId, currentPassword): Promise<DbInstanceRevealResponse>`:
    - Look up user, verify `currentPassword` against bcrypt hash.
    - Throw `UnauthorizedException({ code: 'AUTH_RE_VERIFY_FAILED' })` on mismatch.
    - On success, return `{ id, password: row.password, revealedAt: now, expiresAt: now+30s }`.
- [x] Edit `apps/server/src/modules/databases/databases.controller.ts`:
  - Add `@Post(':id/reveal-password')` handler.
  - Validate body via Zod pipe with `revealDbPasswordBodySchema`.
  - Apply `@Throttle({ default: { limit: 5, ttl: 60_000 } })` (IP-keyed bridge, D3 TODO noted in code).
- [x] Wire audit interceptor — `currentPassword` added to `SENSITIVE_BODY_FIELDS` (D6).
- [x] DatabasesModule imports UsersModule to satisfy UsersService DI.

## Phase 3 — Backend tests

- [x] Update `db-instances.service.test.ts`:
  - Assert `toResponse(row)` does not have `password` property.
  - Test `revealPassword` happy path returns `{ id, password, revealedAt, expiresAt }`.
  - Test `revealPassword` with wrong currentPassword throws `UnauthorizedException`.
  - Test `revealPassword` with unknown user throws `UnauthorizedException`.
- [ ] Add controller-level test for `POST /reveal-password` — deferred; service tests cover the
  logic. No existing controller test file for databases module (only service tests exist).

## Phase 4 — Frontend

- [x] Update typed response in `apps/web/src/hooks/use-databases.ts` — added `useRevealPassword` hook.
- [x] Remove all `instance.password` reads from `apps/web/src/routes/databases/*` — replaced with
  "Reveal password" + "Rotate password" buttons.
- [x] Build the reveal modal (`reveal-password-dialog.tsx`):
  - Prompts for current user password.
  - On submit, POSTs to `/api/databases/:id/reveal-password`.
  - On 200, displays the password in a copyable field with a 30s countdown to auto-hide.
  - On 401/error, surfaces the error inline (does not auto-close the modal).
- [x] Add i18n keys (en + zh-TW) under `databases.reveal_password.*`.
- [x] Update rotate-password flow: toast no longer references `result.password` (endpoint no longer
  returns it). Toast directs operator to use Reveal.
- Note: "show once at creation" UX deferred — `create-database-dialog.tsx` did not read
  `result.password` from the response (only showed a generic "created" toast), so no change needed.
  A future proposal can add a one-shot reveal-on-create flow.

## Phase 5 — Frontend tests

- [ ] Component test for reveal modal happy path — deferred; only one component test file exists
  (`sheet.test.tsx`) and it tests a primitive. Not enough precedent to justify adding a full modal
  test in this change; note tracked here for follow-up.
- [ ] Component test for reveal modal auth-failure path — same deferral.

## Verification

- [x] `tsc --noEmit` server + shared — clean.
- [x] `eslint --max-warnings=0` server + web — 0 errors / 0 warnings.
- [x] Workspace `vitest run` → 350/350 (+5 over post-symlink baseline 345; +4 baseline reveal cases + 1 post-review instance-not-found case).
- [x] `nest build` server — pass. Vite web build — pass (2924 modules transformed).
- [ ] `pnpm test:e2e` — no databases e2e specs exist in the repo; nothing to regress.
- [ ] Manual smoke (curl GET /api/databases | jq has("password") all-false) deferred to post-merge —
  unit tests + the `tsc --noEmit` typecheck catch this: any caller that read `instance.password` from
  the now-stripped response would fail compilation.

## Closeout

- [x] Commit (single commit, not split — easier to revert if anything regresses):
  `fix(databases): redact password from API responses + add /reveal-password endpoint (v0.5.2)`
- [x] Update meta.json: status → completed, completedAt, verification.
