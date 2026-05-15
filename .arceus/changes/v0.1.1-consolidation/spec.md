# v0.1.1 — Spec

## Verification gates (all must pass)

- `pnpm typecheck` — 0 errors
- `pnpm lint` — 0 errors, 0 warnings
- `pnpm test` — ≥ 40 vitest cases passing (no skipped, no todo)
- `pnpm build` — successful
- `pnpm exec playwright test` — ≥ 3 e2e specs covering login, dashboard, files

## Acceptance criteria

### 1. Test infrastructure
- `vitest.workspace.ts` aggregates apps/server (node env) and apps/web
  (jsdom env) projects.
- `playwright.config.ts` exists with chromium-only project, testDir `e2e/`,
  baseURL pointing at the single port (9999).
- Root scripts: `test`, `test:watch`, `test:e2e`.
- `.gitignore` excludes `playwright-report/`, `test-results/`, `coverage/`.

### 2. API error contract
- A global `ApiExceptionFilter` produces canonical
  `{ code: string; message: string; details?: unknown }` responses.
- `ApiErrorResponse` is exported from `@dinopanel/shared`.
- HTTP status codes map to semantic codes (`BAD_REQUEST`, `UNAUTHORIZED`,
  `FORBIDDEN`, `NOT_FOUND`, `PAYLOAD_TOO_LARGE`, `RATE_LIMITED`, etc.).
- Unknown errors are logged with full stack on the server but return a
  generic `{ code: 'INTERNAL_ERROR', message: 'Internal server error' }`
  to the client.

### 3. `extractErrorMessage`
Handles, in priority order:
1. New `ApiErrorResponse` (with optional Zod-style `details` array)
2. NestJS legacy `{ statusCode, message }`
3. class-validator `message: string[]`
4. AxiosError without response (network failure)
5. `Error` instance
6. Raw string throw
7. `null` / `undefined` / `{}`

≥ 8 unit test cases covering the above.

### 4. Bundle code-splitting
- All non-login routes use `React.lazy` with a `<Suspense>` fallback.
- Monaco, xterm, recharts land in their own per-route chunks.
- Main entry chunk gzipped ≤ 120 kB.

### 5. node-pty deployment
- `scripts/install.sh` detects `python3` / `gcc` / `make` before running
  npm install; emits per-distro install commands when missing.
- `scripts/build-release.sh --prebuild=x64|arm64` collects the compiled
  `pty.node` into `prebuilds/linux-<arch>/` inside the tarball.
- When a prebuild is present, install.sh skips the toolchain check.

### 6. Files UI
- Right-click menu (or row buttons) for copy / chmod / chown.
- `<Dialog>` flows: copy destination input, chmod octal mode (regex
  `/^[0-7]{3,4}$/`), chown uid + gid inputs.
- Successful mutation invalidates the file list query.
- i18n keys added in both en and zh-TW.

### 7. Backend unit tests
- `FilesService`: ≥ 10 cases covering resolvePath traversal protection,
  readText binary detection, and remove deny-list enforcement.
- `AuthService`: ≥ 5 cases covering login, refresh, expired refresh,
  invalid refresh, and user-enumeration resistance (same error for
  wrong password vs unknown user).

### 8. E2E smoke
- `e2e/login.spec.ts` — valid credentials land on dashboard; wrong
  password shows an error toast.
- `e2e/dashboard.spec.ts` — metric cards render with non-empty values
  and the Recharts SVG is mounted.
- `e2e/files.spec.ts` — navigate, create a file, verify it appears,
  clean up.

### 9. Mid-flight security fix
- `FilesService.resolvePath()` uses `path.resolve()` canonicalisation,
  not segment-scan blacklist.
- New `assertWritable(resolvedPath)` deny-list rejects mutations on
  critical system prefixes (`/`, `/bin`, `/sbin`, `/usr`, `/etc`,
  `/root`, `/var`, `/proc`, `/sys`, `/boot`, `/dev`).
- All mutating service methods call `assertWritable`. Reads are unaffected
  (admin reading `/etc/hosts` is legitimate).
