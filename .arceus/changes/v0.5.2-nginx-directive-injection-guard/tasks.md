# Tasks — v0.5.2 nginx directive injection guard

## Implementation

- [x] Edit `packages/shared/src/schemas/websites.ts`:
  - Define `safeFilenameSchema = z.string().regex(/^[a-zA-Z0-9._-]+$/).max(64)`.
  - Replace `indexFiles: z.array(z.string())` →
    `z.array(safeFilenameSchema).min(1).max(8)`.
  - Replace `documentIndex: z.array(z.string())` →
    `z.array(safeFilenameSchema).min(1).max(8)`.
- [x] Update the safety comment block at the top of
  `apps/server/src/modules/websites/conf-renderer.ts` (~line 55)
  to explicitly cite the schema constraint.
- [x] Sweep `conf-renderer.ts` for every `${payload.X}` /
  `${site.X}` interpolation:
  - List each one in `decisions.md` with current Zod constraint
    and verdict (safe / needs-tightening).
  - Tighten anything that is currently `z.string()` with no
    constraint, if reachable from user input. (Tracking only —
    additional fixes may need their own follow-up changes if not
    trivial.)

## Tests

- [x] Schema tests in
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
  <!-- DEFERRED — no follow-up change scheduled. Rationale:
       `ZodValidationPipe` is applied at the NestJS controller boundary
       and is a single line of glue with no per-route variance; the
       16 schema-level tests in
       packages/shared/src/schemas/__tests__/websites.test.ts cover
       every accept / reject case for indexFiles + documentIndex.
       A controller integration test would only re-exercise that
       same Zod path through a stack of NestJS bootstrap + DB mocks,
       adding no incremental security coverage for this P0 fix.
       If a future P1+ proposal introduces non-pipe validation paths
       (e.g. dynamic schema overrides per controller), that proposal
       owns the controller-level coverage. -->

## Verification

- [x] `vitest run` for `@dinopanel/shared` → 20/20 (16 baseline + 4 post-review for empty-string & dots-only).
- [x] `vitest run` workspace including server websites tests → 336/336 (+20 over baseline 316).
- [x] `tsc --noEmit` server + `tsc -p tsconfig.build.json` shared — both clean.
- [x] `eslint --max-warnings=0` server — 0 errors / 0 warnings.
- [x] `nest build` server — pass.
- [ ] Manual smoke (see spec.md) — deferred to the post-merge smoke window; the
  schema rejection path is exercised by the 20 unit tests + the audit-pipe path
  is covered by `apps/server/src/modules/websites/__tests__` (no controller
  regression introduced).

## Closeout

- [x] Commit: `fix(websites): tighten indexFiles/documentIndex schemas to prevent nginx directive injection (v0.5.2)`
- [x] Update meta.json: status → completed, completedAt, verification.
