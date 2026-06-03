# Tasks — v0.6.1 Supervisor + disk de-noise

Four phases; each commits as `feat(toolbox): … (v0.6.1 phase N)` with the
verification block. Release cut at Phase 4. No migration (stateless).

## Phase 1 — Disk de-noise

- [x] `disk-driver.ts`: `df -PB1` → `df -PTB1`; `parseDf` reads 7 columns (add `fstype`); header-skip + non-numeric-row reject preserved
- [x] `packages/shared/schemas/toolbox.ts`: `diskFilesystemSchema` += `fstype: z.string()`; export `PSEUDO_FSTYPES` (24) + `isRealFilesystem(fstype)` (rejects pseudo set + `fuse.*`); shared rebuilt
- [x] web disk tab: fstype column + default-filter via `isRealFilesystem`; "show system filesystems" toggle (default off) + "{n} hidden" hint; i18n keys en+zh-TW (parity green)
- [x] tests: `parseDf` golden incl. overlay row → fstype; `isRealFilesystem` accept(ext4/xfs/btrfs/…)/reject(overlay/tmpfs/…/`fuse.*`)
- [x] Verify typecheck ✓ · lint ✓ · test 441 ✓ · build ✓ · Phase 1 commit

## Phase 2 — Supervisor backend (systemd)

- [x] `packages/shared/schemas/services.ts`: `serviceUnitSchema`, `systemdActionSchema`, `serviceActionBodySchema`, `serviceUnitNameSchema`; `SUPERVISOR_SELF_UNIT`, `SUPERVISOR_CRITICAL_UNITS`, `normalizeServiceUnit`, `serviceActionAllowed` (**.service-only** + self + critical tiers); re-export from index; shared rebuilt
- [x] `drivers/services-driver.ts`: `ServicesDriver` iface (list/action/**resolveCanonicalUnit**); `SystemctlServicesDriver` (list = merge list-units + list-unit-files, best-effort enrich; action = sudo -n `systemctl <action> -- <unit>`; resolveCanonicalUnit = `systemctl show -p Id --value`); `UnavailableServicesDriver` (503 `SERVICES_NOT_CONFIGURED`); parsers `parseSystemctlUnits`/`parseSystemctlUnitFiles`
- [x] `toolbox.module.ts`: `SERVICES_DRIVER` token + `which('systemctl')` factory
- [x] `toolbox.service.ts`: inject SERVICES_DRIVER; `listServices()`; `serviceAction()` (shape → guard → **resolve canonical Id + re-judge** → hostOp action); `status()` += `services` feature
- [x] `toolbox.controller.ts`: `GET /toolbox/services`, `POST /toolbox/services/action` (ZodValidationPipe)
- [x] tests: parsers golden; `serviceActionAllowed` (self/critical/ordinary/normalize/**non-.service**); service-level protected/invalid/**socket+target bypass**/**alias bypass**/Unavailable 503
- [x] Adversarial review (4 lenses × verify): 13 findings → 4 confirmed → **all applied** (HIGH .socket/.target bypass + MED alias bypass + MED cross-type surface → `.service`-only guard + canonical-Id re-judge; LOW list-unit-files rejection swallow)
- [x] Verify typecheck ✓ · lint ✓ · test 464 ✓ · build ✓ · Phase 2 commit

## Phase 3 — Supervisor web UI

- [x] `routes/toolbox/services.tsx` (filterable table: name/desc, active+sub badge, enabled, per-row start/stop/restart/enable/disable; protected buttons **disabled via shared `serviceActionAllowed`** with the reason as title; confirm dialog; status gate)
- [x] `routes/toolbox/index.tsx`: lazy services tab + `pickTab('/services')` + TabsTrigger/Content; pick-tab test updated
- [x] `hooks/use-toolbox.ts`: `useServicesList` + `useServiceAction` + `toolboxKeys.services`
- [x] i18n `toolbox.tabs.services` + `toolbox.services.*` (en + zh-TW); i18n-parity test green
- [x] Verify typecheck ✓ · lint ✓ · test 464 ✓ · build ✓ · Phase 3 commit

## Phase 4 — docs + release v0.6.1

- [x] `docs/toolbox.md`: Services section (+ `.service`-only / alias-resolution guard write-up) + `Cmnd_Alias` += `systemctl start|stop|restart|enable|disable *` (with the code-denylist note) + degraded-table `services` row + intro/deferred updated
- [x] Bump 0.6.0 → 0.6.1 (4 package.json); README + README_zh-TW v0.6.1 row
- [x] Extend `scripts/smoke-toolbox-234.sh` with **S6** (services list + live `SERVICE_PROTECTED` refusal of `dinopanel`/`sshd` stop + `ssh.socket` — all non-destructive)
- [x] Release commit `release(v0.6.1): supervisor + disk de-noise`
- [x] Deploy Rocky 234 (operator) + smoke (`scripts/smoke-toolbox-234.sh`): **S1-S3 + S6 PASSED** (S6 verified the protected guard live: dinopanel/sshd/ssh.socket → SERVICE_PROTECTED; disk fstype de-noise confirmed live — 15/27 overlay default-hidden). smoke-pass.md written; meta `status: completed`; index + README rows updated. (panel runs as root → systemctl works without the sudoers lines on this box.)
