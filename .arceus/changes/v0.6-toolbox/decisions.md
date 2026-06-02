# Decisions — v0.6 Toolbox

Seven load-bearing decisions. D1–D7 below are adopted at the **recommended
default** the planning workflow synthesized (operator said "proceed"); each is
still confirmable / revisable before Phase 1 kick-off. D-bug is a verified
engineering fact, not a preference.

## D1 — Scope = Toolbox slice only

**Decision:** v0.6.0 ships NTP + Fail2Ban (extend in-place) + disk-usage +
curated cleaners. **Defer** Swap-write → v0.6.1, Supervisor → v0.6.1,
MFA → v0.7.0, Passkey → TLS-gated (v0.7+).

**Why:** Swap-write/Supervisor carry the heaviest guardrail + distro-variance
cost; MFA is a self-contained auth epic with lockout risk; Passkey is verified
un-smoke-testable on HTTP-over-IP. The recommended cut is the highest
value-to-effort, lowest-blast-radius, fully-testable slice and fits ~17 days
inside the ~3-week pin.

**Alternatives rejected:** (a) add TOTP MFA now (+8–9 d, busts the pin, lockout
risk); (b) add Swap-write now (+4 d, needs the stage/confirm guardrail).

## D2 — Disk cleanup = curated owned-target categories only

**Decision:** journald vacuum, dnf/apt cache clean, docker prune, `/tmp` sweep.
**No** arbitrary path+age deleter.

**Why:** An arbitrary-path deleter running as root is the single
highest-severity risk in the module. The curated set delivers most of the value
with the **tool** owning the target. Only the `/tmp` sweep takes a path and is
gated by the verified files-module `assertWritable` + `DANGEROUS_WRITE_PATHS`
allowlist; the path-less cleaners are gated by a **closed category enum**.

**Correction (verified):** do NOT claim "all cleaners are backstopped by
`DANGEROUS_WRITE_PATHS`" — that allowlist takes a resolved filesystem path and
is a poor fit for path-less tools (`journalctl --vacuum`, `dnf clean`,
`docker prune`). Their guard is the enum; only the `/tmp` sweep uses the
allowlist.

## D3 — Fail2Ban: extend in place under the firewall module

**Decision:** Extend `firewall.service.ts`; the Toolbox Fail2Ban tab is a view
onto the firewall service. Do NOT re-home into the new toolbox module.

**Why:** Verified ~70% already built inside `firewall.service.ts`
(`probeFail2ban` / `fail2banBanned` / `fail2banUnban`) with live
`/firewall/fail2ban/*` routes consumed by the web. Relocating risks breaking
those endpoints for a purely cosmetic grouping win.

**Caveat (verified):** the existing fail2ban calls run bare `spawn` with no
sudo wrapper, so on the non-root operator path they currently throw →
generic 500. "Extend in place" therefore **also** means retrofitting the D-bug
re-wrap + the D4 sudo posture onto the existing fail2ban code — budgeted in
Phase 0/2.

## D4 — Privilege: single env + one consolidated sudoers alias

**Decision:** one `TOOLBOX_REQUIRE_SUDO` env (mirror the verified
`WEBSITES_REQUIRE_SUDO` `z.enum(['true','false']).default('true').transform`
shape) + one consolidated NOPASSWD `Cmnd_Alias` (timedatectl, fail2ban-client,
journalctl --vacuum, dnf/apt clean). All mutating commands go through a
`sudo('-n', …)` wrapper + a non-throwing boot probe (the verified nginx model).

**Why:** A single alias is simpler to document and audit. The non-root Rocky
operator (`mike`, sudo gateway) needs the `sudo -n` + degraded posture or
mutating commands surface as opaque failures.

**Alternative rejected:** per-feature `*_REQUIRE_SUDO` knobs + separate aliases
(more config surface, no benefit); prod-root-only with no sudo wrapper (matches
firewall today but breaks the non-root operator path).

## D5 — Persistence: stateless for v0.6.0

**Decision:** No new drizzle table, no migration, no scheduler task type.
Live-host querying only; cleaners are on-demand controller endpoints.

**Why:** A table forces a drizzle migration; a recurring cleaner additionally
forces the verified three-file scheduler lockstep (`scheduledTaskTypeSchema` +
`userFacingTaskTypeSchema` in `shared/schemas/scheduler.ts`, payload schema,
`scheduled_tasks.type` enum in `database/schema.ts`) + `validateTypePayload` +
a migration. Staying stateless keeps the slice reversible and on-rhythm.

**Re-evaluate:** when recurring cleanup or a cleanup audit log is requested —
then add the table + scheduler type as a scoped follow-up.

## D6 — UI placement: new top-level `/toolbox/*` route

