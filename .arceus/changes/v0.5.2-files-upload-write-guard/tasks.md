# Tasks — v0.5.2 files-upload write guard

## Implementation

- [x] Add `this.assertWritable(dir);` after `const dir = this.resolvePath(targetDir);`
  in `apps/server/src/modules/files/files.service.ts` `saveUpload()`.
- [x] Verify no partial file is written when `assertWritable` throws
  — confirmed: `assertWritable` throws synchronously before `fs.mkdir`,
  and tests U1/U2 assert `fsMock.mkdir` + `createWriteStream` never fire.
- [x] Re-audit every mutating method — `write` / `mkdir` / `rename` /
  `copyTo` / `remove` / `chmod` / `chown` all still call `assertWritable`
  (verified via grep). Added invariant comment block above the
  `FilesService` class declaration documenting the rule + the audit.

## Tests

- [x] Add unit test U1: `saveUpload` targeting `/etc/ssh` → `ForbiddenException`
  + no `fs.mkdir` + no `createWriteStream` call.
- [x] Add unit test U2: `saveUpload` with `/home/user/../../../etc/ssh`
  (absolute path with `..` segments that resolves under `/etc`) →
  `ForbiddenException`. Note: bare-relative `'../../etc/ssh'` is rejected
  earlier at `resolvePath` (BadRequest "Path must be absolute"); the
  realistic exploit vector is the absolute-with-traversal form.
- [x] Add unit test U3 (happy-path regression): `saveUpload` to
  `/home/admin/uploads` writes file and returns resolved path.
- [x] Existing 29 FilesService tests still pass (32/32 total).

## Verification

- [x] `vitest run src/modules/files/__tests__/files.service.test.ts` → 32/32 green.
- [x] `tsc --noEmit` green (server).
- [x] `eslint apps/server/src --max-warnings=0` green.
- [x] `nest build` green.
- [x] Workspace `vitest run` → 316/316 (+3 over Phase 3 baseline of 313).
- [ ] Manual smoke curl deferred — covered by unit-level deny-list assertion
  + reused `assertWritable` path (already smoke-tested for `write`/`remove`).

## Closeout

- [x] Commit: `fix(files): apply assertWritable to upload endpoint (v0.5.2)`
- [x] Update meta.json: status → completed, completedAt, verification block.
