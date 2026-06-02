# v0.6 — Toolbox (OS host tools)

**Status:** ready (2026-06-02, awaiting Phase 0 kick-off)
**Target:** v0.6.0
**Depends on:** v0.5-databases-backups (the entire v0.5 line + v0.5.2 security patches)
**Origin:** 1Panel ships a "Toolbox" (工具箱) of host-level OS utilities.
DinoPanel has the supporting plumbing (firewall CLI-wrapping pattern, the
`/ws/metrics` host snapshot, the scheduler, the files-module write guards)
but no Toolbox module. This is the next roadmap chapter after databases +
backups, and the safest one to ship: it is a near-verbatim clone of the
already-shipped, already-smoke-tested **firewall** pattern.

## Problem

An operator running DinoPanel on a host still drops to a shell for routine
OS chores the panel could own safely:

1. **Time** — is NTP synced? set the timezone? (drift breaks TLS, logs, cron).
2. **Intrusion response** — inspect / manage Fail2Ban jails and bans
   (today only a partial read path exists, buried in the firewall module).
3. **Disk pressure** — what's eating the disk, and a safe way to reclaim it
   (journald, package caches, dangling docker layers, `/tmp`).

These are exactly the "I SSH in to run four commands" tasks a panel exists to
remove. The roadmap pinned v0.6 as Toolbox + MFA + Passkey, but those are three
different domains; this change ships the **Toolbox slice only** — the safe,
fully-smoke-testable subset. MFA → v0.7.0, Passkey is blocked on a TLS
deployment (WebAuthn needs a secure context; the only deploy target is
`http://192.168.199.234:9999`, HTTP-over-IP, so passkeys cannot even be
smoke-tested there).

## Why this is low-risk

- **Architecture is a proven clone.** The firewall module already does
  `which()`-probe → driver → `Unavailable*Driver` 503 fallback → spawn-based
  `runCommand` wrapper. The Toolbox copies it verbatim, so the panel still
  boots cleanly when a host tool is absent.
- **Two of three features are largely built / free.** Fail2Ban is ~70% done
  inside `firewall.service.ts` (`probeFail2ban` / `fail2banBanned` /
  `fail2banUnban` + live `/firewall/fail2ban/*` routes). Disk usage already
  flows through the `/ws/metrics` `fsSize` snapshot. v0.6.0 mostly adds thin,
  reversible action wrappers.
- **NTP is the best value-to-effort item** — one systemd front-end
  (`timedatectl`) present on both Rocky 9 and Debian, fully reversible.

## Scope

**In (v0.6.0):**

- **NTP / time-sync tab** — `ntp-driver.ts` behind `which('timedatectl')` with
  an `UnavailableNtpDriver` → 503 `{code:'NTP_NOT_CONFIGURED'}`. `GET` status
  (parse `timedatectl status`: NTP synchronized / active sync service /
  timezone), `POST` set-ntp `true|false`, `POST` set-timezone validated
  against `timedatectl list-timezones`, optional `chronyc` tracking detail
  when `which('chronyc')`. Fully reversible → plain confirm dialog.
- **Fail2Ban tab — EXTEND `firewall.service.ts` in place, do NOT re-home.**
  Add jail enable/disable, ban-add, and a read-only jail/config list alongside
  the existing banned/unban; reuse `probeFail2ban()` for availability. The
  Toolbox "Fail2Ban" tab is a **view onto the firewall service** — no route
  migration, no web-caller breakage.
- **Disk-usage view** — read-only hot-spot view reusing the existing
  `/ws/metrics` `fsSize` snapshot + `du -x -d1` / `df` for per-directory
  breakdown. No new host write capability.
- **Curated / owned-target disk cleaners ONLY** (category enum, never a free
  path): journald vacuum (`journalctl --vacuum-size/--vacuum-time`),
  package-cache clean (`dnf clean all` on Rocky / `apt-get clean` on Debian via
  driver branch), docker system prune (reusing the `ContainersModule`
  dockerode handle). The **only** path-taking cleaner — a `/tmp` + old-log
  sweep — is gated by the files-module `assertWritable` + `DANGEROUS_WRITE_PATHS`
  allowlist; the path-less tool-owned cleaners are guarded by the closed
  category enum itself.
- **Phase 0 contracts:** lift `firewall/drivers/run-command.ts` →
  `common/shell/run-command.ts` (generic `CommandError`, string-union code,
  `ENOENT→TOOL_MISSING`, permission-denied→`PERMISSION_DENIED`); establish the
  service-layer `instanceof CommandError → HttpException({code})` re-wrap
  standard and **backfill it into `firewall.service`** (closes the verified
  opaque-500 gap — see decisions D-bug). Add `TOOLBOX_REQUIRE_SUDO` env +
  `sudo('-n')` wrapper + non-throwing `OnApplicationBootstrap` probe.
  `GET /toolbox/status` → `{features:[{name,available,degraded,reason}]}`.
