# Spec — v0.5.2 db-instance password redact

## Acceptance criteria

### Shared schema

- [ ] `packages/shared/src/schemas/databases.ts` defines
  `dbInstanceResponseSchema` **without** a `password` field.
- [ ] A new `dbInstanceRevealResponseSchema` includes
  `{ password: z.string(), revealedAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional() }`.
- [ ] Both schemas are re-exported from
  `packages/shared/src/schemas/index.ts`.

### Backend redaction

- [ ] `DbInstancesService.toResponse()` no longer includes
  `password` in its return value.
- [ ] All endpoints that previously returned a `DbInstanceResponse`
  continue to compile and return the redacted shape:
  `GET /databases`, `GET /databases/:id`, `POST /databases`,
  `PATCH /databases/:id`, `POST /databases/:id/start|stop|restart`,
  `POST /databases/:id/rotate-password`.
- [ ] `POST /databases/:id/rotate-password` does **not** return the
  new password in the response. The frontend must call the reveal
  endpoint afterwards if it needs to display the rotated value.

### Reveal endpoint

- [ ] New endpoint `POST /api/databases/:id/reveal-password` with
  body `{ currentPassword: string }`.
- [ ] Endpoint requires `JwtAuthGuard` AND validates
  `currentPassword` against the requesting user's bcrypt hash
  (reuse `UsersService.verifyPassword` or equivalent).
- [ ] On invalid `currentPassword`: HTTP 401 with code
  `AUTH_RE_VERIFY_FAILED`.
- [ ] On valid: returns `DbInstanceRevealResponse` shape.
- [ ] Rate limit: same as `/auth/login` (5/min per user — keyed by
  user id, not IP).
- [ ] Audit log: insert a row with `action='db_instance.password_reveal'`,
  `targetType='dbInstance'`, `targetId=<instance id>`, `actor=<user id>`.

### Frontend

- [ ] DB instance pages no longer assume `password` is on the
  response — typescript compile fails until they are updated.
- [ ] The instance drawer / detail view shows a "Reveal password"
  button instead of plain text.
- [ ] Clicking "Reveal" opens a re-auth modal that POSTs to the new
  endpoint and surfaces the password in a copyable field with a
  short visibility window (e.g., 30 s before it re-hides).
- [ ] i18n keys (en + zh-TW) added for the reveal flow.

### Migration / back-compat

- [ ] Frontend `useDatabases()` hooks updated to the new response
  shape. No old `data.password` reads remain in the codebase.
- [ ] No database schema change required (`dbInstances.password`
  column stays — it is the source of truth for what the panel
  passes to docker env vars / engine drivers).

### Verification

- [ ] `pnpm typecheck` green — TS errors on any remaining
  `data.password` access from a list/get response surface.
- [ ] `pnpm lint` / `pnpm test` / `pnpm build` all green.
- [ ] `curl -H "Authorization: Bearer $TOKEN" "$URL/api/databases" | jq '.[] | has("password")'`
  returns all `false`.
