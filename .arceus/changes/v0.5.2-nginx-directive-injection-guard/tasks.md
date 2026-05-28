# Tasks — v0.5.2 nginx directive injection guard

## Implementation

- [ ] Edit `packages/shared/src/schemas/websites.ts`:
  - Define `safeFilenameSchema = z.string().regex(/^[a-zA-Z0-9._-]+$/).max(64)`.
  - Replace `indexFiles: z.array(z.string())` →
    `z.array(safeFilenameSchema).min(1).max(8)`.
  - Replace `documentIndex: z.array(z.string())` →
    `z.array(safeFilenameSchema).min(1).max(8)`.
- [ ] Update the safety comment block at the top of
  `apps/server/src/modules/websites/conf-renderer.ts` (~line 55)
  to explicitly cite the schema constraint.
- [ ] Sweep `conf-renderer.ts` for every `${payload.X}` /
  `${site.X}` interpolation:
  - List each one in `decisions.md` with current Zod constraint
    and verdict (safe / needs-tightening).
  - Tighten anything that is currently `z.string()` with no
    constraint, if reachable from user input. (Tracking only —
    additional fixes may need their own follow-up changes if not
    trivial.)

## Tests

- [ ] Schema tests in
  `packages/shared/src/schemas/__tests__/websites.test.ts`:
  - `indexFiles: ['index.html']` passes.
  - `indexFiles: ['index.html', 'home.htm']` passes.
  - `indexFiles: []` fails (empty array).
  - `indexFiles: array of 9 items` fails (max).
  - `indexFiles: ['index.html; whatever']` fails (regex).
  - `indexFiles: ['../etc/passwd']` fails (regex).
  - `indexFiles: ['file with space']` fails (regex).
  - `indexFiles: ['file.with.dots.allowed']` passes.
  - Same matrix for `documentIndex`.
- [ ] Controller integration test: POST /api/websites with
  malicious `indexFiles` returns HTTP 400 + Zod-shaped error.

## Verification

- [ ] `pnpm -F @dinopanel/shared test` green.
- [ ] `pnpm -F @dinopanel/server test --filter websites` green.
- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm build` all green.
- [ ] Manual smoke (see spec.md).

## Closeout

- [ ] Commit: `fix(websites): tighten indexFiles/documentIndex schemas to prevent nginx directive injection (v0.5.2)`
- [ ] Update meta.json: status → completed, completedAt, verification.
