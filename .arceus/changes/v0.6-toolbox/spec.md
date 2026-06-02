# Spec — v0.6 Toolbox

Acceptance criteria gating each phase. Every gate also requires: typecheck
pass, lint pass, new + existing tests pass, build pass. v0.6.0 adds **no**
drizzle migration (stateless — D5).

## Phase 0 — Activation + shared shell/privilege contracts

- `common/shell/run-command.ts` exists: `spawn` (args-array, no shell), timeout,
  `ENOENT → TOOL_MISSING`, permission-denied/operation-not-permitted →
  `PERMISSION_DENIED`, with a generic `CommandError` carrying a string-union
  `code`. Behaviour parity with the old `firewall/drivers/run-command.ts`.
- `firewall` migrated onto `common/shell/run-command.ts` (no behaviour change;
  its existing tests still pass).
- Service-layer standard established and **backfilled into `firewall.service`**:
  `catch (e) { if (e instanceof CommandError) throw new HttpException({code,message}, status) }`
  so `ApiExceptionFilter` emits a real `code` instead of a generic 500
  (closes the D-bug gap). A regression test proves a driver `TOOL_MISSING`
  surfaces as a coded HTTP error, not a bare 500.
- `TOOLBOX_REQUIRE_SUDO` added to `env.schema.ts` mirroring the
  `WEBSITES_REQUIRE_SUDO` enum/transform shape.
- A `sudo('-n', …)` wrapper + a non-throwing `OnApplicationBootstrap` probe
  pattern is in place (nginx model). No feature behaviour yet.
- `.arceus/changes/v0.6-toolbox/` proposal/decisions/spec/tasks/meta committed;
  decisions D1–D7 resolved.

## Phase 1 — NTP / time-sync (module skeleton end-to-end)

- `ToolboxModule` + `ToolboxController` (`@Controller('toolbox')`) +
  `ToolboxService` scaffolded and registered in `app.module.ts`.
- `ntp-driver.ts` behind `which('timedatectl')`; an `UnavailableNtpDriver`
  throws 503 `{code:'NTP_NOT_CONFIGURED'}` when the binary is absent.
- `GET /toolbox/ntp` parses `timedatectl status`: `{ntpSynchronized,
  activeSyncService, timezone, ...}`. `GET /toolbox/status` lists feature
  availability `[{name,available,degraded,reason}]`.
- `POST /toolbox/ntp/set` toggles NTP `true|false`.
- `POST /toolbox/ntp/timezone` validates the requested zone against
  `timedatectl list-timezones`; rejects an unknown zone with a coded 4xx
  before shelling out.
- Optional `chronyc` tracking/sources detail returned when `which('chronyc')`.
- Shared schema in `packages/shared/src/schemas/toolbox.ts` (NTP status +
  request bodies); re-exported from `schemas/index.ts`.
- Per-driver golden-string parser tests against captured `timedatectl status` /
  `list-timezones` output; service + module-bootstrap tests with `vi.fn` mocks
  (backups per-concern style). All host commands go through the sudo wrapper +
  CommandError → HttpException re-wrap.

## Phase 2 — Fail2Ban (extend in place) + disk usage / cleaners (server)

### Fail2Ban (in `firewall` module)

- Existing `probeFail2ban` / `fail2banBanned` / `fail2banUnban` retrofitted
  onto the D4 sudo wrapper + D-bug re-wrap (no longer bare-500 on the non-root
  path).
- New: jail enable/disable, ban-add, read-only jail/config list. Availability
  still surfaced via `probeFail2ban()`.
- `/firewall/fail2ban/*` routes and the existing web caller remain unbroken.

### Disk usage + cleaners (in `toolbox` module)

- `GET /toolbox/disk` returns a read-only usage view: the `/ws/metrics`
  `fsSize` snapshot (`MetricsSnapshot.disks[]`) + a `du -x -d1` / `df`
  per-directory breakdown.
- `POST /toolbox/disk/clean` takes a **category enum** only —
  `journald | package_cache | docker_prune | tmp_sweep`. No free path field.
  - `journald` → `journalctl --vacuum-size=…`/`--vacuum-time=…`.
  - `package_cache` → `dnf clean all` (Rocky) / `apt-get clean` (Debian),
    branched in the driver on detected package manager.
  - `docker_prune` → `docker system prune` via the `ContainersModule` dockerode
    handle (not a shell-out).
  - `tmp_sweep` → the ONLY path-taking cleaner; every target resolved through
    the files-module `assertWritable` + `DANGEROUS_WRITE_PATHS` allowlist; an
    out-of-allowlist target is refused with a coded 4xx.
- Each feature `which()`-probes its binary and degrades to 503
  `{code:'*_NOT_CONFIGURED'}` when absent (the Rocky-without-fail2ban /
  no-docker path).
- Per-feature driver + parser tests.

## Phase 3 — Web Toolbox UI

- `routes/toolbox/index.tsx` Tabs shell (`useLocation` + `pickTab`,
  lazy + Suspense per tab) cloning `routes/system/index.tsx`.
- Per-tab files: `ntp`, `fail2ban`, `disk`. `/toolbox/*` splat route + named-
  export unwrap registered in `App.tsx`. One sidebar entry (Wrench,
  `nav.toolbox`).
- `use-toolbox.ts` react-query hooks with a `toolboxKeys` factory; mutations
  invalidate `toolboxKeys.all`. `extractErrorMessage` + sonner toasts.
- A status `Badge` + a "not configured on this host" `Card` rendered when the
  API returns a `*_NOT_CONFIGURED` code (never a crash / blank tab).
- Disk-cleaner actions use the type-to-confirm `Dialog`.
- All DTO types imported from `@dinopanel/shared`.

## Phase 4 — Hardening, guardrail tests, sudoers + docs

- Negative-path / guardrail tests: `tmp_sweep` refuses an out-of-allowlist
  target; `set-timezone` rejects an invalid zone; **every** feature degrades to
  503/degraded when its binary is absent.
- `docs/toolbox.md` with the consolidated NOPASSWD `Cmnd_Alias` (timedatectl,
  fail2ban-client, journalctl --vacuum, dnf/apt clean) mirroring
  `docs/websites.md`.
- Sudoers snippet added to `install.sh` / `deploy-rocky.sh`.
- Explicit `packages/shared` rebuild so web + server see `toolbox` types.
- i18n parity check: every `toolbox.*` + `nav.toolbox` key present in BOTH
  `zh-TW.json` and `en.json`.

## Phase 5 — Release v0.6.0 + Rocky smoke

- `apps/server` + `apps/web` package.json bumped 0.5.0 → 0.6.0 (NO migration).
- README + roadmap memory updated; release commit cut.
- Tarball built + scp'd via `scripts/deploy-rocky.sh`; deployed to Rocky 234.
- Smoke (record evidence in `smoke-pass.md`):
  - **S1** panel boots with tools present.
  - **S2** panel boots with a tool ABSENT (degraded/503 path, not a crash).
  - **S3** NTP status read + timezone set round-trip.
  - **S4** Fail2Ban banned-list + unban.
  - **S5** journald vacuum + docker prune dry confirmation.
- S-swap / S-supervisor / S-MFA explicitly out of scope this cut; recorded as
  v0.6.1 / v0.7.0 follow-ups.
