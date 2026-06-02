# Tasks — v0.6 Toolbox

Six phases per `proposal.md`. Each phase commits as a `feat(toolbox): … (phase N of v0.6)`
with the verification block; release cut happens at end of Phase 5. v0.6.0 adds
no drizzle migration (stateless).

## Phase 0 — Activation + shared shell/privilege contracts

- [x] Resolve decisions D1–D7 (recommended defaults adopted; see `decisions.md`)
- [x] Lift `firewall/drivers/run-command.ts` → `apps/server/src/common/shell/run-command.ts` with a generic `CommandError` (string-union `kind`; `ENOENT→TOOL_MISSING`, perm-denied→`PERMISSION_DENIED`, else `COMMAND_FAILED`/`SPAWN_ERROR`) + `probeCommand` (never-throws boot probe) + `runCommand({sudo})` option
- [x] Migrate `firewall` onto `common/shell/run-command.ts` — ufw/firewalld drivers + `firewall.module` `which()` (now uses `probeCommand`); old file deleted; `FirewallCommandError` removed (codes preserved via `FIREWALL_${kind}`)
- [x] Establish service-layer `instanceof CommandError → HttpException({code})` re-wrap standard (`commandErrorToHttp(err, prefix)`)
- [x] Backfill the re-wrap into `firewall.service` via a private `driverOp()` wrapper on getStatus/enable/disable/listRules/stage/removeRule (closes the D-bug opaque-500 gap) + regression test
- [x] Add `TOOLBOX_REQUIRE_SUDO` to `apps/server/src/config/env.schema.ts` (mirror `WEBSITES_REQUIRE_SUDO` enum/transform)
- [x] `sudo('-n', …)` wrapper (`runCommand({sudo:true})`) + non-throwing boot probe (`probeCommand`) pattern in place (nginx model)
- [x] Verification: typecheck ✓ · lint ✓ · test 370/370 ✓ (10 new run-command + 1 firewall re-wrap) · build ✓
- [x] Phase 0 commit: `feat(toolbox): shared shell + privilege contracts, fix firewall opaque-500 (phase 0 of v0.6)`

## Phase 1 — NTP / time-sync

- [x] `apps/server/src/modules/toolbox/toolbox.module.ts` (`which('timedatectl')` factory, `inject:[ConfigService]`) + `toolbox.controller.ts` (`@Controller('toolbox')`, `@UsePipes(ZodValidationPipe)`) + `toolbox.service.ts` (`NTP_DRIVER` token, `ntpOp` re-wrap, `OnApplicationBootstrap` sudo probe)
- [x] Wire `ToolboxModule` into `app.module.ts`
- [x] `drivers/ntp-driver.ts` — `TimedatectlNtpDriver` + `UnavailableNtpDriver` → 503 `{code:'NTP_NOT_CONFIGURED'}`
- [x] `GET /toolbox/ntp` — parse `timedatectl show` (primary, locale-proof) with `status` fallback (cross-systemd-version) + best-effort `chronyc tracking` enrichment (3s timeout)
- [x] `GET /toolbox/status` — `[{name,available,degraded,reason}]` (computed from driver availability + sudo posture; never calls the driver)
- [x] `POST /toolbox/ntp/set` — toggle NTP true|false (sudo on mutate) → returns fresh status
- [x] `POST /toolbox/ntp/timezone` — service allowlist-validates against `timedatectl list-timezones` + `--` end-of-options guard, reject unknown zone pre-shell-out → returns fresh status
- [x] `packages/shared/src/schemas/toolbox.ts` (ntpStatus / setNtp / setTimezone / toolboxStatus) re-exported from `schemas/index.ts`; shared dist rebuilt
- [x] Golden-string parser tests (real `timedatectl show`/`status` incl. zh-TW localized weekday + systemd-219 fallback + `chronyc tracking`) + service flow/re-wrap tests (14 new)
- [x] Adversarial review pass (3 lenses × verify): 3 nit/low findings applied (drop `universalTime` asymmetry, chrony 3s timeout, timezone leading-dash + `--` guard); contested ones correctly rejected
- [x] Verification: typecheck ✓ · lint ✓ · test ✓ · build ✓
- [x] Phase 1 commit: `feat(toolbox): NTP / time-sync (phase 1 of v0.6)`

