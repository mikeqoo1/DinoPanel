# Tasks — v0.6.1 Supervisor + disk de-noise

Four phases; each commits as `feat(toolbox): … (v0.6.1 phase N)` with the
verification block. Release cut at Phase 4. No migration (stateless).

## Phase 1 — Disk de-noise

- [ ] `disk-driver.ts`: `df -PB1` → `df -PTB1`; `parseDf` reads 7 columns (add `fstype`); header-skip + non-numeric-row reject preserved
- [ ] `packages/shared/schemas/toolbox.ts`: `diskFilesystemSchema` += `fstype: z.string()`; export `PSEUDO_FSTYPES` + `isRealFilesystem(fstype)`; shared rebuilt
- [ ] web disk tab: default-filter via `isRealFilesystem`; "show system filesystems" toggle (default off)
- [ ] tests: `parseDf` golden incl. overlay/tmpfs/cgroup → fstype; `isRealFilesystem` accept/reject set
- [ ] Verify typecheck · lint · test · build · Phase 1 commit

## Phase 2 — Supervisor backend (systemd)

- [ ] `packages/shared/schemas/services.ts` (or in toolbox.ts): `serviceUnitSchema`, `systemdActionSchema` (enum), `serviceActionBodySchema`, `serviceUnitNameSchema`; `SUPERVISOR_SELF_UNIT`, `SUPERVISOR_CRITICAL_UNITS`, `serviceActionAllowed(unit, action)`; re-export from index; shared rebuilt
- [ ] `drivers/services-driver.ts`: `ServicesDriver` iface; `SystemctlServicesDriver` (list = merge list-units + list-unit-files; action = sudo -n systemctl <action> -- <unit>); `UnavailableServicesDriver` (503 `SERVICES_NOT_CONFIGURED`); exported parsers `parseSystemctlUnits` / `parseSystemctlUnitFiles`
- [ ] `toolbox.module.ts`: `SERVICES_DRIVER` token + `which('systemctl')` factory
- [ ] `toolbox.service.ts`: inject SERVICES_DRIVER; `listServices()`; `serviceAction()` (shape-validate → `serviceActionAllowed` guard → hostOp driver.action); `status()` += `services` feature
- [ ] `toolbox.controller.ts`: `GET /toolbox/services`, `POST /toolbox/services/action` (ZodValidationPipe)
- [ ] tests: parsers golden; `serviceActionAllowed` (self/critical/ordinary/normalize); service-level protected → `SERVICE_PROTECTED`, invalid → `SERVICE_INVALID_UNIT`, Unavailable → 503
- [ ] Adversarial review (guard correctness) → apply
- [ ] Verify · Phase 2 commit

## Phase 3 — Supervisor web UI

- [ ] `routes/toolbox/services.tsx` (table + per-row lifecycle buttons; protected buttons disabled via shared `serviceActionAllowed`; status gate)
- [ ] `routes/toolbox/index.tsx`: lazy services tab + `pickTab` + nav
- [ ] `hooks/use-toolbox.ts`: `useServicesList` + `useServiceAction` + `toolboxKeys.services`
- [ ] i18n `toolbox.tabs.services` + `toolbox.services.*` (en + zh-TW); parity test green
- [ ] Verify (incl. web tests) · Phase 3 commit

## Phase 4 — docs + release v0.6.1

- [ ] `docs/toolbox.md`: Services section + `Cmnd_Alias` += `systemctl start|stop|restart|enable|disable *`; code-denylist + self-unit note
- [ ] Bump 0.6.0 → 0.6.1 (4 package.json); README + README_zh-TW v0.6.1 row
- [ ] Extend `scripts/smoke-toolbox-234.sh` with a services check (list + protected-refusal assertion, non-destructive)
- [ ] Release commit `release(v0.6.1): supervisor + disk de-noise`
- [ ] (operator) Deploy Rocky 234 + smoke; record smoke-pass.md; meta `status: completed` + index row
