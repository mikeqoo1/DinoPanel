# v0.4 — Task Checklist (draft)

Six phases. Foundations first, then the engine drivers + CRUD
backbone, then external integration (PMM), then v0.3 carry-over,
then UI, then polish + smoke. Drawer primitive lands in Phase 1
so both Phase 5's `/databases` view and the `/websites` refactor
can pull from the same component without a second migration.

References: `proposal.md` (scope + supersedence note), `decisions.md`
(answers to Q1–Q5 with rationale, post-review BLOCK fixes
already applied), `spec.md` (endpoint / schema / file-path /
PromQL detail).

## Phase 1 — Foundation (≈ 3 dev-days)

Nothing user-visible. Everything cross-cutting lands here so
Phases 2–6 can be vertical slices.

- [ ] `drizzle` schema additions in
  `apps/server/src/database/schema.ts`:
  - `dbInstances` table (full shape from `spec.md` — engine enum,
    plaintext `password` with `-- TODO(v0.5): encrypt via
    SecretsService` migration comment, `pmmServiceName`,
    `engineIdx`, `uniqueIndex` on `port`).
  - Extend `sites` with `externalConfPath` text column
    (nullable).
- [ ] Migration generated via `pnpm db:generate` →
  `drizzle/0004_*.sql`. Hand-edit only to append the TODO comment
  on `password` column.
- [ ] `packages/shared/src/schemas/databases.ts`:
  - `dbEngineSchema` enum
  - `dbInstanceSchema`, `createDbInstanceSchema`,
    `patchDbInstanceSchema`, `removeDbInstanceSchema`
    (`dropData: boolean`)
  - `dbHealthSchema`, `dbMetricsSummarySchema`,
    `dbReconcileResponseSchema`
- [ ] Extend `packages/shared/src/schemas/websites.ts`:
  - Add `externalConfPath?: string` to `siteResponseSchema`.
- [ ] Re-export from `packages/shared/src/schemas/index.ts`.
- [ ] **`DatabasesModule` skeleton**
  (`apps/server/src/modules/databases/`):
  - `databases.module.ts`, `databases.service.ts` (stub `list()` +
    real bootstrap path-mkdir + relabel call)
  - `engines/` dir with one file per engine
    (`mysql.driver.ts`, `mariadb.driver.ts`, `postgres.driver.ts`,
    `redis.driver.ts`, `mongo.driver.ts`) — all classes exist but
    methods throw `NOT_IMPLEMENTED_YET` with `phase: 2` except
    `defaultImage` / `defaultPort` / `dataDirInContainer` /
    `promqlBundle` (pure data, settle now to lock the interface).
  - `db-engine.registry.ts` — DI-injected map of engine → driver.
  - `databases.controller.ts` — endpoints declared, mutating
    bodies throw `NOT_IMPLEMENTED_YET` with `phase: 2`.
- [ ] **MonitoringModule extension stub**
  (`apps/server/src/modules/monitoring/`):
  - `pmm-promql.client.ts` — class exists, `query()` returns
    `{ ok: false, reason: 'not_implemented' }`. Implementation in
    Phase 3.
  - Settings keys registered: `monitoring.pmm_api_token`,
    `monitoring.pmm_tls_skip_verify` (+ env overrides
    `MONITORING_PMM_API_TOKEN`, `MONITORING_PMM_TLS_SKIP_VERIFY`).
- [ ] **`Sheet` Drawer primitive**
  (`apps/web/src/components/ui/sheet.tsx`) — Radix `Dialog`
  wrapper, controlled `open`/`onOpenChange`, slide-from-right
  480 px, ESC + backdrop close, focus return. Storybook-style
  smoke render in tests.
- [ ] **Bootstrap (idempotent)** in
  `DatabasesService.onApplicationBootstrap()`:
  - `fs.mkdir({ recursive: true, mode: 0o755 })` for
    `/opt/dinopanel/databases/`.
  - Shellout `install.sh relabel-path /opt/dinopanel/databases
    container_file_t` (no-op on non-SELinux hosts).
  - Reconciliation scan **deferred to Phase 2**.
  - On failure: write `settings['databases.bootstrap_failed']`,
    pino.error, do not rethrow.
