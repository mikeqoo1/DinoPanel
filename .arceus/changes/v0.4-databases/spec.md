# v0.4 — Spec (draft)

References `proposal.md` for context/scope and `decisions.md` for
the five resolved questions (2026-05-19). This spec turns those
into concrete files, endpoints, migrations, and gates. Anything
not listed here is out of scope.

`proposal.md` mentions a "native vs container" dual install path
that Q1 superseded — treat this spec as the source of truth and
ignore that passage of the proposal.

## Verification gates

- `pnpm typecheck` — 0 errors
- `pnpm lint` — 0 errors, 0 warnings
- `pnpm test` — ≥ 40 new vitest cases on top of the current 169
  (≈ engine-driver matrix 10, db-instances service 6, reconcile
  4, PMM PromQL client 6, Drawer primitive 4, external-nginx
  scan 4, php-fpm auto-provision 3, ACME_EMAIL settings 3)
- `pnpm build` —
  - main bundle gzip stays under 140 kB
  - `/databases` lazy chunk under 100 kB gzip (5 engines × form
    schemas + PMM card components)
  - `/websites` chunk stays under 90 kB gzip after Drawer
    migration
- `pnpm exec playwright test` — ≥ 4 new e2e (create MySQL
  container instance, rotate password, PMM summary card renders
  with fake-PMM fixture, /websites drawer refactor smoke)

## Acceptance criteria

### Backend (`apps/server/src/modules/`)

#### 1. `databases/` (new module)

`DatabasesModule` owns container-backed DB engine lifecycle.

