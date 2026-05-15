# v0.1.1 — Task Checklist

Execution order respected `blockedBy` dependencies in the task graph.

## Phase 1 — Foundation (parallel)

- [x] **#1** Test infrastructure: vitest workspace, playwright config,
  smoke placeholders, root scripts
- [x] **#8** API error response unification: global `ApiExceptionFilter`,
  `ApiErrorResponse` shared type, WS gateways adopt new shape

## Phase 2 — depends on Phase 1 (parallel)

- [x] **#2** `extractErrorMessage` strengthening: 7-case priority chain,
  13 unit tests
- [x] **#3** Bundle code-splitting: `React.lazy` per route, `manualChunks`
  vendor split, gzip 400.59 kB → 98.45 kB
- [x] **#5** node-pty deployment strategy: install.sh per-distro detect,
  build-release.sh `--prebuild=x64|arm64`, docs

## Phase 3 — depends on Phase 1 + 2 (parallel)

- [x] **#4** Files UI for copy / chmod / chown: three dialogs, 14 i18n
  keys, react-query mutation invalidation
- [x] **#6** Backend unit tests: 13 FilesService cases + 7 AuthService
  cases

## Phase 4 — Mid-flight + finale

- [x] **#9** *(unplanned)* `FilesService.resolvePath()` traversal fix:
  replaced segment-scan blacklist (bypassed by `path.normalize()`
  folding `..` on absolute paths) with `path.resolve()` canonicalisation
  plus `assertWritable()` deny-list for mutating ops
- [x] **#7** E2E smoke: login + dashboard + files specs, globalSetup
  managing prod server, storageState for auth reuse

## Final verification

- [x] `pnpm typecheck` — 4 successful
- [x] `pnpm lint` — 4 successful, 0 warnings
- [x] `pnpm test` — 47 passed (smoke 2 + filter 4 + extract-error 13 +
  files 21 + auth 7)
- [x] `pnpm build` — 3 successful
- [x] `pnpm exec playwright test` — 5 passed (smoke + login×2 +
  dashboard + files)