- [ ] **`install.sh` extensions**:
  - Factor `relabel_path()` shell function
    (`semanage fcontext -a -t … && restorecon -R …`, no-op
    without `command -v semanage`).
  - Add `relabel-path <path> <label>` subcommand.
  - `mkdir -p /opt/dinopanel/databases` during install.
  - Backfill `relabel_path /opt/dinopanel/sites
    httpd_sys_content_t` into install (v0.3 ran this by hand on
    Rocky 234).
- [ ] **Unit tests** — ≥ 14 new cases:
  - Engine driver matrix golden output × 10
    (`buildContainerSpec` stub OK in Phase 1 since `promqlBundle`
    is the only fully-shipped method).
  - Drawer primitive RTL × 4 (open / close / ESC / focus
    return).
- [ ] `app.module.ts` registers `DatabasesModule` after the
  existing `WebsitesModule` block, before `AuditModule`.

**Gates**: typecheck · lint · ≥ 183 tests (169 + 14) · server
build · web build (no significant bundle drift, Phase 1 adds no
production web code beyond the Sheet primitive — budget watch on
chunk attribution).

## Phase 2 — Engine drivers + CRUD backbone (≈ 5 dev-days)

The vertical slice that makes `pnpm dev → curl POST
/api/databases` actually create a MySQL container with
plaintext credentials in the response. PMM is still stubbed —
Phase 3 lights up `/metrics`.

- [ ] Per-engine `buildContainerSpec` implementations
  (5 drivers):
  - mysql/mariadb: `MYSQL_ROOT_PASSWORD` env, bind `/var/lib/mysql`.
  - postgres: `POSTGRES_PASSWORD` + `POSTGRES_USER`, bind
    `/var/lib/postgresql/data` with the `PGDATA=…/pgdata`
    subdir convention (Docker official image lesson).
  - redis: `--requirepass <pw>` cmd, bind `/data`.
  - mongo: `MONGO_INITDB_ROOT_USERNAME` +
    `MONGO_INITDB_ROOT_PASSWORD`, bind `/data/db`.
  - HEALTHCHECK per engine — canonical client ping
    (`mysqladmin ping -h localhost`, `pg_isready -U <u>`,
    `redis-cli -a <pw> ping`,
    `mongosh --quiet --eval "db.adminCommand('ping')"`).
- [ ] Per-engine `healthProbe` via `dockerode.exec` (independent
  of HEALTHCHECK cadence; used by drawer status badge).
- [ ] **`DbInstancesService` full implementation**:
  - `create(input)` — 6-step atomic (validate → strong
    credentials → mkdir → SELinux relabel shellout → dockerode
    create+start → DB insert). Rollback path tested.
  - `start` / `stop` / `restart` / `remove({ dropData })` /
    `rotatePassword`.
  - `reconcile()` — boot + manual endpoint trigger.
- [ ] `databases.controller.ts` wires every endpoint listed in
  `spec.md §1`. `/pmm-register` returns
  `{ stub: true, phase: 6 }` until Phase 6.
- [ ] Port-conflict check: sqlite uniq + host-port probe via
  `net.createServer().listen()`.
- [ ] **Unit tests** — ≥ 10 new:
  - `DbInstancesService` × 6 (create happy / port conflict /
    container-start fail rollback / rotate / remove keep data /
    remove drop data).
  - `Reconcile` × 4 (match / missing container / orphan /
    empty).
- [ ] **e2e** — `databases-create-mysql.spec.ts` (gated on
  `process.env.DINOPANEL_E2E_DOCKER === '1'`; sidecar
  `mysql:8.4` cli for SELECT 1 round-trip).

**Gates**: typecheck · lint · ≥ 193 tests · server build ·
e2e creates a real MySQL on the dev box.

## Phase 3 — PMM integration (≈ 3 dev-days)

