# v0.3 — Task Checklist (draft)

Five phases. Foundations first, then user-facing features layer by
layer. ACME lands after the static + reverse-proxy plumbing because
the issuance code wants real conf files to validate against, not
synthetic test fixtures.

References: `proposal.md` (scope + decisions), `decisions.md`
(answers to Q1–Q5 with rationale), `spec.md` (endpoint / schema /
file-path detail).

## Phase 1 — Foundation ✅ (2026-05-18)

Nothing user-visible ships in Phase 1. The point is to get every
cross-cutting bit in place — DB schema, shared types, module
skeletons, nginx I/O wrapper, bootstrap idempotency — so Phases
2–5 can each be a self-contained vertical slice.

Mirrors how v0.5 Phase 1 worked (`firewall_rule_meta` /
`scheduled_tasks` / `operation_log` all landed in Phase 1 even
though nothing read or wrote them yet).

- [x] `drizzle` schema additions: `sites`, `acme_accounts`,
  `acme_orders` *(apps/server/src/database/schema.ts)*
- [x] Migration generated via `pnpm db:generate` →
  `drizzle/0003_curvy_skaar.sql`
- [x] `packages/shared/src/schemas/websites.ts`:
  - `domainSchema`, `upstreamUrlSchema`, `siteNameSchema`,
    `siteTypeSchema`
  - `staticSitePayloadSchema`, `reverseProxyPayloadSchema`,
    `phpPayloadSchema` (PHP schema declared up front so the
    surface is stable from Phase 1)
  - `sitePayloadSchema` discriminated union, `siteCreateSchema`,
    `sitePatchSchema`, `siteResponseSchema`, `siteCertInfoSchema`,
    `reconcileResponseSchema`
- [x] `packages/shared/src/schemas/acme.ts`:
  - `acmeChallengeSchema`, `acmeDnsProviderSchema`,
    `acmeOrderStatusSchema`
  - `acmeIssueRequestSchema` (refine: `dns-01` requires
    `dnsProvider`), `acmeStatusResponseSchema`,
    `acmeOrderResponseSchema`
  - (renamed from `acmeOrder` → `acmeOrderResponse` to avoid
    clashing with the drizzle row type also named `AcmeOrder`)
- [x] Re-exported both from `packages/shared/src/schemas/index.ts`
- [x] **`WebsitesModule` skeleton** (`apps/server/src/modules/websites/`):
  - `websites.module.ts`, `websites.service.ts` (stub `list()` +
    real bootstrap)
  - `paths.ts` — `resolveWebsitesPaths()` + `assertSafeSiteName()`
    (the defense-in-depth gate before fs/shell)
  - `nginx.service.ts` — full implementation (path resolver +
    `validate()` + `reload()` + sudoers probe via `sudo -n`)
  - `conf-renderer.ts` — `static` + `reverse_proxy` templates;
    `php` throws `NotImplementedYetError` (Phase 3)
  - `websites.controller.ts` — endpoints declared, mutating
    bodies throw `NOT_IMPLEMENTED_YET` with `phase: 2`
- [x] **`AcmeModule` skeleton** (`apps/server/src/modules/acme/`):
  - `acme.module.ts` with `imports: [SchedulerModule,
    WebsitesModule]` so Phase 4 inherits them
  - `acme-account.service.ts`, `acme-orchestrator.service.ts`,
    `acme.controller.ts` — all stubs throwing `NOT_IMPLEMENTED_YET`
    with `phase: 4`
  - **Added `acme-client@^5` to `apps/server/package.json`**;
    `pnpm install` succeeded, lockfile updated. Pure-Node — no
    native dep that would risk the `cdb182b` release-pipeline
    regression
