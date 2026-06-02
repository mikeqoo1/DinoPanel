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

- [x] Retrofit `probeFail2ban` / `fail2banBanned` / `fail2banUnban` onto `{ sudo }` (reuse `TOOLBOX_REQUIRE_SUDO`) + the existing `driverOp` re-wrap; extract inline regexes into exported `parseFail2banJailList` / `parseFail2banJailDetail`
- [x] Fail2Ban new ops in `firewall.service.ts`: `fail2banJails` (read-only counters+banned), `fail2banBan`, `fail2banSetJailEnabled` (runtime start/stop — non-persistent), `assertJailExists` allowlist guard; per-jail try/catch so one racing jail doesn't 500 the list
- [x] Controller routes: `GET /firewall/fail2ban/jails`, `POST /firewall/fail2ban/ban`, `POST /firewall/fail2ban/jails/:name/enabled`; retrofit `/firewall/fail2ban/unban` with body validation. Existing `/banned` + web Badge unaffected
- [x] `drivers/disk-driver.ts` — `GET /toolbox/disk` via `df -PB1` (header-skip positional parse, locale-proof, %clamp) + `du -x -d1 -B1 -- <root>` (best-effort, no assertSuccess); `?path=` gated by closed `SAFE_DU_ROOTS` allowlist (read-only → exact-match enum, NOT the write guard)
- [x] `drivers/cleaner-driver.ts` — `POST /toolbox/clean` category enum `journald | package_cache | docker_prune` + `GET /toolbox/cleaners` availability. journald `--vacuum-size=500M` (server constant); package_cache `dnf clean all` / `apt-get clean` (which-detected); docker_prune via injected `DOCKER` dockerode handle (containers + dangling images, **NO volumes**), `mapDockerError`
- [x] **`tmp_sweep` DROPPED** (see decisions §Phase-2) — blanket `/tmp` wipe risks active sockets/locks; `DANGEROUS_WRITE_PATHS` is a deny-list (no `/tmp`), so it can't confine a sweep; every shipped cleaner is tool-owned with no path input → no FilesModule import
- [x] `which()`-probe + `*_NOT_CONFIGURED` 503 fallback (disk via `DfDuDiskDriver`/`UnavailableDiskDriver`; cleaners report per-category availability)
- [x] Shared schemas: fail2ban jail/ban/unban/set-enabled + `fail2banJailNameSchema` (firewall.ts); disk usage + clean category/result/cleaners (toolbox.ts)
- [x] Per-feature driver + parser tests (fail2ban parsers ×4, parseDf/parseDu ×4 incl. >100% clamp, disk/cleaner service flow ×5)
- [x] Adversarial review (3 lenses × verify): 4 low/nit applied (%clamp, images-deleted count, per-jail skip+log, shared jail-name schema); DI/allowlist/sudo/volumes verified clean
- [x] Verification: typecheck ✓ · lint ✓ · test 397 ✓ · build ✓
- [x] Phase 2 commit: `feat(toolbox): fail2ban extend + disk usage + curated cleaners (phase 2 of v0.6)`

## Phase 3 — Web Toolbox UI

- [x] `routes/toolbox/index.tsx` Tabs shell (clone `routes/system/index.tsx`, `pickTab`, lazy+Suspense all 3 tabs) + exported `pickTab` (unit-tested)
- [x] Per-tab files: `ntp` (status + enable toggle + datalist timezone picker), `fail2ban` (jails table + ban form w/ jail datalist + per-IP unban), `disk` (filesystems table + `safeRoots` breakdown picker + cleaners w/ type-to-confirm Dialog)
- [x] `/toolbox/*` splat route + named-export unwrap in `App.tsx`; sidebar entry (Wrench, `nav.toolbox`)
- [x] `use-toolbox.ts` hooks + `toolboxKeys` factory (mutations invalidate `.all`; setNtp/setTimezone seed via setQueryData; `placeholderData: keepPreviousData` on disk); fail2ban hooks ADDED to `use-firewall.ts` with distinct `fail2banJails`/`fail2banBanned` key segments (mutations invalidate the `fail2ban()` prefix)
- [x] "not configured" gated off `GET /toolbox/status` `features[].available/reason` (+ `status.error` guard) and `GET /firewall/status` `{fail2ban}`; per-cleaner availability from `GET /toolbox/cleaners`
- [x] Type-to-confirm `Dialog` for disk-cleaner actions (gate on typing the category)
- [x] All DTO types imported from `@dinopanel/shared`; `formatBytes` reused from `lib/utils`
- [x] `toolbox.*` (51 keys) + `nav.toolbox` in BOTH `zh-TW.json` and `en.json` (parity verified)
- [x] **UI-enabling backend additions**: `GET /toolbox/ntp/timezones` (datalist) + `safeRoots` on `DiskUsage` (self-describing breakdown picker)
- [x] Adversarial review (3 lenses × verify): 5 findings applied — **fail2ban jail enable/disable toggle DROPPED from UI** (see decisions §Phase-3: backend only lists running jails, so the toggle was broken-by-design), fail2ban queryKey collision split, `status.error` guards ×3, disk `keepPreviousData`, ban-jail datalist
- [x] Verification: typecheck ✓ · lint ✓ · test 400 ✓ · build ✓
- [x] Phase 3 commit: `feat(toolbox): web UI — tabs, hooks, i18n (phase 3 of v0.6)`