API surface that fills the drawer's monitoring cards. Graceful
degrade is the only hard requirement — UI never blocks on PMM.

- [ ] `PmmPromqlClient` implementation:
  - `fetch(<base>/prometheus/api/v1/query?query=<promql>)` with
    `Authorization: Bearer <token>`, `tls_skip_verify` honoured
    via `https.Agent({ rejectUnauthorized: false })` (only when
    setting is true).
  - Parse Prometheus result format
    (`{ status: 'success', data: { resultType: 'vector', result:
    [{ value: [ts, "<n>"] }] } }`); return `{ ok: true, value,
    timestamp }` on first vector, `{ ok: false, reason }`
    otherwise.
  - Catch network / TLS / parse errors uniformly → never throws.
- [ ] `MonitoringService.summaryFor(instance)`:
  - Calls `driver.promqlBundle(instance.containerName)`.
  - `Promise.all` the four queries with `Promise.allSettled` —
    one failure doesn't kill the bundle.
  - Returns `{ qps, connections, uptime, replicationLag }`,
    each `number | null`.
- [ ] `GET /api/databases/:id/metrics` endpoint wired in
  `databases.controller.ts`.
- [ ] **Unit tests** — ≥ 6 new (`PmmPromqlClient` matrix:
  vector / empty / 401 / network / TLS-skip / URL encoding).
- [ ] **e2e** — `databases-pmm-card.spec.ts` with the
  fake-PMM Express fixture in `e2e/fixtures/pmm/`.

**Gates**: typecheck · lint · ≥ 199 tests · server build ·
e2e PMM card renders with canned numbers.

## Phase 4 — v0.3 carry-over (≈ 3 dev-days)

Three small additions, no breaking change to v0.3 surface.

- [ ] **External-conf reconcile** —
  `SitesService.reconcile` walks
  `/etc/nginx/conf.d/*.conf` in addition to
  `/opt/dinopanel/nginx/conf.d/*.conf`:
  - Skip `/etc/nginx/conf.d/00-dinopanel.conf` (glue file).
  - Skip files whose realpath resolves under `/opt/dinopanel/`
    (symlink-aware).
  - Insert as `managed_by_dinopanel: false` with
    `externalConfPath` set.
  - Conflict detection on `server_name` — warning row, never
    auto-resolve.
- [ ] **PHP-FPM auto-provision** —
  `PhpFpmService` (new file under
  `apps/server/src/modules/websites/`):
  - Start `dinopanel-php-fpm` (`php:8.3-fpm`) on first PHP site
    create; bind-mount `/opt/dinopanel/sites/` 1:1; listen on
    `127.0.0.1:9000`.
  - Respect `PHP_FPM_SOCKET_PATH` env (operator override —
    service skips auto-provision when set).
  - 10-min idle grace before stop on last PHP site removal;
    overridable via `php_fpm.idle_keep_alive_min` setting.
  - Status surfaced via `GET /api/settings/php-fpm-status`
    (managed / external / not-running).
- [ ] **ACME_EMAIL settings** —
  `IssueOrchestrator.getEmail()` reads `process.env.ACME_EMAIL`
  first, then `settings['acme.email']`; throws
  `ACME_EMAIL_MISSING` on neither.
- [ ] **Unit tests** — ≥ 10 new:
  - External-nginx scan × 4 (managed-only / external-only /
    server_name conflict / symlink resolution).
  - PHP-FPM auto-provision × 3 (first-site start / second-site
    idempotent / env-override skips).
  - ACME_EMAIL resolver × 3 (env wins / settings fallback /
    both missing throws).

**Gates**: typecheck · lint · ≥ 209 tests · server build · all
v0.3 regression tests green.

## Phase 5 — Frontend (≈ 5 dev-days)

User-visible work. Drawer primitive from Phase 1 makes both
`/databases` and the `/websites` refactor cheap.

