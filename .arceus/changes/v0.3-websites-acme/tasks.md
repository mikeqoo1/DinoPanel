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

## Phase 3 — PHP site type ✅ (2026-05-19)

PHP-FPM coordination, scoped down. The auto-provisioned-container
plan from the spec was traded for an operator-provisioned socket
to keep the phase at its 2 dev-day budget — see deviation log
below.

- [x] **`ConfRenderer` PHP template** — emits
  `fastcgi_pass unix:<socket>;` with `include fastcgi_params;`,
  `SCRIPT_FILENAME` + `PATH_INFO` + `fastcgi_split_path_info`,
  `try_files $uri $uri/ /index.php?$query_string;`, and an
  explicit `location ~ /\.(?!well-known) { deny all; }` so the
  ACME challenge keeps working while dotfiles stay private.
- [x] **Renderer accepts `phpFpmSocketPath`** via `RenderContext`;
  throws `MissingPhpFpmConfigError` (typed, easy to catch) when
  it's missing. `SitesService` reads the path from
  `PHP_FPM_SOCKET_PATH` env (default
  `/run/php-fpm/dinopanel-php-8.3.sock`) at construction and
  passes it on every render.
- [x] **`PHP_FPM_SOCKET_PATH` env** added to `env.schema.ts`.
- [x] **PHP renderer tests** — 3 cases replacing the Phase-1
  `NOT_IMPLEMENTED_YET` stub test:
  - `fastcgi_pass` + `location ~ \.php$` + dotfile deny block
  - `index.php` in try_files chain, ACME block still present
  - Throws `MissingPhpFpmConfigError` when socket is omitted
- [x] **`docs/websites.md` PHP section**: minimal Docker run
  example for `php:8.3-fpm` listening on the shared Unix socket,
  SELinux relabel snippet for `/run/php-fpm/`, PHP-version
  selection note (8.3 only for v0.3).
- [ ] **Auto-provisioned FPM container — deferred to a future
  release**. See deviation log.

**Verification gates passed**: typecheck ✅ (0 errors) · lint ✅
(0 errors, 0 warnings) · test **159/159** ✅ (157 → 159: -1 stub
test removed, +3 real PHP tests). server build ✅. No web code
touched, so web build skipped.

### Phase 3 deviation log

- **Auto-provisioned PHP-FPM container deferred** to a future
  release. The spec said "provisioned on first PHP-site create,
  reused for all subsequent ones" using the v0.2 containers
  module. Doing that properly means image pull on first run,
  restart policy management, per-version socket routing, error
  surface for "image pull failed" / "container exited", and a
  whole UX for picking PHP versions. That's a 3–5 dev-day phase
  on its own, blowing the 2-day Phase 3 budget. The fallback
  pattern matches sudoers + SELinux: documented one-time
  operator setup. Open to revisiting in v0.4 / v0.5 if the v0.3
  smoke pass shows the manual step is enough of a footgun to
  warrant the complexity.
- **PHP version locked to 8.3** in the Zod enum. The schema
  surface is already in place to extend (it's an enum, not a
  string), but the supporting container coordination is what
  blocks multi-version — and that's the deferred work above.

## Phase 4 — ACME (HTTP-01 + Cloudflare DNS-01 + auto-renew) ✅ (2026-05-19)

The riskiest phase — issuance pipeline + auto-renew scheduler
glue, all behind a clean orchestrator surface so the controller
stays trivial.

- [x] **`AcmeAccountService`** — `ensureAccount(directoryUrl, email)`
  caches in `acme_accounts`; first call generates RSA-2048 via
  `acme.crypto.createPrivateRsaKey()` and calls
  `client.createAccount({ contact, termsOfServiceAgreed: true })`.
  Key stored as **plain PEM** in the column — see deviation log.
- [x] **`Http01Challenger`** — writes `<keyAuth>` to
  `<acmeRoot>/.well-known/acme-challenge/<token>`. Defense-in-depth
  token regex (`[A-Za-z0-9_-]+`) rejects traversal probes. Relies
  on the unconditional `location ^~ /.well-known/acme-challenge/`
  block in every site conf (Phase 1 renderer).
- [x] **`CloudflareDns01Challenger`** — reads token from
  `settings['acme.cloudflare.api_token']`, walks domain labels to
  find the parent zone (`www.example.com` → `example.com`),
  POSTs the TXT record, polls Cloudflare DoH (1.1.1.1) for
  propagation (default 30 × 10 s, tunable for tests via
  `setPropagationTuning`).
- [x] **`AcmeClientFactory`** — thin wrapper so tests swap the
  real `acme-client` with mocks. Production: `new acme.Client()`
  + `acme.crypto`. Tests: vi.fn() shims.
