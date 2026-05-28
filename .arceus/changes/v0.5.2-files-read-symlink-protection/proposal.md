# v0.5.2 — Read-side symlink protection for FilesService

**Status:** draft (2026-05-27)
**Priority:** P0 — security blocker, must ship before v0.5.0 release
**Origin:** check-spec multi-agent review, Layer 2 Files/Terminal/Exec audit

## What broke

`FilesService` hardened its **write** path against critical-prefix
escapes in v0.1.1 (commit `075929b`) via `assertWritable()` + the
`DANGEROUS_WRITE_PATHS` deny-list. But the **read** path got no
equivalent treatment, and `readText` / `createDownloadStream`
both follow symlinks transparently:

```ts
// apps/server/src/modules/files/files.service.ts:214 (readText)
const stat = await fs.stat(path);  // follows symlinks!
// ...
return fs.readFile(path, 'utf-8');

// files.service.ts:319 (createDownloadStream)
return { stream: fs.createReadStream(path), ... };  // follows symlinks!
```

## Exploit path

1. Authenticated panel user creates a symlink in any directory they
   can write to (e.g. `/home/operator/uploads`):
   `ln -s /etc/shadow /home/operator/uploads/shadow`
   This is fully legitimate — `ln` requires no special privilege
   to *create* a symlink to any path; the OS only enforces perms
   at *follow* time.
2. The OS-level perm check on `/etc/shadow` is bypassed because
   the panel server typically runs as `root` (it has to, to manage
   nginx / systemd / docker / databases).
3. The user calls `GET /api/files/read?path=/home/operator/uploads/shadow`
   or downloads it via `GET /api/files/download?path=...`. The server
   follows the symlink, opens `/etc/shadow` as root, returns the
   contents.
4. The same vector works for `/root/.ssh/id_ed25519`, `/etc/sudoers`,
   the panel's own `data/dinopanel.db` (SQLite — leaks every other
   DB password too), `/proc/self/environ` (env vars including
   `JWT_SECRET`, `CF_API_TOKEN`, etc.).

The `list()` path correctly uses `lstat` for per-entry metadata, but
the read endpoints do not check whether the resolved target stays
within an allowed zone.

## Two layers needed

This is not "just add a deny-list to read." Two complementary
controls are required:

**Layer 1 — Deny critical reads regardless of how the path was
spelled:** New `assertReadable(realpath)` checked against
`DANGEROUS_READ_PATHS`. The list should be **tighter** than the
write deny-list because read leaks are subtler (you do not need
to mutate `/etc/shadow` to defeat auth — just read it).

Proposed initial list:
- `/etc/shadow`, `/etc/gshadow`, `/etc/sudoers`, `/etc/sudoers.d`
- `/etc/ssh/ssh_host_*_key` (the private host keys)
- `/root` (entire homedir — has `.ssh`, `.bash_history`, etc.)
- `/home/*/.ssh/id_*` (per-user private keys; glob match)
- `/var/lib/sqlite/`, the panel's own `data/dinopanel.db`
- `/proc/*/environ`, `/proc/*/mem`
- `/dev/mem`, `/dev/kmem`, `/dev/port`

**Layer 2 — Symlink resolution at read time:** Use `fs.realpath()`
(or `lstat()` + manual link-walk with a cycle limit) before the
read, then assert the *real target* is not in the deny-list. This
catches the user-creates-symlink-then-reads pattern.

## Fix sketch

```ts
// New helper
private async resolveAndAssertReadable(input: string): Promise<string> {
  const resolved = this.resolvePath(input);          // existing
  const real = await fs.realpath(resolved);          // follows symlinks once, fully
  this.assertReadable(real);                         // new deny-list check
  return real;
}

// readText / createDownloadStream call this instead of resolvePath
```

`assertReadable()` mirrors `assertWritable()` shape: throws
`ForbiddenException` with `code: 'FILE_FORBIDDEN_READ'`.

## Out of scope

- Upload write guard — separate proposal
  [v0.5.2-files-upload-write-guard](../v0.5.2-files-upload-write-guard/).
- Tightening the write deny-list to include the same read-sensitive
  paths — write to `/etc/shadow` would already be a different kind
  of attack and is plausibly already caught by `/etc` in the write
  list. Out of scope for this change.
- Containing the panel server to a non-root user — that is a much
  bigger architectural change (would break docker/systemd
  management). Documented as long-term direction in
  v0.1.2-production-posture; not addressed here.