- **`DbEngineRegistry`** — DI-injected map of `engine` string →
  driver instance. One driver per engine; each driver implements:
  ```ts
  interface DbEngineDriver {
    readonly engine: 'mysql' | 'mariadb' | 'postgresql' | 'redis' | 'mongodb';
    readonly defaultImage: string;       // e.g. 'mysql:8.4'
    readonly defaultPort: number;
    readonly dataDirInContainer: string; // e.g. '/var/lib/mysql'
    readonly dataSubdir?: string;        // postgres = 'pgdata' — see below
    buildContainerSpec(input: CreateDbInstanceInput): ContainerCreateOptions;
    healthProbe(containerId: string): Promise<DbHealth>;
    promqlBundle(serviceName: string): PromqlBundle;
  }
  ```
  - `buildContainerSpec` returns a dockerode `ContainerCreateOptions`
    with env vars (root password etc.), HostConfig binds for the
    bind-mounted data dir, exposed port, restart policy
    `unless-stopped`, and a HEALTHCHECK matching the engine's
    canonical client ping (`mysqladmin ping`, `pg_isready`,
    `redis-cli ping`, `mongosh --quiet --eval "db.adminCommand('ping')"`).
  - `healthProbe` shells out via `docker exec` for a second-level
    probe used by the UI status badge (independent of HEALTHCHECK
    cadence). **Credential-on-cmdline is forbidden** — host
    `ps auxf` shows docker-exec'd command lines, so `mysqladmin
    -p<pw> ping` and `redis-cli -a <pw> ping` are unsafe even
    though DinoPanel runs as root. Per-engine safe probes:
    - mysql/mariadb: `docker exec -i <c> mysqladmin --defaults-extra-file=/dev/stdin ping`
      with `[client]\npassword=<pw>` piped on stdin (image ships
      `mysqladmin`; stdin closes after the auth read).
    - postgres: `docker exec <c> pg_isready -U <user>` — no
      password needed for the local socket health probe.
    - redis: `docker exec -e REDISCLI_AUTH=<pw> <c> redis-cli ping`
      — env var is visible inside the container only, not in host
      `ps` (docker-exec env stays in the spawned process's
      `/proc/<pid>/environ`, not in the dockerd command line).
    - mongo: `docker exec <c> mongosh --quiet --eval "db.adminCommand({ping:1})"`
      — `ping` is one of the few admin commands that mongo
      answers without authentication (used by orchestrators for
      exactly this purpose), so no password needs to traverse
      the cmdline at all.
  - `promqlBundle` returns the four metric queries the detail
    cards render (QPS-equivalent, connections, uptime, replication
    lag). See [PromQL bundles](#promql-bundles-per-engine) below.
  - **`dataSubdir`** — only postgres sets this (`'pgdata'`). The
    postgres official image refuses to initialise when its
    `PGDATA` points at a bind-mount root that contains
    pre-existing files (e.g. `lost+found` on ext4, or anything
    DinoPanel itself wrote). The workaround documented by the
    image maintainers: set `PGDATA=<bind-mount>/pgdata` and let
    the entrypoint own the subdir. `buildContainerSpec`
    composes this conditionally — when `dataSubdir` is set,
    `Env` gains `PGDATA=<dataDirInContainer>/<dataSubdir>` and
    `mkdir -p <hostDataDir>/<dataSubdir>` happens in step 3 of
    `DbInstancesService.create`. Other engines leave it
    undefined and use `dataDirInContainer` as-is.

  Default images pinned per engine (operator can override via
  `imageTag` on create):

  | Engine     | Default image            | Default port |
  | ---------- | ------------------------ | ------------ |
  | mysql      | `mysql:8.4`              | 3306         |
  | mariadb    | `mariadb:11.4`           | 3306         |
  | postgresql | `postgres:16`            | 5432         |
  | redis      | `redis:7.4-alpine`       | 6379         |
  | mongodb    | `mongo:7.0`              | 27017        |

  Port assignment: on create, if the requested port is in use
  (sqlite uniq constraint OR `net.listen` probe on host), the
  service returns `DB_PORT_CONFLICT` with the offending port.
  Operator picks another — no auto-increment magic. Default port
  shown in the Create dialog is the canonical port + offset for
  any existing instance of the same engine.

- **`DbInstancesService`** — lifecycle around the registry. Public
  methods:
  - `create(input)` — atomic six-step:
    1. validate input via Zod (`packages/shared/src/schemas/databases.ts`),
    2. generate strong default credentials (32-char `crypto.randomBytes`),
    3. `mkdir -p /opt/dinopanel/databases/<engine>/<instance>/`,
    4. relabel for SELinux via `install.sh relabel-path` helper
       (idempotent shellout, no-op on non-SELinux hosts),
    5. `dockerode.createContainer(driver.buildContainerSpec(...))` +
       `container.start()`,
    6. insert `db_instances` row with `status: 'running'`.
    On any step failure: roll back (`container.remove({ force: true })`
    if step 5 succeeded; `rm -rf` the data dir; never insert the
    row). Map docker errors to `DB_CREATE_FAILED` with the
    captured stderr.
  - `remove(id, { dropData })` — stop + remove container; if
    `dropData=true` also `rm -rf` the data dir. **Destructive**;
    requires `dropData` to be explicit in the request body (UI
    surfaces a checkbox in the confirm dialog).
  - `start(id)` / `stop(id)` / `restart(id)` — proxy to dockerode.
  - `rotatePassword(id)` — generate new password, write new env
    via `container.update()` if engine supports it, otherwise
    `recreate-with-same-data-dir`. Mark instance `restarting`
    during the swap; clear on driver health probe success. **Brief
    downtime** is the documented contract — UI surfaces a confirm
    dialog before calling.
  - `reconcile()` — runs on boot and on
    `POST /api/databases/reconcile`. Walks `dockerode.listContainers`
    for containers whose name matches `dinopanel-<engine>-<name>`
    and reconciles state against the `db_instances` table:
    - container present, row present → update `status` from
      container state.
    - container missing, row present → mark row `status: 'error'`
      with `lastError: 'container_missing'`. Never auto-delete the
      row (operator decides).
    - container present, row missing → log warning + skip (orphan
      detection only, not import — the credentials aren't
      recoverable without operator input).

- **Audit + log redaction policy** (consequence of Q3 plaintext
  credentials):
  - The v0.5 audit interceptor (`common/audit/audit.interceptor.ts`)
    already skips response bodies and only captures
    `bodySummary` of request bodies; v0.4 must NOT widen its
    capture to include `/api/databases/*` responses.
  - For request bodies that carry plaintext password (`POST
    /api/databases` create, `PATCH /api/databases/:id`,
    `POST /api/databases/:id/rotate-password`), the audit
    interceptor's `summarizeBody` helper gains a redaction rule:
    redact the `password` and `customCredentials.password` fields
    to `'***'` before persistence. Same rule applies to
    `pino.info` request logging.
  - Frontend `lib/api.ts` (or the fetch wrapper) must NOT
    `console.log` response bodies for `/api/databases/*`. If a
    dev-mode response logger exists, exclude this path prefix.
  - Document in `docs/databases.md`: reverse proxy access logs
    SHOULD NOT log response bodies; if the operator's proxy does,
    they accept that DB passwords leak there.

- **REST endpoints** under `/api/databases/*`, JWT-protected:
  - `GET    /api/databases` — list with status + connection info
  - `POST   /api/databases` — create
  - `GET    /api/databases/:id` — detail (joins driver health
    probe; deliberately not cached — drawer wants fresh state)
  - `PATCH  /api/databases/:id` — edit (rename, change imageTag —
    triggers stop + recreate with same data dir)
  - `DELETE /api/databases/:id` — body `{ dropData: boolean }`
  - `POST   /api/databases/:id/start` / `/stop` / `/restart`
  - `POST   /api/databases/:id/rotate-password`
  - `POST   /api/databases/:id/pmm-register` — register the
    instance with PMM (stretch goal, Phase 6)
  - `POST   /api/databases/reconcile` — manual rescan
  - `GET    /api/databases/:id/metrics` — PMM PromQL results,
    `{ qps, connections, uptime, replicationLag }` or
    `{ pmmUnreachable: true }`

#### 2. `monitoring/` (extended)

Adds a PromQL client on top of v0.2.1's existing health-check
service. Lives in the same module — no separate module file.

- **`PmmPromqlClient`** — new service.
  - Reads `monitoring.pmm_url` + new `monitoring.pmm_api_token` +
    `monitoring.pmm_tls_skip_verify` from settings (env override
    via `MONITORING_PMM_*` matching v0.3 `ACME_*` pattern).
  - Calls `<pmm_url>/prometheus/api/v1/query?query=<promql>` with
    `Authorization: Bearer <token>` and TLS verification toggleable.
  - On non-200, network error, or empty result vector → returns
    `{ ok: false, reason }`. Never throws.
  - Result shape: `{ ok: true, value: number, timestamp: number }`.
- **`MonitoringService.summaryFor(instance)`** — orchestrator that
  calls `driver.promqlBundle(instance.containerName)`, fans out
  four PromQL queries in parallel, returns
  `{ qps?, connections?, uptime?, replicationLag? }` where each
  field is `number | null` (null = `ok: false` from client). UI
  treats null as "—" placeholder, doesn't show error toast.
  **In-memory cache**: keyed by `(instanceId)`, TTL 30 s.
  Drawer-open + tab-switch + clicking across 5 instances must
  not amplify into 20 PromQL queries against PMM's embedded
  Prometheus. Cache implementation: simple `Map<id, { value,
  expiresAt }>`, evict on instance delete + on settings change
  for `monitoring.pmm_*` keys. Manual refresh button in the
  drawer's PMM card cluster bypasses the cache (sends
  `?refresh=1`).
- **PromQL bundles per engine** — hardcoded in driver, not in
  settings (operator can't customize in v0.4; revisit in v0.5+
  if real users ask):

  | Engine | QPS | Connections | Uptime | Replication lag |
  | --- | --- | --- | --- | --- |
  | mysql | `rate(mysql_global_status_questions{service_name="<s>"}[5m])` | `mysql_global_status_threads_connected{service_name="<s>"}` | `mysql_global_status_uptime{service_name="<s>"}` | `mysql_slave_lag_seconds{service_name="<s>"}` |
  | mariadb | (same as mysql, mysqld_exporter) | (same) | (same) | (same) |
  | postgresql | `rate(pg_stat_database_xact_commit{service_name="<s>"}[5m])` | `pg_stat_database_numbackends{service_name="<s>"}` | `time() - pg_postmaster_start_time_seconds{service_name="<s>"}` | `pg_replication_lag{service_name="<s>"}` |
  | redis | `rate(redis_commands_processed_total{service_name="<s>"}[5m])` | `redis_connected_clients{service_name="<s>"}` | `redis_uptime_in_seconds{service_name="<s>"}` | `redis_connected_slave_lag_seconds{service_name="<s>"}` (or null if standalone) |
  | mongodb | `rate(mongodb_op_counters_total{service_name="<s>"}[5m])` | `mongodb_connections{service_name="<s>",state="current"}` | `mongodb_instance_uptime_seconds{service_name="<s>"}` | `mongodb_mongod_replset_member_replication_lag{service_name="<s>"}` |

  `<s>` placeholder = `db_instances.containerName`. The
  `containerName` is the canonical PMM `service_name` — when
  Phase 6 auto-register runs, it MUST call `pmm-admin add
  --service-name=<containerName>`. The schema deliberately does
  NOT store a separate `pmmServiceName` column; `pmmRegistered`
  boolean tracks "did we successfully register", and the name
  is always derivable from `containerName`. Operators who
  registered the instance manually under a different name can
  still see the Open-in-PMM link card but the summary cards
  return null for that instance (PromQL filter won't match).

#### 3. `websites/` (extended — v0.3 carry-over)

Two small additions, no breaking changes to v0.3 surface:

- **External-conf reconciliation reach extended** — `SitesService.reconcile`
  also walks `/etc/nginx/conf.d/*.conf` (in addition to the
  existing `/opt/dinopanel/nginx/conf.d/*.conf`). Files whose path
  is NOT under `/opt/dinopanel/` are imported as
  `managed_by_dinopanel: false` with a new field
  `external_conf_path` recording the absolute path. UI badges
  these as `external` (distinct from `unmanaged-but-in-our-tree`).
  Behaviour on conflict (same `server_name` in two files) →
  surface a warning row; reconcile does NOT pick a winner.
  **Exclusions**: `/etc/nginx/conf.d/00-dinopanel.conf` (the v0.3
  glue file that `include`s the managed tree — not a server
  block, must be skipped) and any file whose realpath resolves
  back under `/opt/dinopanel/` (symlink-aware).

- **PHP-FPM auto-provision** — `WebsitesModule` gains
  `PhpFpmService` that, on first PHP site creation, ensures a
  `dinopanel-php-fpm` container is running:
  - Image: `php:8.3-fpm` (pin via `PHP_FPM_IMAGE` env override).
  - Bind-mounts: `/opt/dinopanel/sites/` →
    `/opt/dinopanel/sites/` (same path inside container so fpm
    sees real paths in the conf).
  - Socket: TCP `127.0.0.1:9000` (default fpm listen). v0.3's
    `PHP_FPM_SOCKET_PATH` env stays for operators who already
    point at a manual container — service uses env if set,
    otherwise auto-provisions.
  - Status surfaced in `/settings → Websites` as a one-line badge
    ("PHP-FPM: managed / external / not running") with a "Restart"
    button when managed.
  - Lifecycle: container is start-on-first-PHP-site, stop on last
    PHP site removed (with 10-min grace + setting toggle to keep
    running).

#### 4. `acme/` (extended — v0.3 carry-over)

Move `ACME_EMAIL` from env-only to settings-with-env-fallback:

- New settings key `acme.email`. Read order:
  1. `process.env.ACME_EMAIL` (env wins for ops who script
     deployments — same as v0.3 `WEBSITES_*` envs)
  2. `settings['acme.email']`
  3. Throw `ACME_EMAIL_MISSING` from `IssueOrchestrator` if
     neither set (don't crash the module).
- UI surface: `/settings` gains an SSL section with the email
  input. Saving writes the settings row. Banner on `/websites` if
  email missing AND any site exists.

### Database schema additions (`apps/server/src/database/schema.ts`)

```ts
export const dbInstances = sqliteTable('db_instances', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),         // user-chosen, matches container suffix
  engine: text('engine', {
    enum: ['mysql', 'mariadb', 'postgresql', 'redis', 'mongodb'],
  }).notNull(),
  imageTag: text('image_tag').notNull(),
  port: integer('port').notNull(),
  username: text('username').notNull(),
  // TODO(v0.5): encrypt via SecretsService — landing alongside audit-log integration
  password: text('password').notNull(),
  dataDir: text('data_dir').notNull(),           // absolute path on host
  containerName: text('container_name').notNull().unique(),  // = dinopanel-<engine>-<name>
  status: text('status', {
    enum: ['running', 'stopped', 'restarting', 'creating', 'removing', 'error'],
  }).notNull(),
  lastError: text('last_error'),
  pmmRegistered: integer('pmm_registered', { mode: 'boolean' })
    .notNull().default(false),                   // true once auto-register (Phase 6 stretch) succeeded
  createdAt: integer('created_at').notNull().$defaultFn(() => Date.now()),
  updatedAt: integer('updated_at').notNull().$defaultFn(() => Date.now()),
}, (t) => ({
  engineIdx: index('idx_db_instances_engine').on(t.engine),
  portIdx: uniqueIndex('uniq_db_instances_port').on(t.port),  // prevents host-port clash at DB layer
}));

// Carry-over: external_conf_path on sites
// Modify the existing `sites` table to add:
//   externalConfPath: text('external_conf_path'),  // absolute path if managed_by_dinopanel=false and outside /opt/dinopanel/
// Generated as a regular migration (not destructive).
```

Migration generated via `pnpm db:generate` (drizzle-kit pattern,
matching v0.3 lesson — no hand-rolled `CREATE TABLE`). The
`db_instances.password` column carries a SQL comment in the
migration `-- TODO(v0.5): encrypt via SecretsService` for the
future encrypt pass.

### Shared schemas (`packages/shared/src/schemas/`)

- New file: `databases.ts`.
  - `dbInstanceSchema` mirrors row shape.
  - `createDbInstanceSchema`: name (alphanum + dash, 1–32), engine
    enum, imageTag (optional, defaults from driver), port (1024–65535),
    customCredentials (optional `{ username, password }`).
  - `dbHealthSchema`, `dbMetricsSummarySchema`.
- Extend `websites.ts`: add `externalConfPath?: string` to
  `siteResponseSchema`.
- Extend `settings.ts` (if exists; otherwise inline): allow
  `acme.email`, `monitoring.pmm_api_token`,
  `monitoring.pmm_tls_skip_verify`, `php_fpm.idle_keep_alive_min`.

### Frontend (`apps/web/src/`)

#### Drawer primitive (new — `components/ui/sheet.tsx`)

Shadcn-style Sheet wrapper over Radix Dialog (Radix is already a
dep). Single primitive serves /databases detail AND replaces the
/websites inline panel:

- `<Sheet open onOpenChange>` — controlled.
- Slides from right; width 480 px (matches v0.3 row-detail panel).
- Closes on ESC, backdrop click, or close button.
- Returns focus to the trigger row.
- i18n-friendly close-button label.

#### `/databases` route (new)

`routes/databases/index.tsx` — list view:
- Table: name / engine / status badge / port / connection username
  / actions.
- "Add database" `<Dialog>`: name + engine select + (revealed
  after engine) image tag + port + optional custom credentials
  textarea. Submit → POST → poll instance status until `running`
  or `error`.
- Row click → Sheet drawer with three sections:
  1. **Connection** — host (`127.0.0.1` or LAN IP from settings)
     / port / username / **password in plain text** + Copy button.
     Rotate button → confirm dialog explaining brief-downtime
     contract → POST `/rotate-password`.
  2. **PMM summary** (only if `monitoring.pmm_url` set) — four
     mini cards: QPS · Connections · Uptime · Replication lag.
     Null fields show "—". Card cluster has an "Open in PMM"
     anchor reusing v0.2.1's link pattern.
  3. **Lifecycle** — Start / Stop / Restart buttons + "Delete
     instance" with the `dropData` checkbox in the confirm dialog.
- Sidebar entry: 資料庫 / Databases (`Database` icon from
  lucide-react), slotted between `網站 / Websites` and
  `系統 / System`.

#### `/websites` refactor (carry-over)

- Replace the v0.3 inline detail panel with `<Sheet>` from the
  new primitive. No behaviour change; same actions, same buttons.
- Add `external` badge variant for the new `external_conf_path`
  rows. Disable Edit/Delete on external rows (read-only, surface
  the absolute path in the drawer with a copy button).

#### `/settings` SSL section (carry-over)

- New `<Card>` under existing settings tabs: SSL.
- `ACME email` input (email-validated). Save calls
  `PATCH /api/settings` with `{ key: 'acme.email', value }`.
- Helper text indicating env override behaviour.

### Bootstrap (runtime, on `OnApplicationBootstrap`)

`DatabasesModule.onApplicationBootstrap()` runs three idempotent
steps:

1. **Path setup**: `fs.mkdir({ recursive: true, mode: 0o755 })`
   for `/opt/dinopanel/databases/`. Per-instance subdirs are
   created by `DbInstancesService.create()`.
2. **SELinux relabel of the root**: shellout
   `install.sh relabel-path /opt/dinopanel/databases container_file_t`
   (no-op on non-SELinux hosts).
3. **Reconciliation scan**: see `DbInstancesService.reconcile()`.

Failure handling matches the v0.3 `WebsitesModule` pattern: mark
`databases.bootstrap_failed` in settings, surface a banner, don't
crash the app.

### `install.sh` extensions

- Factor a `relabel_path()` shell function that wraps
  `semanage fcontext -a -t <label> "<path>(/.*)?" && restorecon -R <path>`,
  no-op when `command -v semanage` fails. Backfill v0.3's
  `/opt/dinopanel/sites/` relabel call (currently relying on
  manual operator action on Rocky 234) into this same helper.
- Add a `relabel-path <path> <label>` subcommand so the running
  app can shell out idempotently per database create (step 4 of
  `DbInstancesService.create`).
- `mkdir -p /opt/dinopanel/databases` during install, 0755,
  owned by root.
- No `chown` per engine — image entrypoint handles data dir
  ownership on first start.

## Tests

### Unit (vitest)

- **Engine driver matrix** (10 cases — 2 per engine × 5 engines):
  one `buildContainerSpec` golden output, one `promqlBundle`
  contains expected metric names. Drivers are pure functions over
  input → no mocks needed.
- **DbInstancesService** (6 cases, dockerode mocked):
  - Create happy path inserts row + starts container.
  - Create with port conflict throws `DB_PORT_CONFLICT` before
    touching the filesystem.
  - Create with container-start failure rolls back the data dir.
  - Rotate password recreates container, returns new credentials.
  - Remove with `dropData=false` keeps data dir.
  - Remove with `dropData=true` removes data dir.
- **Reconcile** (4 cases):
  - Matching container + row → status updated.
  - Missing container → row marked `error`, not deleted.
  - Orphan container → warning logged, no DB write.
  - Empty docker → no-op.
- **PmmPromqlClient** (6 cases, `fetch` mocked):
  - 200 with vector → parsed number.
  - 200 with empty vector → `{ ok: false }`.
  - 401/403 → `{ ok: false, reason: 'auth' }`.
  - Network error → `{ ok: false, reason: 'unreachable' }`.
  - TLS error with `tls_skip_verify: true` → passes.
  - URL composition: `<base>/prometheus/api/v1/query`, query
    URL-encoded.
- **Drawer primitive** (4 RTL cases): open / close / ESC / focus
  return.
- **External-nginx scan** (4 cases):
  - File only in `/opt/dinopanel/nginx/conf.d` → managed.
  - File only in `/etc/nginx/conf.d` → external,
    `external_conf_path` set.
  - Same `server_name` in both → warning row in result.
  - Symlinks resolved before comparison.
- **PHP-FPM auto-provision** (3 cases, dockerode mocked):
  - First PHP site triggers `createContainer` for
    `dinopanel-php-fpm`.
  - Second PHP site does NOT recreate (idempotent).
  - Manual `PHP_FPM_SOCKET_PATH` set → service skips auto-provision.
- **ACME_EMAIL resolver** (3 cases): env > settings > throw.

### e2e (playwright)

- `e2e/databases-create-mysql.spec.ts` — create a MySQL instance,
  poll until `running`, drawer shows connection info, `mysql -u
  root -p<pw> -h 127.0.0.1 -P <port> -e "SELECT 1"` succeeds via
  a sidecar `mysql:8.4-cli` container. Skip on CI without docker;
  smoke step on Rocky 234.
- `e2e/databases-rotate-password.spec.ts` — rotate, assert old
  password fails, new password works.
- `e2e/databases-pmm-card.spec.ts` — fake-PMM fixture (tiny
  Express server serving `/prometheus/api/v1/query`) returns
  canned values; assert four cards render the numbers.
- `e2e/websites-drawer-refactor.spec.ts` — open a site, drawer
  appears, all v0.3 actions still work (regression smoke).

## Out of scope (deferred)

- DB clustering, replication, HA — single-instance only
- Schema-aware editors (Monaco SQL etc.)
- Backup / restore (v0.5 scheduler's `backup_files` runner can
  shell-dump a DB to disk — that's v0.4's escape hatch)
- Multi-DNS-provider ACME beyond Cloudflare (still v0.5+)
- Wildcard / SAN cert UI
- Multi-PHP-version support (one `php:8.3-fpm` container; v0.5+
  if demand)
- SecretsService (Q4 → v0.5 paired with audit-log integration)
- Operator-customizable PromQL bundles (Q5 — revisit in v0.5+)
- Auto-registering instances in PMM (Phase 6 stretch goal — ship
  manual link first)
- `chown` of bind-mount data dirs from `install.sh` (image
  entrypoints handle it)
- Zero-downtime password rotation
- App Store integration (permanently removed)

## Estimate

Backend ≈ 11 dev-days (databases/ 6 + monitoring PMM client 2 +
websites carry-over 2 + acme carry-over 1), frontend ≈ 5 dev-days
(Drawer primitive 1 + /databases route 3 + /websites refactor 1
+ /settings SSL 0.5 polish), tests + polish ≈ 3 dev-days,
install.sh + docs + smoke ≈ 2 dev-days → **~ 21 dev-days ≈ 4
weeks** at the project's typical pace. Matches Q5 estimate
adjustment.