## Phase 2 — Fail2Ban (extend in place) + disk usage / cleaners

- [ ] Retrofit existing `probeFail2ban` / `fail2banBanned` / `fail2banUnban` onto the sudo wrapper + D-bug re-wrap
- [ ] Fail2Ban: jail enable/disable, ban-add, read-only jail/config list (in `firewall.service.ts`)
- [ ] Verify `/firewall/fail2ban/*` routes + existing web caller still work
- [ ] `drivers/disk-driver.ts` — `GET /toolbox/disk` (reuse `/ws/metrics` `fsSize` snapshot + `du -x -d1`/`df`)
- [ ] `POST /toolbox/disk/clean` — category enum `journald | package_cache | docker_prune | tmp_sweep` (NO free path)
- [ ] `journald` → `journalctl --vacuum-*`; `package_cache` → `dnf clean all`/`apt-get clean` (driver branch); `docker_prune` → dockerode via `ContainersModule`; `tmp_sweep` → gated by files-module `assertWritable` + `DANGEROUS_WRITE_PATHS`
- [ ] `which()`-probe + `*_NOT_CONFIGURED` 503 fallback per feature
- [ ] Shared schemas for fail2ban jail + disk usage/clean bodies
- [ ] Per-feature driver + parser tests
- [ ] Phase 2 commit: `feat(toolbox): fail2ban extend + disk usage/cleaners (phase 2 of v0.6)`

## Phase 3 — Web Toolbox UI

- [ ] `apps/web/src/routes/toolbox/index.tsx` Tabs shell (clone `routes/system/index.tsx`, `useLocation`+`pickTab`, lazy+Suspense)
- [ ] Per-tab files: `ntp`, `fail2ban`, `disk`
- [ ] `/toolbox/*` splat route + named-export unwrap in `App.tsx`
- [ ] Sidebar entry (Wrench icon, `nav.toolbox`)
- [ ] `use-toolbox.ts` hooks + `toolboxKeys` factory (invalidate `.all` on mutate) + `extractErrorMessage` + sonner toasts
- [ ] Status `Badge` + "not configured on this host" `Card` keyed off `*_NOT_CONFIGURED`
- [ ] Type-to-confirm `Dialog` for disk-cleaner actions
- [ ] All DTO types imported from `@dinopanel/shared`
- [ ] `toolbox.*` + `nav.toolbox` keys in BOTH `zh-TW.json` and `en.json`
- [ ] Phase 3 commit: `feat(toolbox): web UI — tabs, hooks, i18n (phase 3 of v0.6)`

## Phase 4 — Hardening, guardrail tests, sudoers + docs

- [ ] Guardrail tests: `tmp_sweep` refuses out-of-allowlist target; `set-timezone` rejects invalid zone; every feature degrades to 503 when its binary is absent
- [ ] `docs/toolbox.md` with consolidated NOPASSWD `Cmnd_Alias` (mirror `docs/websites.md`)
- [ ] Sudoers snippet in `install.sh` / `deploy-rocky.sh`
- [ ] Explicit `packages/shared` rebuild (web/server see `toolbox` types)
- [ ] i18n parity check zh-TW vs en
- [ ] (carry from Phase 1 review) Project-wide: stop forwarding raw host `stderr` to clients in `commandErrorToHttp` / `ApiExceptionFilter` (gate `details.stderr` behind a dev flag, keep full stderr in server logs). Pre-existing, shared with firewall — fix once in the shared layer so both modules inherit it, do NOT diverge toolbox alone.
- [ ] Phase 4 commit: `feat(toolbox): hardening + sudoers + docs (phase 4 of v0.6)`

## Phase 5 — Release v0.6.0 + Rocky smoke

- [ ] Bump `apps/server` + `apps/web` package.json 0.5.0 → 0.6.0 (no migration)
- [ ] Update README + README_zh-TW (mark v0.6.0 shipped) + roadmap memory
- [ ] Release commit: `release(v0.6.0): toolbox module`
- [ ] Build tarball + scp via `scripts/deploy-rocky.sh`; deploy to Rocky 234
- [ ] Smoke S1–S5 (record in `smoke-pass.md`): boot tools-present / boot tool-absent / NTP round-trip / fail2ban list+unban / journald vacuum + docker prune
- [ ] Mark meta.json `status: completed` + `smokeStatus`