## Phase 4 — Hardening, guardrail tests, sudoers + docs

- [x] Guardrail tests — `tmp_sweep` bullet was STALE (dropped P2-a); reconciled to the real allowlists/guards: `set-timezone` rejects unknown/leading-dash/injection zones (shared schema + service allowlist); disk `?path=` rejects out-of-allowlist AND sub-path of an allowlisted root (exact-match, not prefix); `clean` rejects out-of-enum category (shared schema + a hardened `cleaner-driver.run()` `default` throw → `TOOLBOX_UNKNOWN_CLEANER`); fail2ban ban/unban reject unknown jail (`assertJailExists`) + invalid jail name; every feature degrades to 503 when its binary is absent (Unavailable NTP/Disk drivers, journald/package_cache/docker cleaners, fail2ban `FAIL2BAN_NOT_AVAILABLE`)
- [x] `docs/toolbox.md` with consolidated NOPASSWD `Cmnd_Alias` (mirror `docs/websites.md`) — incl. `secure_path` resolution caveat
- [x] Sudoers reminder in `install.sh` (post-install echo → docs/toolbox.md) + `deploy-rocky.sh` (printed contract block; note: deploy-rocky.sh is git-ignored/local-only, so the tracked contract lives in docs/toolbox.md + install.sh)
- [x] Explicit `packages/shared` rebuild (`pnpm --filter @dinopanel/shared build`) — no schema change this phase, web/server see toolbox types
- [x] i18n parity check zh-TW vs en — added a web vitest `i18n-parity.test.ts` (full key-set parity, 720/720; guards every module, not just toolbox)
- [x] (carry from Phase 1 review) stop forwarding raw host `stderr` to clients — fixed once in the shared layer: `commandErrorToHttp(err, prefix, { exposeStderr })` redacts `details.stderr` by default; firewall + toolbox each log full stderr server-side (`*.command_failed`) then pass `exposeStderr: isDev`. websites/databases stderr exposure is a separate PRE-EXISTING out-of-scope item (followup, not diverged here)
- [x] Adversarial review (4 lenses × verify): 17 findings → 3 confirmed (all low, additive): fail2ban happy-path argv assertion (pins the `ban(jail,ip)`/`unban(ip,jail)` ordering + sudoers argv), firewall-side redaction test + server-side warn assertion, sudoers `secure_path` doc caveat — all applied
- [x] Verification: typecheck ✓ · lint ✓ · test 438 ✓ · build ✓
- [x] Phase 4 commit: `feat(toolbox): hardening + sudoers + docs (phase 4 of v0.6)`

## Phase 5 — Release v0.6.0 + Rocky smoke

- [ ] Bump `apps/server` + `apps/web` package.json 0.5.0 → 0.6.0 (no migration)
- [ ] Update README + README_zh-TW (mark v0.6.0 shipped) + roadmap memory
- [ ] Release commit: `release(v0.6.0): toolbox module`
- [ ] Build tarball + scp via `scripts/deploy-rocky.sh`; deploy to Rocky 234
- [ ] Smoke S1–S5 (record in `smoke-pass.md`): boot tools-present / boot tool-absent / NTP round-trip / fail2ban list+unban / journald vacuum + docker prune
- [ ] Mark meta.json `status: completed` + `smokeStatus`
