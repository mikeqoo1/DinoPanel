# Task Checklist — backlog-files-compress-extract-ui

## Backend

- [x] Added `tar` (^7.5.x) and `unzipper` (^0.12.x) + `@types/unzipper`
  to `apps/server/package.json`. (`tar` ships its own types.)
- [x] `FilesService.compressToDisk(paths, dest, format)` —
  reuses `archiver`, pipes to `createWriteStream(dest)` via
  `pipeline()`, `assertWritable(dest)`, fs errors mapped.
- [x] `FilesService.extract(archive, dest)` —
  classifies by extension; `.tar*` → `tar.x({strict: true})`;
  `.zip` → `unzipper.Open.file` + an **explicit pre-write guard**
  that rejects any entry whose `resolve(dest, entry.path)` does
  not equal `dest` and does not start with `dest + path.sep`;
  unknown extension → 400 `FILE_UNSUPPORTED_ARCHIVE`.
- [x] Controller: `POST /files/compress` (204) and
  `POST /files/extract` (204) wired to the existing schemas.

## Frontend

- [x] Multi-select via `Set<string>` of paths in `files.tsx`.
  Header + per-row `<input type="checkbox">`. Selection clears on
  directory navigate.
- [x] Toolbar `Compress (N)` button — disabled when N = 0. Dialog
  with format radio (zip / tar.gz) and dest path input
  (defaulting to `archive.{ext}` in the current directory).
  Inline `api.post('/files/compress')` call; loading state +
  list refresh + success toast.
- [x] `Extract` icon (lucide `PackageOpen`) on rows whose name
  matches `/\.(zip|tar\.gz|tgz|tar)$/i`. Dialog with dest dir
  input (default: current dir + archive basename minus the
  archive extension). Inline `api.post('/files/extract')` call;
  loading state + list refresh + success toast.

## i18n

- [x] `files.actions.{compress_selected,extract}` +
  `files.compress.{title,selected_count,format_label,dest_label,
  in_progress,success_toast}` +
  `files.extract.{title,dest_label,in_progress,success_toast}`
  in zh-TW + en.

## Tests

- [x] 8 new integration tests in `files.archive.test.ts`
  (real fs under tmpdir, `vi.spyOn(unzipper.Open, 'file')` for
  malicious-zip cases since `archiver` normalises entry paths):
  - AR-1, AR-2: compressToDisk writes tar.gz / zip on disk.
  - AR-3: empty paths → BadRequestException.
  - AR-4, AR-5: round-trips of tar.gz / zip restore content.
  - AR-6: ../escaped entry rejected before any write.
  - AR-7: unknown extension → FILE_UNSUPPORTED_ARCHIVE.
  - AR-8: sibling-prefix regression (e.g. dest "/tmp/foo" vs
    "/tmp/foo_extra/x.txt") still rejected via the `+ path.sep`
    in the prefix comparison.

## Verification

- [x] `pnpm typecheck` 0 errors.
- [x] `pnpm lint` 0 warnings.
- [x] `pnpm test` 90 / 90 green (82 baseline + 8 new).
- [x] `pnpm build` pass. Main bundle gzip 104.67 → 104.87 kB
  (+0.20); files chunk 21.66 → 27.12 kB gzip (+5.46) — accounts
  for the selection state, two dialogs, and a few new icons.
- [x] API smoke 2026-05-17 against dev server: compress 204 +
  on-disk archive; extract 204 + md5-equal round-trip; .rar →
  400 `FILE_UNSUPPORTED_ARCHIVE` with the clean message.

## Close-out

- [x] `meta.json.status` flipped to `completed`, verification
  block populated.
- [x] `.arceus/changes/README.md` index + next-session note
  updated.