**Decision:** New top-level `/toolbox/*` splat route + sidebar entry (Wrench),
internal tabs, cloning `routes/system/index.tsx`.

**Why:** The `/system` precedent is splat+tabs; a dedicated top-level Toolbox
route reads cleaner for a growing feature set (Swap/Supervisor arrive in
v0.6.x). One sidebar entry is cheap; cloning the system shell makes it near-free.

**Alternative rejected:** a 5th tab inside `/system/*` (crowds an unrelated
shell, awkward as the feature set grows).

## D7 — MFA escape hatch first (a v0.7.0 gate, recorded now)

**Decision:** When MFA lands in v0.7.0, ship + test `scripts/disable-mfa` (CLI
escape hatch, cloning the idempotent better-sqlite3 seed pattern) **before** the
MFA endpoints, as a hard gate.

**Why:** The product is verified single-admin (no signup; seeded via install.sh
inline bcrypt INSERT). A lost TOTP device + lost recovery codes = permanent
lockout with no admin-recovery UI. Recorded now so it isn't forgotten.

---

## Phase-2 adjustments (decided during implementation, from research findings)

**P2-a — `tmp_sweep` dropped from the cleaner set.** The proposal listed a
`/tmp` sweep gated by `assertWritable` + `DANGEROUS_WRITE_PATHS`. Research
disproved the premise: `DANGEROUS_WRITE_PATHS` is a **deny-list** (system roots)
and `/tmp` is not in it, so it cannot *confine* a sweep — it only blocks
`/etc`, `/var`, etc. A blanket `/tmp` wipe running as root would also delete
active sockets / lock files / `systemd-private-*` dirs and can break running
services, while an age-based deleter is the very thing D2 already excluded as
too dangerous. So v0.6.0 ships **only tool-owned cleaners** (journald,
package_cache, docker_prune) — each cleaner's tool owns its targets, the clean
body is a pure closed enum with no path input, and the toolbox module needs no
FilesModule import. A safe `/tmp` policy (age + ownership) can be revisited
later.

**P2-b — `docker_prune` = containers + dangling images only, no volumes.**
`docker system prune` does not touch volumes without `--volumes`, and
`pruneVolumes()` can delete data volumes not attached to a running container.
Pruning is limited to stopped containers + dangling images to match CLI
semantics and avoid data loss.

**P2-c — Fail2Ban reuses `TOOLBOX_REQUIRE_SUDO`** (not a new
`FIREWALL_REQUIRE_SUDO`) for the `sudo -n` posture on `fail2ban-client` calls,
to avoid env-var sprawl. `fail2banSetJailEnabled` is a **runtime** start/stop
toggle (fail2ban has no persistent enable/disable verb); it does not survive a
daemon reload and the jail must already be defined in config.

## Phase-3 adjustment (decided during implementation, from review findings)

**P3-a — the fail2ban jail enable/disable toggle is NOT exposed in the UI.**
The backend `fail2banJails()` enumerates only the *running* "Jail list" and
`parseFail2banJailDetail` hard-codes `enabled: true`, so every listed jail is
active. A UI toggle would therefore: (1) have dead "inactive/enable" branches,
and (2) on "disable" run `fail2ban-client stop <jail>`, after which the jail
vanishes from the running list with **no in-product re-enable path** (re-enable
needs the jail to be listed, which a stopped jail isn't). Listing
configured-but-stopped jails would require parsing `/etc/fail2ban/*.local`,
which Phase 2 deliberately avoided. So the fail2ban tab ships the unambiguous,
high-value ops only — read-only jail list (counters + banned IPs), manual ban,
per-IP unban — and shows a static "running" badge. The backend
`fail2banSetJailEnabled` endpoint + `useFail2banSetJailEnabled` hook remain
(tested, valid runtime op) but are not surfaced; a future iteration can add the
toggle once configured-jail listing exists.

## D-bug — The firewall opaque-500 fix (verified, not a preference)

The Phase 0 "opaque-500 fix" is **not** in `run-command.ts` internals — those
already map `ENOENT → FIREWALL_TOOL_MISSING` and permission-denied →
`FIREWALL_PERMISSION_DENIED`. The actual gap: `FirewallCommandError extends
Error` (not `HttpException`), and `ApiExceptionFilter`
(`common/filters/api-exception.filter.ts`) only honors a `code` field on
`HttpException` — every other `Error` becomes a generic 500. The fix is a
one-pattern service-layer `instanceof CommandError → HttpException({code})`
re-wrap (the verified nginx `sites.service.ts` convention), plus lifting
`run-command.ts` to `common/shell/`. This is why Phase 0 is 2 days, not 3 —
it is a small re-wrap + a generic move, not a heavy refactor.
