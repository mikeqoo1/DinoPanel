# Task Checklist — backlog-compose-discovered-stack-readonly

## Backend

- [x] Added `requireStackPath` + `requireComposeFilePath` helpers in
  `compose.service.ts`; both throw `ConflictException` with code
  `COMPOSE_FILE_UNAVAILABLE`. `readComposeFile`, `writeComposeFile`,
  and `validate` short-circuit before any `stat()` / `docker compose`
  invocation when `stack.path` is empty.
- [x] Collapsed the prior `COMPOSE_FILE_NOT_FOUND` 404 into the new
  `COMPOSE_FILE_UNAVAILABLE` 409 — single code for both
  "no recorded directory" and "no file in directory" states.

## Frontend

- [x] `compose-detail.tsx`: derives `isFileUnavailable` from
  `getApiErrorCode(fileError) === 'COMPOSE_FILE_UNAVAILABLE'` OR
  `(stack.source === 'discovered' && !stack.path)`. Renders a banner
  above the editor, passes `readOnly: isFileUnavailable` to Monaco,
  and threads the same flag into the `Toolbar` so Save + 驗證 are
  hidden while Up/Down/Restart/Pull stay visible.
- [x] Added `getApiErrorCode` helper to `apps/web/src/lib/api.ts`.
- [x] i18n keys `compose.readonly_banner.title|body` added to
  `apps/web/src/i18n/{en,zh-TW}.json`.

## Tests

- [x] Two new unit tests (CS-6 readComposeFile, CS-7 validate) assert
  `ConflictException` + `code: COMPOSE_FILE_UNAVAILABLE` for the
  empty-path case, and verify that `fs.stat` / `fs.readFile` /
  `cp.spawn` are never called.

## Verification

- [x] `pnpm typecheck` → 0 errors.
- [x] `pnpm lint` → 0 warnings.
- [x] `pnpm test` → **82 / 82 pass** (80 baseline + 2 new).
- [x] `pnpm build` → succeeds. Main bundle gzip 104.41 → 104.67 kB
  (+0.26); compose-detail chunk 34.05 → 34.20 kB (+0.15).
- [x] Manual smoke 2026-05-17 against `plane-app` on dev server:
  - `GET /api/compose/plane-app/file` → 409
    `COMPOSE_FILE_UNAVAILABLE` with clean message (no fs path leak).
  - `POST /api/compose/plane-app/validate` → same 409, no docker
    compose invocation.
  - UI: banner visible, Save/驗證 hidden, Up/Down/Restart/Pull
    visible, editor read-only (screenshot reviewed).

## Close-out

- [x] `meta.json.status` flipped to `completed`.
- [x] `.arceus/changes/README.md` index + next-session note updated.