- [ ] **`/databases` route**:
  - `routes/databases/index.tsx` — list table + Add dialog.
  - `routes/databases/create-database-dialog.tsx` — name + engine
    + image tag + port + optional custom credentials.
  - `routes/databases/database-drawer.tsx` — three sections
    (Connection / PMM summary / Lifecycle).
  - `routes/databases/rotate-password-dialog.tsx` — confirm
    surfaces the brief-downtime contract.
  - Per-engine icons + colour accents in the list badge.
- [ ] **`/websites` refactor**:
  - Replace inline detail panel with `<Sheet>` from the Phase 1
    primitive.
  - Add `external` badge variant; disable Edit/Delete on
    external rows; surface `externalConfPath` with a Copy
    button.
- [ ] **`/settings` SSL section**:
  - New `<Card>` with `ACME email` input. Saves to
    `settings['acme.email']` via `PATCH /api/settings`.
  - Helper text on env override semantics.
- [ ] **Sidebar entry**: 資料庫 / Databases with `Database` icon
  from lucide-react, between 網站 and 系統.
- [ ] **i18n keys**: zh-TW + en for all new copy (databases
  surface, Sheet primitive close-button label, ACME email).
- [ ] **App.tsx**: lazy route for `/databases/*`.
- [ ] **e2e** — `websites-drawer-refactor.spec.ts` (regression
  smoke).

**Gates**: typecheck · lint · ≥ 209 tests (Phase 5 mostly adds
e2e, not unit) · server build · web build:
- main bundle gzip < 140 kB
- `/databases` lazy chunk < 100 kB gzip
- `/websites` chunk stays < 90 kB gzip post-Sheet refactor.
- ≥ 4 new e2e total across Phases 2 + 3 + 5.

## Phase 6 — Polish + stretch + smoke (≈ 2 dev-days)

- [ ] **`POST /api/databases/:id/pmm-register`** (stretch):
  call PMM management API to add the instance for monitoring.
  Documented as optional in the UI ("Auto-register in PMM"
  checkbox at create-time, default off if no token configured).
  Skip cleanly if PMM not reachable.
- [ ] **Docs**:
  - `docs/databases.md` — engines table, default ports, data
    dir paths, SELinux notes, PMM PromQL bundle reference.
  - `docs/websites.md` — extend with external-conf reconcile
    behaviour + PHP-FPM auto-provision toggle.
  - README v0.4 features section.
- [ ] **Smoke on Rocky 234** (mirrors v0.3.1 pattern):
  - S1 create MySQL instance, connect via `mysql` cli from host.
  - S2 rotate password, old conn fails, new works.
  - S3 stop / start / restart from drawer.
  - S4 reconcile after `docker kill` outside DinoPanel.
  - S5 external-conf scan picks up a hand-written
    `/etc/nginx/conf.d/test.conf`.
  - S6 ACME_EMAIL settings UI saves, takes effect on next
    issue.
  - S7 (deferred unless PMM available on 234) PMM cards render.
- [ ] **Release tag**: `v0.4.0`. Smoke pass evidence written to
  `.arceus/changes/v0.4-databases/smoke-pass.md` (new
  sub-document, mirrors v0.3.1 layout).
- [ ] Update `meta.json` →
  `status: completed`, fill `commits[]`, `verification`,
  `knownFollowups[]` (matching the post-ship v0.3 meta shape).

**Gates**: smoke S1–S6 pass on Rocky 234 · all previous gates
still green · release notes published.

## Overall

- Total: ~21 dev-days, calendar ≈ 4 weeks.
- Hard dependency: v0.2 dockerode service (Phase 2 reuses
  `ContainersService` patterns), v0.3 websites module (Phase 4
  extends `SitesService`), v0.5 audit interceptor (no integration
  needed in v0.4, but `db_instances` writes will land in
  `operation_log` automatically via the interceptor — no extra
  work).
- Carry-over **into v0.5**: SecretsService (Q4 deferral) + audit
  events `secret.read` / `secret.write` that an encrypted
  password column will eventually emit; PMM auto-register lift
  from stretch to first-class if Phase 6 ships partial; PromQL
  bundle customization UI.