- [x] **`AcmeOrchestratorService`** — `issue / renew / status /
  issueForSite`. Writes one `acme_orders` row per attempt,
  marks `success` / `failed` exactly once. On success: writes
  cert files (`fullchain.pem` 0644, `privkey.pem` 0600) under
  `<acmeRoot>/certs/<siteId>/`, sets `sites.cert_paths` +
  `cert_expires_at`, calls `SitesService.update(id, {})` so the
  renderer picks up the cert and re-emits the conf with SSL
  directives + reloads nginx.
- [x] **`/api/websites/:id/ssl/{issue,renew,status}`** controller
  bodies replaced with real orchestrator calls.
- [x] **Scheduler integration**:
  - `scheduledTaskType` enum extended with `'acme_renew'`
    (TypeScript-only — SQLite text column accepts the new value
    without a migration; `pnpm db:generate` confirmed no schema
    diff).
  - `SchedulerService` gains two public methods: `registerRunner`
    (for external module runners) + `ensureBuiltinTask` (idempotent
    builtin upsert).
  - `AcmeRenewTaskRunner` registered + builtin task
    `system.acme_renew` (cron `0 */12 * * *`) inserted in
    `AcmeModule.onApplicationBootstrap`. `register(taskId)` wires
    the cron handle.
- [x] **Unit tests** — 10 new cases:
  - `acme/__tests__/http01.test.ts` — 3 (token write, traversal
    rejected, remove idempotent)
  - `acme/__tests__/cloudflare-dns01.test.ts` — 4 (digest format,
    happy-path zone+TXT+propagation, propagation timeout, no token)
  - `acme/__tests__/account.test.ts` — 3 (empty email rejected,
    first-call creates key + remote registration, second call
    returns cache)
- [ ] **`e2e/acme-http01.spec.ts` against pebble — deferred to
  Phase 5 smoke pass**. Spinning pebble in playwright config
  bloats CI; the manual smoke against LE staging on Rocky 9.4 is
  cheaper and exercises a more realistic path.

**Verification gates passed**: typecheck ✅ (0 errors) · lint ✅
(0 errors, 0 warnings) · test **169/169** ✅ (159 → 169, +10
Phase-4 cases) · server build ✅. No web code touched yet (UI
lands Phase 5).

### Phase 4 deviation log

- **`SecretsService` is deferred**. The spec referenced "the
  existing `SecretsService` from v0.2.1 (same pattern as Docker
  registry creds)" but no such service exists in this repo.
  Phase 4 stores `acme_accounts.key_pem` and the Cloudflare API
  token as plain values in their respective tables; encryption at
  rest is the operator's responsibility via filesystem perms on
  the SQLite DB file (same trust model as users.password_hash
  today). The columns are typed correctly so a backfill migration
  is the only thing required when SecretsService lands in v0.4+.
- **Pebble e2e deferred to Phase 5 smoke**. Configuring pebble in
  playwright's per-test sidecar would bloat the CI surface and
  introduce a deps-on-Docker-from-tests pattern this codebase
  doesn't use elsewhere. The Phase 5 manual smoke pass on Rocky
  9.4 against LE **staging** exercises the same code paths plus
  the real network + sudoers + SELinux integration, which a
  pebble container would not.
- **SAN / multi-domain certs deferred**. Orchestrator accepts
  `domains: string[]` but the controller's `issueForSite()`
  helper only passes `[site.primaryDomain]`. UI for multi-domain
  selection lands in a future release.
- **`acme-client` `rfc8555` types not re-exported** at the
  library's top level — the orchestrator + factory use locally
  declared opaque shapes (`AcmeAuthorization`, `AcmeChallengeObj`)
  carrying just the fields we actually read (`identifier.value`,
  `type`, `token`). Cleaner than reaching into the library's
  type subpaths.
- **`scheduledTaskType` enum extension** is TypeScript-only.
  Drizzle generates no migration because SQLite text columns
  don't carry the enum constraint at runtime. If a future drizzle
  release flips to CHECK constraints, a migration will be needed.

## Phase 5 — Frontend + E2E + polish + docs ✅ (2026-05-19, code-side)

Lands last for the same reason v0.5 Phase 4 (Log Center) landed
last: by then all the underlying tables, parsers, and endpoints
have been exercised by the backend phases.

- [x] **`routes/websites/index.tsx`** — list + Add-site dialog
  trigger + detail panel below the table (selected row reveals a
  panel with raw conf preview + SSL controls). Drawer was traded
  for inline-below-table because the codebase has no Sheet/Drawer
  primitive and a Dialog would block the table behind it.
