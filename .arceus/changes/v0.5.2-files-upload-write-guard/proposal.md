# v0.5.2 — Apply `assertWritable()` to file-upload endpoint

**Status:** draft (2026-05-27)
**Priority:** P0 — security blocker, must ship before v0.5.0 release
**Origin:** check-spec multi-agent review, Layer 2 Files/Terminal/Exec audit

## What broke

`FilesService.saveUpload()` is the only mutating method in the files
module that does **not** apply the `assertWritable()` deny-list guard
after canonicalising the user-supplied path. Every other mutating
method (`write`, `mkdir`, `rename`, `copyTo`, `remove`, `chmod`,
`chown`) calls `assertWritable(resolvedPath)` immediately after
`resolvePath()`, which rejects writes into critical system prefixes
(`/`, `/bin`, `/sbin`, `/usr`, `/etc`, `/root`, `/var`, `/proc`,
`/sys`, `/boot`, `/dev`).

`saveUpload()` only calls `resolvePath()` and then proceeds straight
to `fs.mkdir(dirname(path), { recursive: true })` + `pipeline(...)`
into the destination.

```ts
// apps/server/src/modules/files/files.service.ts:305-316  (abridged)
async saveUpload(targetDir: string, filename: string, source: Readable) {
  const dir = this.resolvePath(targetDir);
  //  ↑ missing: this.assertWritable(dir);
  await fs.mkdir(dir, { recursive: true });
  const target = join(dir, filename);
  await pipeline(source, fs.createWriteStream(target));
  return target;
}
```

## Exploit path

1. Authenticated panel user (any user, no admin role required).
2. `POST /api/files/upload?path=/etc/ssh` with body containing a
   modified `sshd_config` (or `POST /api/files/upload?path=/root/.ssh`
   with an `authorized_keys` containing the attacker's pubkey).
3. The upload succeeds silently because `assertWritable()` is never
   called.
4. Next sshd restart (or by the time cron rotates) the attacker has
   root shell on the host.

This is a **direct escalation from panel-login to host-root** on a
server-management product whose entire value proposition is that
panel-login is a lower privilege tier than host-shell.

## Why the gap exists

`assertWritable()` was introduced in commit `075929b` (v0.1.1's
security harden) and applied to every mutating method that existed
at the time. The upload endpoint was added later (v0.1.1 Files UI
expansion) and missed the guard — the deny-list discipline was not
yet codified as a checklist.

## Fix

One line: insert `this.assertWritable(dir);` between `resolvePath()`
and `fs.mkdir()`. Plus a regression test.

A second, smaller hardening: also apply `assertWritable()` to the
**destination** in copy/move operations consistently (verify these
already do; from L2B the rename path already double-guards).

## Out of scope

- Read-side symlink-follow protection — separate proposal
  [v0.5.2-files-read-symlink-protection](../v0.5.2-files-read-symlink-protection/).
- Upload size cap (separate WARN-level concern; will file as backlog).
- Compose `createStack.path` write guard — separate proposal forthcoming.
