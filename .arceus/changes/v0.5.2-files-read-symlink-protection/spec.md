# Spec — v0.5.2 files read symlink protection

## Acceptance criteria

### Deny-list

- [ ] New constant `DANGEROUS_READ_PATHS` exported from
  `apps/server/src/modules/files/files.service.ts` (or a sibling
  constants file) containing at minimum:
  `/etc/shadow`, `/etc/gshadow`, `/etc/sudoers`, `/etc/sudoers.d`,
  `/etc/ssh` (whole dir — host private keys live here),
  `/root`, `/proc`, `/sys`, `/dev/mem`, `/dev/kmem`, `/dev/port`,
  plus the panel's own SQLite DB path.
- [ ] New `assertReadable(realPath: string)` private method on
  `FilesService` throws `ForbiddenException` with code
  `FILE_FORBIDDEN_READ` when `realPath` matches or is under
  any deny-list entry.

### Symlink resolution

- [ ] New private helper `resolveAndAssertReadable(input)` that:
  1. Calls `resolvePath(input)` (existing).
  2. Calls `fs.realpath(resolved)` — fully follows the symlink chain
     to the final target.
  3. Calls `assertReadable(real)`.
  4. Returns `real` (the dereferenced target, not the symlink).
- [ ] `readText()` uses `resolveAndAssertReadable` instead of
  `resolvePath`.
- [ ] `createDownloadStream()` uses `resolveAndAssertReadable` instead
  of `resolvePath`.
- [ ] `list()` continues to use `lstat` for per-entry metadata (no
  regression in how symlinks are listed — they should still appear
  in directory listings, just not be *traversable through read*).
- [ ] `download` endpoint (`createDownloadStream`) also verifies
  with `fs.stat(real)` that the target is a regular file (block
  `/dev/random`, FIFOs, `/proc/self/fd/0`).

### Behavioural tests

- [ ] Test: symlink at `/tmp/X/shadow -> /etc/shadow` → read of
  `/tmp/X/shadow` rejects with `FILE_FORBIDDEN_READ`.
- [ ] Test: symlink at `/tmp/X/sshkey -> /etc/ssh/ssh_host_rsa_key`
  → read rejects.
- [ ] Test: legitimate read of a regular file under `/home/user/X`
  still works.
- [ ] Test: symlink chain (A → B → /etc/shadow) — realpath should
  resolve transitively; rejects.
- [ ] Test: chasing a broken symlink (target does not exist) returns
  the existing 404 / ENOENT error, not a security violation.
- [ ] Test: reading a FIFO file is rejected as `FILE_NOT_REGULAR_FILE`
  (or similar).

### Verification

- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build`
  all green.
- [ ] Manual smoke: create symlink + curl + assert 403 response shape.
