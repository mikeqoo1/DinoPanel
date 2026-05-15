# v0.1.2 — Spec

## Verification gates

- `pnpm typecheck` — 0 errors
- `pnpm lint` — 0 errors, 0 warnings
- `pnpm test` — ≥ 55 cases passing (previous 47 + new errno tests)
- `pnpm build` — successful
- `pnpm exec playwright test` — 5/5 still passing (no e2e regression)

## Acceptance criteria

### 1. Production root posture
- `deploy/systemd/dinopanel.service` declares `User=root` (or omits
  `User=`, which defaults to root).
- `scripts/install.sh` rejects non-root invocation up-front with a
  zh-TW error message guiding the user to use `sudo`.
- `apps/server/src/main.ts` logs a pino `warn` at startup when
  `process.getuid() !== 0`. Message names every feature category that
  will be limited (files / services / firewall / containers).
- `docs/deployment.md` gains a "Why root?" section explaining the
  rationale.

### 2. `/api/system/process-info` endpoint
- HTTP method: `GET`
- Path: `/api/system/process-info`
- Auth: JWT required (default guard).
- Response schema (shared via `@dinopanel/shared`):
  ```ts
  interface ProcessInfo {
    hostname: string;
    uid: number;
    gid: number;
    username: string;
    home: string;
    isRoot: boolean;
    dinopanelVersion: string;
    platform: string;
    nodeVersion: string;
  }
  ```
- Implementation uses `os.userInfo()` and `os.hostname()`; no shelling
  out, no privileged calls.

### 3. Frontend dynamic default path
- A `useProcessInfo()` hook fetches the endpoint with
  `staleTime: Infinity` (immutable per session).
- `apps/web/src/routes/files.tsx`:
  - Initial `currentPath` is `''`, not `'/root'`.
  - A `useEffect` populates `currentPath` from `processInfo.home` once
    available; falls back to `'/'` if `home` is missing.
  - The file list query is gated by an `enabled` flag so it does not
    fire until a real path is set.

### 4. fs errno mapping
- A module-level `mapFsError(err: unknown, op: string): never` helper
  in `apps/server/src/modules/files/files.service.ts`.
- Mapping:

  | errno  | exception                  | code                       |
  | ------ | -------------------------- | -------------------------- |
  | EACCES | `ForbiddenException` (403) | `FILE_PERMISSION_DENIED`   |
  | EPERM  | `ForbiddenException` (403) | `FILE_PERMISSION_DENIED`   |
  | ENOENT | `NotFoundException` (404)  | `FILE_NOT_FOUND`           |
  | ENOTDIR| `BadRequestException` (400)| `FILE_NOT_A_DIRECTORY`     |
  | EISDIR | `BadRequestException` (400)| `FILE_IS_A_DIRECTORY`      |
  | ELOOP  | `BadRequestException` (400)| `FILE_SYMLINK_LOOP`        |
  | ENOSPC | `PayloadTooLargeException` (413) | `FILE_NO_SPACE`      |
  | EEXIST | `ConflictException` (409)  | `FILE_ALREADY_EXISTS`      |
  | EBUSY  | `ConflictException` (409)  | `FILE_BUSY`                |
  | other  | rethrow                     | (filter → 500)             |

- Helper is wired into: `list`, `readText`, `write`, `mkdir`, `rename`,
  `copy`, `remove`, `chmod`, `chown`, `saveUpload`,
  `createArchiveStream` (stat inside the loop).

### 5. Tests
- ≥ 6 new unit cases covering each errno branch in the table plus the
  rethrow path for unknown errnos. Bonus: regression case for the
  existing ENOENT-from-stat behaviour.
- Existing 47 vitest cases continue to pass unchanged.
- Existing 5 playwright cases continue to pass unchanged.

## Smoke test (manual)

- Run dev as `mike` (uid 1000). Server log shows the non-root warning.
- Log in. Files page lands on `/home/mike`, not `/root`.
- `curl -H "Authorization: Bearer <jwt>" http://127.0.0.1:9999/api/system/process-info`
  returns the documented shape.
- Navigate to `/root` manually via breadcrumb / URL: get a
  `403 FILE_PERMISSION_DENIED` toast, not a generic 500.