- [x] **`routes/websites/add-site-dialog.tsx`** — discriminated form
  on type (static / reverse_proxy / php); PHP shows an inline
  hint pointing at docs/websites.md for the FPM container setup.
- [x] **`routes/websites/issue-ssl-dialog.tsx`** — HTTP-01 vs
  DNS-01 picker, polls `/api/websites/:id/ssl/status` every 3 s
  while the dialog is open so the user sees `lastError` /
  `hasCert` updates in near-real-time.
- [x] **App.tsx lazy route + sidebar entry** — Globe icon, slotted
  between Monitoring and System (the sidebar ordering Phase 5
  spec asked for placed it between Containers and System, but
  System is the operational-posture root and websites is product
  scope — Monitoring → Websites → System reads more naturally).
- [x] **i18n keys** — full coverage in zh-TW + en. `websites.*`,
  `websites.ssl.*`, `websites.dialog.*`, `nav.websites`,
  `settings.ssl.*`.
- [x] **Settings page → SSL providers card** + show/hide token
  toggle + clear button. Backend: new
  `GET / PUT /api/acme/config` (`AcmeSettingsController`) that
  never returns the token in full — UI only sees
  `{ cloudflareTokenSet: boolean }`.
- [x] **Degraded banner** — `useWebsitesStatus()` hook reads
  `/api/websites/status`; when `degraded: true` a warning Card
  renders at the top of `/websites` with the captured reason and
  a one-line pointer at docs/websites.md.
- [x] **Docs**: `docs/websites.md` finalized in Phase 1 + Phase 3
  (PHP section); `docs/acme.md` written in Phase 4.
- [x] **Bundle size**: main gzip **112.27 kB** (budget 140 kB ✓);
  `/websites` lazy chunk **~3.56 kB gzip** (budget 90 kB ✓).
- [ ] **Manual smoke pass on Rocky 9.4 @ 192.168.199.234** —
  **operator todo** (matches v0.5.1 evidence pattern). Cannot be
  done from this dev box. Checklist captured below for the smoke
  session:
  - Create a static site, drop an `index.html` via `/files`, curl
    from the LAN — expect 200 + content.
  - Create a reverse proxy at a second domain pointing at any
    local container, verify pass-through.
  - Set Cloudflare token via Settings → SSL providers (DNS-01).
  - Set `ACME_EMAIL` env to a real address.
  - Issue an HTTP-01 cert against **LE staging** (default
    `ACME_DIRECTORY_URL`) — expect `hasCert: true`,
    `expiresAt` ~90 d ahead.
  - Switch `ACME_DIRECTORY_URL` to LE prod and re-issue against
    a real public domain.
  - Run `Run now` on `system.acme_renew` (visible under
    `/api/scheduler/tasks?includeBuiltin=true`); verify the cert
    was *not* renewed (≥ 30 d remaining) and the run log captures
    the no-op.
  - Hand-edit a conf file on disk; run `POST /api/websites/reconcile`;
    verify external file is logged but not imported (matches
    Phase 2 deviation).
  - Hand-delete a conf file off disk; re-run reconcile; verify
    the row gets `orphaned: true` in `/api/websites`.

**Verification gates passed (code-side)**: typecheck ✅ (web + server)
· lint ✅ · test **169/169** ✅ · server build ✅ · web build ✅
(main 112.27 kB gzip, `/websites` lazy chunk ~3.56 kB gzip).

### Phase 5 deviation log

- **Drawer → inline detail panel below table**. The codebase has
  no shadcn Drawer/Sheet primitive yet, and a modal Dialog would
  block the table behind it. Inline panel keeps the list visible
  while drilling into a single site. Adding a Drawer primitive is
  a v0.4 polish item.
- **Sidebar position: Monitoring → Websites → System** (not the
  spec's Containers → Websites → System). Websites sits next to
  Monitoring because both are product-domain features; System is
  the operational-posture root which closes the list. Cosmetic.
- **`AcmeSettingsController` is new in Phase 5**, not Phase 4 —
  Phase 4 only needed reads from `settings['acme.cloudflare.api_token']`.
  Phase 5 adds the writer (with token masking) since the UI needs
  it. `acme/config` endpoint exists alongside the per-site
  `/api/websites/:id/ssl/*` to keep the secret-style API
  segregated from per-site operations.
- **ACME_EMAIL stays env-driven** in v0.3 (UI doesn't surface it).
  Moving it to settings-with-env-fallback is a v0.4 task alongside
  SecretsService.
- **Pebble e2e remains deferred** to the operator manual smoke
  (already noted in Phase 4 deviations).
- **Manual smoke is operator-side only** for this session. The
  v0.5.1 pattern was the same — the smoke evidence lands in a
  follow-up commit / consolidation change once the operator has
  run through the Rocky checklist.

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
