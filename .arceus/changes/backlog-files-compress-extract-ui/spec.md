# Spec — backlog-files-compress-extract-ui

## Acceptance criteria

### Backend

- `POST /api/files/compress` (new) accepts `{ paths: string[]; dest:
  string; format: 'zip' | 'tar.gz' }` (already in `compressSchema`).
  Compresses the inputs (files or directories) to a new archive
  file at `dest`. Returns `204 No Content` on success. Errors map
  through `mapFsError` (`EACCES`, `ENOENT`, `EEXIST`, `ENOSPC`,
  etc.) and `assertWritable` is enforced on `dest`.
- `POST /api/files/extract` (new) accepts `{ archive: string; dest:
  string }` (already in `extractSchema`). Detects archive format
  by `archive` filename extension:
  - `.zip` → use `unzipper` with **explicit zip-slip guard** —
    any entry whose resolved destination escapes `dest` is rejected
    with `FILE_ARCHIVE_TRAVERSAL` (400). No entries are written
    before this validation.
  - `.tar.gz`, `.tgz` → use `tar` package, `strict: true`.
  - `.tar` → use `tar` package, `strict: true`.
  - anything else → `FILE_UNSUPPORTED_ARCHIVE` (400).
  Returns `204 No Content` on success. Creates `dest` if it doesn't
  exist. `assertWritable` enforced on `dest`.
- Existing endpoints (`/list`, `/read`, `/write`, `/copy`,
  `/archive-download`, etc.) are not modified.

### Frontend

- File table gains a leading checkbox column. Header checkbox
  selects / deselects all rows. Selection clears when navigating to a
  different directory.
- Toolbar gains a `Compress selected` button, disabled when no rows
  are selected. Clicking opens a dialog:
  - Format radio: `zip` (default) or `tar.gz`.
  - Destination filename input — defaults to
    `archive.<ext>` in the current directory. Path-traversal is
    handled by the backend (`safePath` schema).
  - Confirm calls `POST /files/compress`, shows a loading state,
    refreshes the file list, and surfaces a success toast.
- Each archive row (extensions: `.zip`, `.tar.gz`, `.tgz`, `.tar`)
  gains an `Extract` entry in its action menu. Clicking opens a
  dialog:
  - Destination directory input, default = current directory +
    archive basename without compression extension.
  - Confirm calls `POST /files/extract`, loading state, refreshes
    the file list, success toast.
- All new user-facing strings have keys in both `zh-TW.json` and
  `en.json`.

### Tests

- New backend unit tests in
  `apps/server/src/modules/files/__tests__/files.service.test.ts`:
  1. `compressToDisk()` writes the expected archive file.
  2. `extract()` round-trips a tar.gz back to the same content.
  3. `extract()` rejects a `.zip` with a `../` traversal entry
     before writing anything.
  4. `extract()` returns `FILE_UNSUPPORTED_ARCHIVE` for an unknown
     extension.
- All 82 existing vitest cases stay green.
- Typecheck, lint (0 warnings), build all green.

### Out of scope

- Streaming progress for long compressions (UI shows a spinner; no
  progress percentage).
- Inline preview of archive contents before extraction.
- Adding compress / extract to the right-click menu (toolbar +
  action menu only).
- New e2e tests (Playwright). Backend coverage + manual smoke only.
