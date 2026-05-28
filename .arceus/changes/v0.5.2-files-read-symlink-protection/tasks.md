# Tasks — v0.5.2 files read symlink protection

## Implementation

- [ ] Add `DANGEROUS_READ_PATHS` constant array in
  `apps/server/src/modules/files/files.service.ts`.
  Include `/etc/shadow`, `/etc/gshadow`, `/etc/sudoers`,
  `/etc/sudoers.d`, `/etc/ssh`, `/root`, `/proc`, `/sys`,
  `/dev/mem`, `/dev/kmem`, `/dev/port`, plus the panel's SQLite path.
- [ ] Implement `private assertReadable(realPath: string): void`
  mirroring `assertWritable()` shape — throws
  `ForbiddenException({ code: 'FILE_FORBIDDEN_READ', ... })`.
- [ ] Implement `private async resolveAndAssertReadable(input: string): Promise<string>`
  that calls `resolvePath` → `fs.realpath` → `assertReadable`.
- [ ] Update `readText()` to call `resolveAndAssertReadable` instead
  of `resolvePath` (apps/server/src/modules/files/files.service.ts:214).
- [ ] Update `createDownloadStream()` similarly (files.service.ts:319).
  Also assert `fs.stat(real).isFile()` before opening stream.
- [ ] Resolve the panel's SQLite path from env / config (do not
  hardcode) and feed it into `DANGEROUS_READ_PATHS` at startup.

## Tests

- [ ] Add unit test: symlink to `/etc/shadow` → readText rejects.
- [ ] Add unit test: symlink to `/etc/ssh/ssh_host_rsa_key` →
  download rejects.
- [ ] Add unit test: regular read under `/home/test/X` still works.
- [ ] Add unit test: nested symlink chain rejects.
- [ ] Add unit test: broken symlink returns 404 / ENOENT (not 403).
- [ ] Add unit test: FIFO / device file rejected as
  `FILE_NOT_REGULAR_FILE`.
- [ ] Ensure existing FilesService tests still pass (25+).

## Verification

- [ ] `pnpm -F @dinopanel/server test --filter files` green.
- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm build` all green.
- [ ] Manual smoke:
  ```bash
  ln -s /etc/shadow /home/operator/uploads/shadow
  curl -H "Authorization: Bearer $TOKEN" \
    "http://localhost:3000/api/files/read?path=/home/operator/uploads/shadow"
  # expect: HTTP 403, code=FILE_FORBIDDEN_READ
  ```

## Closeout

- [ ] Commit: `fix(files): deny read of sensitive paths via symlink (v0.5.2)`
- [ ] Update meta.json: status → completed, completedAt, verification.
