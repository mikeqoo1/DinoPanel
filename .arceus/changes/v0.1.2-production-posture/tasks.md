# v0.1.2 — Task Checklist

Executed as two parallel sub-tasks against the same working tree.

## Sub-task 10A — Production root + system info + frontend default path

- [x] Audit `deploy/systemd/dinopanel.service` — already `User=root`,
  no change needed.
- [x] Localise `scripts/install.sh` root-check failure message to zh-TW.
- [x] `apps/server/src/main.ts` — log pino `warn` when `getuid() !== 0`.
- [x] `packages/shared/src/schemas/system.ts` — define
  `processInfoSchema` and `ProcessInfo` type; export from index.
- [x] `apps/server/src/modules/system/system.service.ts` —
  `getProcessInfo()` using `os.userInfo()`, `os.hostname()`,
  `process.platform`, `process.version`, and package version lookup.
- [x] `apps/server/src/modules/system/system.controller.ts` —
  `GET /process-info` endpoint (JWT via default guard).
- [x] `apps/web/src/hooks/use-process-info.ts` — new react-query hook,
  `staleTime: Infinity`.
- [x] `apps/web/src/hooks/use-files.ts` — `useFileList` gains optional
  `enabled` flag.
- [x] `apps/web/src/routes/files.tsx` — remove `/root` hardcode, wait
  for processInfo before issuing list query.
- [x] `docs/deployment.md` — add "Why root?" section.

## Sub-task 10B — fs errno → HttpException mapping

- [x] `packages/shared/src/errors.ts` — add 7 new error code constants.
- [x] `apps/server/src/modules/files/files.service.ts` — module-level
  `mapFsError(err, op)` helper.
- [x] Wire `mapFsError` into list / readText / write / mkdir / rename /
  copy / remove / chmod / chown / saveUpload / createArchiveStream.
- [x] Add 8 new test cases covering each branch in the errno table plus
  the unknown-errno rethrow path.

## Final verification

- [x] `pnpm typecheck` — 4 successful
- [x] `pnpm lint` — 4 successful, 0 warnings
- [x] `pnpm test` — 55 passed (previous 47 + 8 new errno cases)
- [x] `pnpm build` — 3 successful (main bundle gzip 98.94 kB, still
  under the 120 kB target)
- [x] `pnpm exec playwright test` — 5/5 unchanged

## Smoke verification

- [x] Server log shows non-root warning when started as `mike`
- [x] `/api/system/process-info` returns expected shape with JWT
- [x] Files page lands on `/home/mike` automatically