- [x] **Bootstrap (idempotent)** in `WebsitesService.onApplicationBootstrap()`:
  - `fs.mkdir({ recursive: true })` for the six paths under
    `WEBSITES_ROOT` (`sites/`, `nginx/conf.d/`, `acme/`,
    `acme/certs/`, `acme/.well-known/acme-challenge/`). 0700 on
    `acme/`, 0755 on the rest. Tolerant `chmod` to tighten if dir
    pre-existed wider.
  - Writes `WEBSITES_NGINX_INCLUDE_PATH` (default
    `/etc/nginx/conf.d/00-dinopanel.conf`) containing the single
    `include <WEBSITES_ROOT>/nginx/conf.d/*.conf;` directive.
    Overwrites on every boot (idempotent — same bytes).
  - On failure: writes
    `settings['websites.bootstrap_failed']` with `{ at, reason }`,
    pino.error, but does **not** rethrow.
  - On success: removes the degraded flag.
  - Reconciliation scan **deferred to Phase 2** (Phase 1's DB is
    empty so there's nothing meaningful to reconcile).
- [x] **Sudoers + SELinux + AppArmor contract** documented in
  `docs/websites.md` (full draft — Phase 5 polishes if needed).
  Three env vars added (`WEBSITES_ROOT`,
  `WEBSITES_NGINX_INCLUDE_PATH`, `WEBSITES_REQUIRE_SUDO`).
- [x] **Sudo probe at boot** via `NginxService.probeSudo()`. Runs
  `sudo -n nginx -t`; result feeds `NginxService.isSudoOk()`. When
  `WEBSITES_REQUIRE_SUDO=true` and probe fails, logs a clear
  warning pointing at the docs. **Never crashes the app.**
- [x] **Unit tests** — 17 new cases (planned 13; expanded the
  path-safety probes from 6 → 8 and added the 2 conf-renderer
  schema-rejection cases that prove the injection guardrails):
  - `__tests__/nginx-paths.test.ts` — 8 cases
    (`resolveWebsitesPaths` 2 + `assertSafeSiteName` 6: accept
    safe names, reject separators/NUL, reject `..`, reject
    leading dot/dash, reject empty/over-length, reject
    uppercase/spaces/shell-metachars)
  - `__tests__/conf-renderer.test.ts` — 6 cases (static golden 1 +
    reverse-proxy 2 + PHP stub raises 1 + schema rejects domain
    injection 1 + schema rejects non-http upstream 1)
  - `__tests__/bootstrap.test.ts` — 3 cases (idempotent mkdir,
    nginx-include content, degraded flag on failure)
- [x] `app.module.ts` registers `WebsitesModule` + `AcmeModule`
  after `LogsModule`, before `AuditModule`

**Verification gates passed**: typecheck ✅ (0 errors) · lint ✅
(0 errors, 0 warnings) · test **147/147** ✅ (130 → 147, +17 new
Phase-1 cases) · server build ✅ · web build ✅ (main bundle gzip
110.11 kB, well under 140 kB budget; zero web code added in
Phase 1, the +1 kB drift vs the v0.5.1 baseline is unrelated
work).

### Phase 1 deviation log

- **`acmeOrderResponseSchema`** renamed from the spec's
  `acmeOrderSchema` so the inferred type doesn't collide with the
  drizzle `AcmeOrder` row type exported from `schema.ts`. Matches
  the firewall pattern (`FirewallRule` vs `FirewallRuleMeta`).
- **Reconciliation scan** moved from Phase 1 to Phase 2. Phase 1's
  DB starts empty, so the scan would have no rows to surface as
  orphaned and no pre-existing files to import. Keeping the
  implementation alongside the rest of `SitesService.create /
  update / delete` in Phase 2 keeps the file-vs-DB invariant
  reasoning in one place.
- **`paths.ts` factored out** of `nginx.service.ts`. Spec implied
  the path resolver lives inside the service; splitting it lets
  the renderer and bootstrap tests exercise the safety gate
  without instantiating Nest DI. No behavior change.

## Phase 2 — Static sites + reverse proxy (REST + reconciliation) ✅ (2026-05-19)

First user-visible value path. After this phase, an operator can
hit the API to create a static site or reverse proxy and serve
plain HTTP. SSL still requires Phase 4.

- [x] `SitesService.create / update / remove` — full implementation
  with the atomic conf-write + validate + reload + metadata-upsert
  flow from spec.md §1. (`remove` not `delete` to avoid the JS
  reserved-word footgun for IDE autocomplete; controller routes
  `DELETE /api/websites/:id` to it.)
- [x] `SitesService.reconcile` — orphan flag flips both ways (DB
  row marked orphaned when conf disappears, cleared when conf
  reappears from a backup). External (non-DinoPanel) conf files
  are counted and logged but **not** imported as DB rows — see
  deviation log below.
- [x] `WebsitesController` — `GET / POST / PATCH / DELETE
  /api/websites`, `POST /api/websites/reconcile`,
  `GET /api/websites/:id/conf`, plus `GET /api/websites/status`
  for the degraded-bootstrap flag. Auth is global via
  `APP_GUARD: JwtAuthGuard` so no per-route `@UseGuards` needed.
- [x] **Conf rollback on validate failure**: copy `current →
  current.bak`, write `current.tmp` → `fs.rename` to `current`,
  `nginx -t`; on fail `fs.rename current.bak → current` and
  best-effort reload to put nginx back on the known-good config.
  Verified end-to-end by the `update() — validate failure` test.
- [x] **Pre-create conflict guards**: rejects `SITE_NAME_TAKEN`
  (DB row exists) and `SITE_CONF_PATH_TAKEN` (file at the conf
  path with no DB row — likely an external conf the operator
  doesn't want silently clobbered).
- [x] **`ensureSiteContentDir`**: static + PHP sites auto-mkdir
  `<siteRoot>/public/` so a freshly-created static site has a
  content directory ready for `/api/files` uploads. Reverse-proxy
  sites skip this — they don't have a content root.
- [x] Unit tests: **10 new cases** (planned 10 from spec.md):
  - `__tests__/sites.service.test.ts` — 6 cases (create happy
    path, duplicate-name conflict, validate-failure rollback,
    update happy path, update validate-failure restores backup,
    remove drops conf + reloads + drops row)
  - `__tests__/reconcile.test.ts` — 4 cases (empty,
    no-divergence, file-missing-marks-orphaned, external-conf-not-imported)
- [ ] **`e2e/websites-create-static.spec.ts`** — deferred. Spec
  proposes running against a real local nginx via `--add-host`;
  the dev sandbox doesn't have host nginx with sudoers configured,
  and a CI container that does would balloon the playwright
  config. Lands with Phase 5 manual smoke on Rocky 9.4 instead.
- [ ] **`e2e/websites-reverse-proxy.spec.ts`** — same deferral as
  above.

**Verification gates passed**: typecheck ✅ (0 errors) · lint ✅
(0 errors, 0 warnings) · test **157/157** ✅ (147 → 157, +10
Phase-2 cases) · server build ✅ · web build ✅ (main bundle gzip
110.11 kB unchanged).

### Phase 2 deviation log

- **External conf import is deferred to Phase 5**. The spec said
  "for each file with no metadata row, insert one with
  `managed_by_dinopanel: false`", but the schema requires
  non-null `type`, `payload`, and `primary_domain` — fields that
  don't have honest values for an externally-managed conf. Phase
  2 instead counts external confs (logged at warn level via
  `sites.reconcile.external_confs_seen`) and leaves the DB
  untouched. Phase 5 can revisit once the response schema gains
  a managed/external discriminator (option sketched in the
  spec.md commentary section).
- **`SitesService.remove` not `delete`** — `delete` is a reserved
  word in older JS toolchains and some IDEs misautocomplete it.
  Cosmetic. The HTTP verb is still `DELETE /api/websites/:id`.
- **`SiteResponse.id` stays non-null in Phase 2** — only managed
  rows ever flow through `list()`, so the schema doesn't need
  loosening yet. Phase 5 revisits when the UI gets the merged
  list.
- **`acmeOrderResponseSchema`** already noted in Phase 1.

## Phase 3 — PHP site type

PHP-FPM coordination. Light phase; can land in parallel with Phase 4
if a second developer is on it.

- [ ] PHP-FPM container template (managed by v0.2 containers
  module) — provisioned on first PHP-site create, reused for all
  subsequent ones.
- [ ] `ConfRenderer` PHP template: `fastcgi_pass unix:<sock>;` with
  the standard `fastcgi_params` includes. Renderer's
  `NOT_IMPLEMENTED_YET` from Phase 1 is replaced here.
- [ ] PHP-flavored conf renderer tests (the 3 cases held back in
  Phase 1).
- [ ] Documented PHP version selection (one default in v0.3 —
  PHP 8.3 — others deferred until there's demand).

## Phase 4 — ACME (HTTP-01 + Cloudflare DNS-01 + auto-renew)

The riskiest phase — wire end-to-end against pebble first, then
production Let's Encrypt staging, then prod.

- [ ] `AcmeAccountService` — full implementation, account key
  encrypted via existing `SecretsService` (v0.2.1 pattern).
- [ ] `Http01Challenger` — full implementation. Verify the
  `location /.well-known/acme-challenge/` block is rendered into
  every conf (added unconditionally in `conf-renderer.ts` at
  Phase 2 time; this phase only consumes it).
- [ ] `CloudflareDns01Challenger` — full implementation, CF API
  token via `SecretsService` key `acme.cloudflare.api_token`.
  Settings UI gains a "Cloudflare API token" input under a new
  "SSL providers" section (Phase 5 frontend work).
- [ ] `IssueOrchestrator.issue / renew` — orchestrates account +
  challenge + write cert files + update `sites.cert_*` + reload
  nginx. Writes one `acme_orders` row per attempt.
- [ ] `/api/websites/:id/ssl/{issue,renew,status}` endpoints.
- [ ] **Scheduler integration**: register
  `system.acme_renew` as a v0.5 builtin task on boot (idempotent
  SELECT-then-INSERT, same as `system.purge_operation_log`). Cron
  `0 */12 * * *`. Renew sites with cert_expires_at < now+30d.
- [ ] Unit tests: 6 acme-client wrapper cases per spec.md.
- [ ] `e2e/acme-http01.spec.ts` gated on `DINOPANEL_E2E_ACME=1`
  with pebble sidecar.

## Phase 5 — Frontend + E2E + polish + docs

Lands last for the same reason v0.5 Phase 4 (Log Center) landed
last: by then all the underlying tables, parsers, and endpoints
have been exercised by the backend phases.

- [ ] `routes/websites/index.tsx` — list + Add-site dialog +
  detail drawer.
- [ ] `routes/websites/issue-ssl-dialog.tsx` — challenge picker +
  status polling.
- [ ] `App.tsx` lazy route + sidebar entry (`Globe` icon).
- [ ] i18n keys (zh-TW + en) for all websites + ACME copy.
- [ ] Settings page: "SSL providers" card with Cloudflare token
  input (writes to `SecretsService`, hidden value behind a
  show/hide toggle).
- [ ] Degraded banner: read `settings['websites.bootstrap_failed']`
  and render an alert at the top of `/websites` when truthy.
- [ ] Docs: finalize `docs/websites.md`, write `docs/acme.md`.
  Cover sudoers, SELinux/AppArmor, Cloudflare token setup, the
  `acme-renew` builtin task, and the degraded-bootstrap recovery
  steps.
- [ ] Bundle size verification: `/websites` lazy chunk ≤ 90 kB
  gzip; main bundle gzip ≤ 140 kB.
- [ ] **Manual smoke pass on Rocky 9.4 @ 192.168.199.234**
  (matches v0.5.1 evidence pattern):
  - Create a static site, drop an `index.html`, curl from the LAN.
  - Create a reverse proxy at a second domain, verify pass-through.
  - Issue an HTTP-01 cert against LE **staging** (not prod —
    avoids rate-limit on the smoke runs).
  - Run `Run now` on the `acme_renew` builtin task, verify the
    cert was *not* renewed (≥ 30 d remaining) and the run log
    captures the no-op.
  - Hand-edit a conf file on disk, run `POST /api/websites/reconcile`,
    verify it surfaces as `managed_by_dinopanel: false`.

## Out-of-scope guardrails (rejections to keep visible)

These are listed so we don't get nibbled into them mid-flight:

- No WAF / mod_security UI
- No custom error pages editor
- No multi-host load balancing
- No HAProxy / Caddy / Traefik backends — nginx only
- No DNS provider beyond Cloudflare in v0.3
- No Node / Java / Go / Python site types
- App Store integration remains permanently removed
- No auto-install of sudoers — operator does this once

## Estimate

Phase 1 ≈ 3 d · Phase 2 ≈ 4 d · Phase 3 ≈ 2 d · Phase 4 ≈ 5 d ·
Phase 5 ≈ 2 d → **~ 16 dev-days ≈ 3–4 weeks** at the project's
typical pace. Matches proposal + spec sizing.

## Open implementation questions (resolve as they come up)

The big five are resolved in `decisions.md`. What remains:

- [ ] **Container-vs-host PHP-FPM trade-off** (Phase 3 kickoff):
  one shared PHP-FPM container with multiple pool sockets vs one
  container per site? Probably shared with pool-per-site for v0.3
  (lower memory floor), but confirm when Phase 3 starts.
- [ ] **ACME account scope** (Phase 4 kickoff): one account per
  panel (simplest) vs one per email vs one per site? `acme_accounts`
  schema allows all three — pick at implementation time.
- [ ] **Reload throttling**: if an operator changes 10 sites in
  rapid succession, do we coalesce reloads? Probably yes — debounce
  reload() with a 500 ms tail. Decide in Phase 2 once we see the
  shape.
- [ ] **`conf.d/00-dinopanel.conf` collision**: what if an operator
  already has a file at that path? Phase 1 plan is unconditional
  overwrite (assumes DinoPanel owns the `00-` prefix). Re-check
  during Rocky smoke: if any standard package writes a `00-*.conf`,
  switch to `00-dinopanel-include.conf`.
