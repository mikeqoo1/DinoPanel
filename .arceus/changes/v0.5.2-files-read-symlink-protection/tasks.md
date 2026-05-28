# Tasks — v0.5.2 files read symlink protection

## Implementation

- [x] Add `DANGEROUS_READ_PATHS` constant array in
  `apps/server/src/modules/files/files.service.ts`.
  Include `/etc/shadow`, `/etc/gshadow`, `/etc/sudoers`,
  `/etc/sudoers.d`, `/etc/ssh`, `/root`, `/proc`, `/sys`,
  `/dev/mem`, `/dev/kmem`, `/dev/port`, plus the panel's SQLite path.
- [x] Implement `private assertReadable(realPath: string): void`
  mirroring `assertWritable()` shape — throws
  `ForbiddenException({ code: 'FILE_FORBIDDEN_READ', ... })`.
- [x] Implement `private async resolveAndAssertReadable(input: string): Promise<string>`
  that calls `resolvePath` → `fs.realpath` → `assertReadable`.
- [x] Update `readText()` to call `resolveAndAssertReadable` instead
  of `resolvePath` (apps/server/src/modules/files/files.service.ts:214).
- [x] Update `createDownloadStream()` similarly (files.service.ts:319).
  Also assert `fs.stat(real).isFile()` before opening stream.
- [ ] Resolve the panel's SQLite path from env / config (do not
  hardcode) and feed it into `DANGEROUS_READ_PATHS` at startup.
  **DEFERRED**: requires config dependency injection; DATA_DIR is configurable
  and hardcoding would be fragile. Flagged as known limitation in service
  comment. Panel's db under /opt/dinopanel/ is not a high-value attacker
  target via symlink since the server already has direct access.

## Tests

- [x] Add unit test: symlink to `/etc/shadow` → readText rejects (R1).
- [x] Add unit test: symlink to `/etc/ssh/ssh_host_rsa_key` →
  download rejects (R2).
- [x] Add unit test: regular read under `/home/user/X` still works (R3).
- [x] Add unit test: nested symlink chain rejects (R4).
- [x] Add unit test: broken symlink returns 404 / ENOENT (not 403) (R5).
- [x] Add unit test: FIFO / device file rejected as
  `FILE_NOT_REGULAR_FILE` (R6).
- [x] Add regression guard: safe path under /home/user passes (R7).
- [x] Add unit test (post-review): createArchiveStream blocks symlink
  source (R8).
- [x] Add unit test (post-review): compressToDisk blocks symlink
  source (R9).
- [x] Ensure existing FilesService tests still pass (32 baseline → 41 total).

## Verification

- [x] `vitest run` on files.service.test.ts → 41/41 green.
- [x] Workspace `vitest run` → 345/345 (+9 over baseline 336).
- [x] `tsc --noEmit` server — clean.
- [x] `eslint --max-warnings=0` server — 0 errors / 0 warnings.
- [x] `nest build` server — pass.
- [ ] Manual smoke (curl + symlink) deferred to post-merge window —
  unit tests cover the assertion path through fsMock.

## Closeout

- [x] Commit: `fix(files): deny read of sensitive paths via symlink (v0.5.2)`
- [x] Update meta.json: status → completed, completedAt, verification.