- **Toolbox NestJS module** — `toolbox.module.ts` + `toolbox.controller.ts`
  (`@Controller('toolbox')`, `ZodValidationPipe`, `HttpException` with `{code}`)
  + `toolbox.service.ts`, `drivers/` (one per feature + the lifted run-command),
  `__tests__/` (service + module-bootstrap + per-driver golden-string parser
  tests). One import line + one `imports[]` entry in `app.module.ts`.
- **Shared schemas** — `packages/shared/src/schemas/toolbox.ts` (schema-const +
  `z.infer` pairs, `.js` inter-file imports) re-exported from `schemas/index.ts`;
  explicit shared `dist/` rebuild so server + web consume compiled output.
- **Web Toolbox UI** — `routes/toolbox/index.tsx` Tabs shell cloning
  `routes/system/index.tsx`; per-tab files (ntp / fail2ban / disk) lazy +
  Suspense; `/toolbox/*` splat route + named-export unwrap in `App.tsx`; one
  sidebar entry (Wrench icon, `nav.toolbox`); `use-toolbox.ts` react-query hooks
  with a `toolboxKeys` factory invalidating `.all` on mutate; `extractErrorMessage`
  + sonner toasts; status Badge + a "not configured on this host" Card keyed off
  the `*_NOT_CONFIGURED` code; type-to-confirm Dialog for cleaner actions.
- **i18n** — top-level `toolbox` namespace + `nav.toolbox` in BOTH `zh-TW.json`
  and `en.json` (zh-TW is `fallbackLng`, must be complete); parity check.
- **Docs + sudoers contract** — `docs/toolbox.md` documenting the single
  consolidated NOPASSWD `Cmnd_Alias` (timedatectl, fail2ban-client,
  journalctl --vacuum, dnf/apt clean) mirroring `docs/websites.md`; add the
  sudoers snippet to `install.sh` / `deploy-rocky.sh`.
- **Release** — bump `apps/server` + `apps/web` package.json 0.5.0 → 0.6.0,
  README + roadmap memory update, release commit; deploy to Rocky 234 and run
  smoke S1–S5.

**Out (deferred — recorded with target versions):**

- **Swap WRITE management** (create swapfile via `fallocate`+`mkswap`, swapon,
  swapoff, resize, `/etc/fstab` persistence) → **v0.6.1**. Read-state is already
  free via `/ws/metrics`, but the write side is HIGH risk (swapoff can OOM-kill
  the panel, bad fallocate fills the disk, fstab edits affect boot) and needs
  the full firewall-style stage / confirm / 30 s auto-revert guardrail — its own
  phase of work.
- **Supervisor management** (supervisorctl + program `.ini` CRUD) → **v0.6.1**.
  MEDIUM risk + real distro variance (Rocky `/etc/supervisord.d/*.ini` via
  pip/EPEL vs Debian `/etc/supervisor/conf.d/*.conf` via apt), niche audience,
  config-write injection surface — lowest value-to-effort.
- **Arbitrary-path / age-based file deleter** ("delete files older than N days
  in path X") → **OMITTED INDEFINITELY**, not merely deferred. Too dangerous as
  root; replaced entirely by the curated category cleaners.
- **MFA (TOTP)** → **v0.7.0** (Account Security chapter). Self-contained auth
  epic: two-phase login contract, a net-new AES-256-GCM `SecretsService`
  (none exists; `db_instances.password` is still plaintext), bcrypt recovery
  codes, session revocation, global `JwtAuthGuard` rejecting a `{mfa:'pending'}`
  claim, migration. Build the CLI escape hatch (`scripts/disable-mfa`) FIRST.
- **Passkey / WebAuthn** → **BLOCKED on TLS** (v0.7+). Needs a stable rpID +
  expectedOrigin + secure context; the Rocky box is HTTP-over-IP so passkeys
  cannot even be smoke-tested. Build on the same two-phase login contract from
  v0.7.0 so it slots in with near-zero rework once a TLS domain exists.
- **Recurring scheduled disk-cleanup TaskRunner** → follow-up. A scheduler task
  type requires the verified three-file lockstep + a migration. v0.6.0 ships
  on-demand cleaners only — stateless, no migration.

## Phases (~17 dev-days, inside the ~3-week pin)

| Phase | Name | Est |
|---|---|---|
| 0 | Activation + shared shell/privilege contracts (+ backfill firewall opaque-500 fix) | 2 d |
| 1 | NTP / time-sync — module skeleton end-to-end | 2.5 d |
| 2 | Fail2Ban (extend in place) + disk usage / curated cleaners (server) | 4 d |
| 3 | Web Toolbox UI (tabs, hooks, i18n) | 3.5 d |
| 4 | Hardening, guardrail tests, sudoers + docs, shared rebuild | 2.5 d |
| 5 | Release v0.6.0 + Rocky 234 smoke S1–S5 | 2.5 d |

See `decisions.md` for the seven load-bearing decisions, `spec.md` for the
per-phase acceptance gates, and `tasks.md` for the implementation checklist.
