# Spec — backlog-compose-discovered-stack-readonly

## Acceptance criteria

### Backend

- `GET /api/compose/:key/file` on a stack whose `path` is empty (or
  whose resolved compose file does not exist) returns **409 Conflict**
  with body `{ code: "COMPOSE_FILE_UNAVAILABLE", message: <human> }`.
  *(Previously: 404 `COMPOSE_FILE_NOT_FOUND` with stat-derived message,
  or a fs `ENOENT` leaking through `docker compose config` stderr when
  the user hit Validate.)*
- `PUT /api/compose/:key/file` on the same stack returns the same 409.
- `POST /api/compose/:key/validate` on the same stack returns the same
  409 — it must not invoke `docker compose -f compose.yml config` with
  an empty stack.path (the previous behaviour leaked an absolute server
  cwd path).
- Action endpoints (`POST /api/compose/:key/action` for
  `up`/`down`/`restart`/`pull`) **remain enabled** — they use the
  docker engine and do not require a file on disk.

### Frontend

- The Compose detail page detects "no editable file" via either:
  - `stack.source === 'discovered'` **and** `stack.path === ''`, or
  - the file-load request returns the new `COMPOSE_FILE_UNAVAILABLE`
    code (defensive — covers registered-stack-with-missing-file too).
- When detected:
  - An info banner is rendered above the editor explaining
    why the file is unavailable and that actions still work. i18n
    keys: `compose.readonly_banner.title`, `compose.readonly_banner.body`
    for zh-TW and en.
  - The Monaco editor is rendered in `readOnly: true` mode.
  - The **Save** and **驗證 / Validate** buttons are hidden.
  - The **Up / Down / Restart / Pull** action buttons stay visible
    and enabled (no regression on existing behaviour).

### Tests

- Backend: at least two new unit tests in `compose.service.test.ts` —
  one for `readComposeFile` and one for `validate` — asserting the
  empty-path case throws `ConflictException` with code
  `COMPOSE_FILE_UNAVAILABLE`.
- All existing 80 vitest cases stay green.
- Typecheck, lint (0 warnings), build all green.
- Existing 5 baseline Playwright tests stay green; no new e2e required
  (UI surface is small and already exercised by visual smoke).

### Out of scope

- Reconstructing a synthetic compose.yml from `docker inspect`.
- Importing a discovered stack into the managed registry (separate
  feature).
- Hiding discovered stacks from the Compose list.
