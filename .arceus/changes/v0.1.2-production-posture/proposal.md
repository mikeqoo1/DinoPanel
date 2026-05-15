# v0.1.2 — Production Posture & Errno Hygiene

**Status:** completed
**Date:** 2026-05-15
**Commits:** `016e82d`

## Context

Immediately after v0.1.1 consolidation merged, a user-facing bug surfaced:
running `pnpm dev` as a non-root user (`mike`, uid 1000) and navigating to
the Files page produced a generic "Internal server error" toast. Root cause:

1. The frontend hardcoded the initial path to `/root`.
2. `/root` is mode 0700 owned by `root`; `mike` got `EACCES` on `readdir`.
3. The backend's `FilesService.list()` did not wrap `fs.readdir` in a
   try/catch, so the raw `NodeJS.ErrnoException` reached the global
   `ApiExceptionFilter`, which treated it as an unknown 500 and masked
   the actual cause.

The deeper question this raised: **what privilege level should DinoPanel
run at?** Server management panels in the wild (1Panel, Cockpit, Webmin)
all run as root via systemd, because file management, service control,
firewall management, container management, and cron all require it.
Running DinoPanel as anything less than root makes most of its modules
non-functional.

## Goals

1. **Make the production posture explicit and enforced.**
   - install.sh and systemd unit must require / declare `User=root`.
   - main.ts logs a clear warning at startup when uid ≠ 0, so dev users
     know what's happening without being blocked from running locally.

2. **Expose the runtime user to the frontend.**
   - A new `GET /api/system/process-info` endpoint returns uid, gid,
     username, home, isRoot, hostname, platform, node version, and
     DinoPanel version. JWT-protected.

3. **Make the frontend default path dynamic.**
   - Files page reads `processInfo.home` and uses it as the initial path,
     with `/` as fallback.

4. **Map fs errnos to typed exceptions.**
   - Backend wraps every fs call in a `mapFsError(err, op)` helper that
     translates `EACCES`, `EPERM`, `ENOENT`, `ENOTDIR`, `EISDIR`,
     `ELOOP`, `ENOSPC`, `EEXIST`, `EBUSY` to the right HTTP status and
     semantic error code. Unknown errnos rethrow so the global filter
     still produces a generic 500 (with full server-side logging).

## Non-goals

- No symlink realpath resolution (separate hardening, would break legit
  symlink-shortcut workflows).
- No fine-grained role-based access for non-root deployments — the panel
  is meant for one admin, running as root, on their own server.
- No `NODE_ENV`-conditional code paths; the non-root warning is
  unconditional.

## Outcome

Single commit `016e82d`, 12 files changed, +276 / -24. 8 new errno
regression tests bring unit total to 55. All other gates remain green
(typecheck, lint, build, 5 e2e passing).

The originating bug — Files page 500 on `/root` — is fixed two ways:
the frontend no longer asks for `/root` (it asks for `$HOME`), and even
if something does ask for a forbidden path the response is now a clean
`403 FILE_PERMISSION_DENIED` instead of a masked 500.
