# Spec — v0.5.2 nginx directive injection guard

## Acceptance criteria

### Schema

- [ ] `packages/shared/src/schemas/websites.ts` defines a shared
  `safeFilenameSchema = z.string().regex(/^[a-zA-Z0-9._-]+$/)`
  with a `.max(64)` length cap.
- [ ] `staticSitePayloadSchema.indexFiles` uses
  `z.array(safeFilenameSchema).min(1).max(8)`.
- [ ] `phpPayloadSchema.documentIndex` uses the same.
- [ ] Both schemas continue to validate the rest of their payload
  unchanged.

### Backend behaviour

- [ ] `POST /api/websites` with `indexFiles: ["index.html; include /etc/passwd;"]`
  returns HTTP 400 with a Zod validation error pinpointing the
  offending array index and the regex constraint.
- [ ] `POST /api/websites` with `indexFiles: ["index.html"]` (or any
  valid value) succeeds and writes the expected conf.
- [ ] `POST /api/websites` with `indexFiles: []` (empty) returns 400.
- [ ] `POST /api/websites` with `indexFiles` array of length 9 returns
  400.
- [ ] `POST /api/websites` with `indexFiles: ["index.html", "../../etc/passwd"]`
  returns 400 — the `/` and `.` rule rejects path traversal in a
  filename slot.

### Conf renderer comment update

- [ ] `apps/server/src/modules/websites/conf-renderer.ts` line ~55
  comment is updated to read approximately:
  > The renderer assumes its inputs have been validated by the
  > shared Zod schemas at the controller boundary. Specifically:
  > `indexFiles` and `documentIndex` items match
  > `^[a-zA-Z0-9._-]+$` and cannot contain whitespace, semicolons,
  > or directive separators. Any new field added here must have an
  > equally tight schema or be quoted before interpolation.

### Audit of other interpolations

- [ ] `decisions.md` captures the result of sweeping
  `conf-renderer.ts` for any other unchecked interpolation. Each
  interpolated payload field appears in the decision doc with its
  current validation status (PASS / WARN / fix-in-this-change).

### Tests

- [ ] Schema-level unit test for each acceptance criterion above
  (valid / empty / over-length / regex-fail cases) in
  `packages/shared/src/schemas/__tests__/websites.test.ts`.
- [ ] Integration test: POST with malicious `indexFiles` returns
  400 + Zod error shape (in
  `apps/server/src/modules/websites/__tests__/`).

### Verification

- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build`
  all green.
- [ ] Manual smoke:
  ```bash
  curl -X POST -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d '{"name":"x","domain":"x.example","payload":{"type":"static","indexFiles":["index.html; whatever;"],"rootDir":"/tmp/x"}}' \
    "http://localhost:3000/api/websites"
  # expect: HTTP 400, Zod error pointing at indexFiles.0
  ```
