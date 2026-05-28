# Tasks — v0.5.2 files-upload write guard

## Implementation

- [ ] Add `this.assertWritable(dir);` after `const dir = this.resolvePath(targetDir);`
  in `apps/server/src/modules/files/files.service.ts` `saveUpload()`.
- [ ] Verify no partial file is written when `assertWritable` throws
  (it throws synchronously before `fs.mkdir`, so the path should be
  clean — confirm by tracing).
- [ ] Re-audit every `mutating` method in `FilesService` for the
  `resolvePath` → `assertWritable` discipline; add a brief code
  comment block above the class documenting the invariant.

## Tests

- [ ] Add unit test: `saveUpload throws ForbiddenException when target dir is under /etc`
  in `apps/server/src/modules/files/__tests__/files.service.test.ts`.
- [ ] Add unit test: `saveUpload throws ForbiddenException for ../traversal targets`.
- [ ] Add unit test (happy path regression): `saveUpload writes file
  to /tmp/<random>/foo.txt and returns the resolved path`.
- [ ] Confirm existing 25+ FilesService tests still pass.

## Verification

- [ ] `pnpm -F @dinopanel/server test --filter files` green.
- [ ] `pnpm typecheck` green.
- [ ] `pnpm lint` green.
- [ ] `pnpm -F @dinopanel/server build` green.
- [ ] Manual smoke: `curl -X POST -H "Authorization: Bearer $TOKEN"
  -F "file=@/tmp/x.txt" "http://localhost:3000/api/files/upload?path=/etc/ssh"`
  → HTTP 403.

## Closeout

- [ ] Commit: `fix(files): apply assertWritable to upload endpoint (v0.5.2)`
- [ ] Update meta.json: status → completed, completedAt, verification block.
