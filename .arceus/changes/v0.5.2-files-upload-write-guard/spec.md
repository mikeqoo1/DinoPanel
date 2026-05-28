# Spec — v0.5.2 files-upload write guard

## Acceptance criteria

- [ ] `FilesService.saveUpload()` calls `this.assertWritable(dir)`
  immediately after `this.resolvePath(targetDir)` and before any
  `fs.mkdir` / write side-effect.
- [ ] `POST /api/files/upload?path=/etc/ssh` (or any path resolving
  under `DANGEROUS_WRITE_PATHS`) returns HTTP **403** with body
  `{ code: 'FILE_FORBIDDEN_PATH', message: 'Refusing to modify critical system path' }`.
- [ ] Upload to a legitimate path (e.g. `/home/<user>/uploads`) still
  succeeds with HTTP 201 — no regression in the happy path.
- [ ] `FilesService` test file gains at least 2 new cases:
  1. `saveUpload` rejects with `ForbiddenException` when target dir
     resolves under `/etc`.
  2. `saveUpload` rejects with `ForbiddenException` for path
     traversal (`../../../etc/ssh`).
- [ ] A repo-wide grep `assertWritable` shows the guard applied to
  every mutating `FilesService` method without exception. Document
  the audit in `decisions.md`.
- [ ] No partial file is left on disk when `assertWritable` rejects
  (verify by listing the resolved dir before/after a forbidden
  upload attempt; nothing new should appear).
- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build`
  all green.
