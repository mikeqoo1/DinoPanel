# v0.3 — Spec (draft)

References `proposal.md` for context/scope and `decisions.md` for
the five resolved questions (2026-05-18). This spec turns those
into concrete files, endpoints, and gates. Anything not listed
here is out of scope.

## Verification gates

- `pnpm typecheck` — 0 errors
- `pnpm lint` — 0 errors, 0 warnings
- `pnpm test` — ≥ 30 new vitest cases on top of the current 144
  (≈ nginx path/resolver 6, conf renderer 8, sites service 6,
  acme client wrapper 6, reconciliation scan 4)
- `pnpm build` — main bundle gzip stays under 140 kB; new
  `/websites` route is a lazy chunk and must stay under 90 kB gzip
- `pnpm exec playwright test` — ≥ 3 new e2e (create static site +
  resolves over HTTP, create reverse-proxy site, issue HTTP-01
  cert against `pebble` test ACME server)

## Acceptance criteria

### Backend (`apps/server/src/modules/`)

#### 1. `websites/` (new module)

`WebsitesModule` owns:

- `NginxService` — path resolver + shell wrapper. Single source of
  truth for filesystem paths. Methods:
  - `siteRoot(name)` → `/opt/dinopanel/sites/<name>/`
  - `siteConfPath(name)` → `/opt/dinopanel/nginx/conf.d/<name>.conf`
  - `acmeRoot()` → `/opt/dinopanel/acme/`
  - `validate()` → `nginx -t` via `sudo` (rejects non-zero with
    `NGINX_VALIDATE_FAILED` + captured stderr)
  - `reload()` → `systemctl reload nginx` via `sudo` (rejects with
    `NGINX_RELOAD_FAILED`)
  - **Sudoers contract** (documented, not auto-installed): operator
    must add `NOPASSWD` entries for `/usr/sbin/nginx`,
    `/usr/bin/systemctl reload nginx`, `/usr/bin/systemctl start nginx`,
    `/usr/bin/systemctl stop nginx`. The full sudoers snippet ships
    in `docs/websites.md`. Service refuses to start if a probe
    `sudo -n nginx -t` exits non-zero AND `app.env.WEBSITES_REQUIRE_SUDO`
    is `true` (default true; settable to `false` for dev).
- `SitesService` — DB-and-files-but-files-win semantics (Q2). Two
  paths in / two paths out:
  - **Create / update**: 1) generate conf via `ConfRenderer`,
    2) write atomically (tmp file + `fs.rename`),
    3) `nginx.validate()` — on failure, `fs.rename` the previous
       version back and throw `SITE_CONF_INVALID`,
    4) `nginx.reload()`, 5) upsert metadata row.
  - **Delete**: remove conf file → reload → delete metadata row.
  - **Reconciliation scan** (on boot + on `POST /api/websites/reconcile`):
    walk `/opt/dinopanel/nginx/conf.d/*.conf`. For each file with no
    metadata row, insert one with `managed_by_dinopanel: false`. For
    each metadata row whose file is missing, mark `orphaned: true`.
    **Files win** — never delete a conf to satisfy the DB.
- `ConfRenderer` — emits site `.conf` from a typed payload. Three
  templates for v0.3 (matches goals; Q4 layout assumed):
  - `static`: `root /opt/dinopanel/sites/<name>/public;` + index +
    try_files.
  - `reverse_proxy`: `location / { proxy_pass <upstream>; … }` with
    the standard `X-Forwarded-*` headers.
  - `php`: php-fpm site type — **deferred to Phase 3** (renderer
    stub returns `NOT_IMPLEMENTED_YET` in Phase 1/2; full template
    shipped in Phase 3 when the PHP-FPM container coordination is
    wired up).
  - Pre-template guard: validate domain via Zod
    (`/^(?=.{1,253}$)(?!-)[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})*$/`),
    upstream URL via `z.string().url()`. **No string-interpolated
    user input goes into nginx directives without passing the
    schema first** — this is the v0.3 security guardrail.
- REST endpoints under `/api/websites/*`, JWT-protected:
  - `GET    /api/websites` — list sites (joins conf scan + metadata)
  - `POST   /api/websites` — create
  - `PATCH  /api/websites/:id` — edit
  - `DELETE /api/websites/:id`
  - `POST   /api/websites/reconcile` — manual rescan
  - `GET    /api/websites/:id/conf` — return the rendered/current conf
    file content (read-only; UI uses this for the "View raw" panel)

#### 2. `acme/` (new module)

`AcmeModule` owns Let's Encrypt issuance + renewal.

- `AcmeAccountService` — wraps `acme-client` (npm, MIT). One account
  per `(directoryUrl, email)` pair stored in `acme_accounts`. Account
  key is generated lazily on first cert request and stored in
  `acme_accounts.key_pem` (encrypted at rest using the existing
  `SecretsService` from v0.2.1 — same pattern as Docker registry
  creds).
- `Http01Challenger` — writes the challenge token to
  `/opt/dinopanel/acme/.well-known/acme-challenge/<token>` and
  configures every site's nginx conf with
  `location /.well-known/acme-challenge/ { root /opt/dinopanel/acme/; }`
  (added unconditionally to the rendered template — costs nothing,
  saves the "I forgot to add the location block" footgun).
- `CloudflareDns01Challenger` — uses Cloudflare API token (stored
  via `SecretsService`, key `acme.cloudflare.api_token`). Creates
  `_acme-challenge.<domain>` TXT, polls until DNS propagates
  (10 s × max 30 attempts), then asks ACME server to validate.
- `IssueOrchestrator` — public API for "give me a cert for these
  domains":
  - Input: `{ siteId, domains[], challenge: 'http-01' | 'dns-01' }`.
  - Output: `{ certPath, keyPath, expiresAt }`. Writes to
    `/opt/dinopanel/acme/certs/<siteId>/{fullchain.pem,privkey.pem}`.
  - On success: update `sites.cert_paths` + `sites.cert_expires_at`
    in metadata; trigger `nginx.reload()` once the new cert is in
    place.
- REST endpoints under `/api/websites/:id/ssl/*`:
  - `POST /issue` — body `{ challenge, dnsProvider? }`
  - `POST /renew` — manual renew trigger (also called by scheduler)
  - `GET  /status` — `{ hasCert, expiresAt, lastIssuedAt, lastError }`

#### 3. Scheduler integration (consumes v0.5)

- On boot, `AcmeRenewJob` registers itself with v0.5
  `SchedulerService` as a `builtin` task (matching the
  `system.purge_operation_log` pattern):
  - `id`-stable name: `system.acme_renew`
  - Cron: `0 */12 * * *` (every 12h)
  - Handler: sweep `sites WHERE cert_expires_at < now + 30 days`,
    call `IssueOrchestrator.renew()` per site, log per-site outcome
    into `scheduled_runs.output`.
  - Built-in, immutable in UI (same v0.5 mechanic).

### Database schema additions (`apps/server/src/database/schema.ts`)

```ts
export const sites = sqliteTable('sites', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),           // matches conf filename stem
  primaryDomain: text('primary_domain').notNull(),
  type: text('type', {
    enum: ['static', 'reverse_proxy', 'php'],
  }).notNull(),
  payload: text('payload', { mode: 'json' }).notNull(), // type-specific
  managedByDinopanel: integer('managed_by_dinopanel', { mode: 'boolean' })
    .notNull().default(true),
  orphaned: integer('orphaned', { mode: 'boolean' })
    .notNull().default(false),                     // conf missing on disk
  certPaths: text('cert_paths', { mode: 'json' }), // { fullchain, privkey } | null
  certExpiresAt: integer('cert_expires_at'),       // unix ms
  createdAt: integer('created_at').notNull().$defaultFn(() => Date.now()),
  updatedAt: integer('updated_at').notNull().$defaultFn(() => Date.now()),
}, (t) => ({
  domainIdx: index('idx_sites_primary_domain').on(t.primaryDomain),
}));

export const acmeAccounts = sqliteTable('acme_accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  directoryUrl: text('directory_url').notNull(),   // e.g. LE prod / staging
  email: text('email').notNull(),
  keyPem: text('key_pem').notNull(),               // encrypted via SecretsService
  createdAt: integer('created_at').notNull().$defaultFn(() => Date.now()),
}, (t) => ({
  pairIdx: uniqueIndex('uniq_acme_accounts_pair').on(t.directoryUrl, t.email),
}));

export const acmeOrders = sqliteTable('acme_orders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  siteId: integer('site_id').notNull()
    .references(() => sites.id, { onDelete: 'cascade' }),
  challenge: text('challenge', { enum: ['http-01', 'dns-01'] }).notNull(),
  status: text('status', {
    enum: ['pending', 'success', 'failed'],
  }).notNull(),
  errorMessage: text('error_message'),
  startedAt: integer('started_at').notNull(),
  finishedAt: integer('finished_at'),
}, (t) => ({
  siteIdx: index('idx_acme_orders_site').on(t.siteId),
  startedIdx: index('idx_acme_orders_started').on(t.startedAt),
}));
```

Migration generated via `pnpm db:generate` (drizzle-kit pattern,
matching v0.5 Phase 1 lesson — no hand-rolled `CREATE TABLE`).

### Shared schemas (`packages/shared/src/schemas/`)

- New files: `websites.ts`, `acme.ts`.
- Re-export from `index.ts`.
- Zod schemas mirror DB rows + request/response payloads. Domain +
  upstream URL validation lives here so backend and frontend share
  the exact same rejection rules.

### Frontend (`apps/web/src/routes/`)

New top-level `/websites` route — sibling of `/system`, `/containers`,
etc. **No tabs container** (unlike `/system`) — websites is one
list view with a per-row drawer.

- `routes/websites/index.tsx` — list:
  - Table: name / primary domain / type / SSL badge
    (`none` / `valid until <date>` / `expiring in <N> days` /
    `expired` / `pending`) / status (active / orphaned).
  - "Add site" `<Dialog>`: name, primary domain, type select, then
    type-specific payload form.
  - Row click → drawer with: site detail, "Issue SSL" /
    "Renew SSL" buttons, "View raw conf" expandable.
- `routes/websites/issue-ssl-dialog.tsx` — modal:
  - Challenge select (HTTP-01 / DNS-01).
  - If DNS-01: provider select (only Cloudflare for v0.3; disabled
    options for "more coming in v0.4+").
  - "Issue" button → POST `/api/websites/:id/ssl/issue` → poll
    status every 2 s until `success` or `failed`.
- `App.tsx` gains `/websites/*` lazy route. Sidebar adds 網站 /
  Websites entry (`Globe` icon from lucide-react), slotted between
  `容器 / Containers` and `系統 / System`.
- i18n keys (zh-TW + en) for all new copy.

### Bootstrap (runtime, on `OnApplicationBootstrap`)

`WebsitesModule.onApplicationBootstrap()` runs three idempotent steps:

1. **Path setup**: `fs.mkdir({ recursive: true })` for
   `/opt/dinopanel/{sites,nginx/conf.d,acme,acme/certs,acme/.well-known/acme-challenge}`.
   Permissions: `0755` for parents, `0700` for `acme/` (private keys live there).
2. **Nginx include glue**: write
   `/etc/nginx/conf.d/00-dinopanel.conf` containing
   `include /opt/dinopanel/nginx/conf.d/*.conf;`.
   Both Rocky 9 (`nginx` from official repo) and Ubuntu apt-nginx
   already include `/etc/nginx/conf.d/*.conf` from the main config,
   so this one file is sufficient — no parsing/patching of
   `/etc/nginx/nginx.conf`. Idempotent (overwrite the same bytes
   on every boot).
3. **Reconciliation scan**: see SitesService above.

If any step fails, the module marks itself **degraded** (writes
`websites.bootstrap_failed` to settings) but **does not crash the
app** — the rest of DinoPanel must keep working. UI shows a banner
when degraded.

## Tests

### Unit (vitest)

- **Nginx path resolver**: 6 cases
  - Site name with `/`, `..`, `\0`, leading dot — rejected at
    `siteRoot()` boundary (defense-in-depth on top of Zod).
  - Path templates produce expected absolute paths under
    `/opt/dinopanel/...`.
- **Conf renderer**: 8 cases
  - Static site golden output.
  - Reverse-proxy golden output (with and without custom upstream
    headers).
  - PHP renderer stub returns `NOT_IMPLEMENTED_YET` (Phase 1/2);
    PHP golden lands in Phase 3.
  - ACME challenge `location` block present in every template.
  - Injection probe: domain `"; rm -rf /;"` rejected by schema
    before reaching the renderer (test calls renderer through the
    schema-validated entry point, not the raw render fn).
- **Sites service**: 6 cases
  - Create → validate fail → previous conf restored (rename-back
    works); metadata row not inserted.
  - Delete → file removed → reload called → row deleted.
  - Reconcile picks up an externally-created conf as
    `managed_by_dinopanel: false`.
  - Reconcile flags missing files as `orphaned: true` without
    deleting the row.
- **ACME client wrapper**: 6 cases (`acme-client` API mocked)
  - Account create stores key encrypted; second call returns
    cached row.
  - HTTP-01 challenge writes correct token path.
  - DNS-01 Cloudflare polls until propagation (fake timers).
  - Failure paths: HTTP-01 nginx not reloaded → cert not written;
    DNS-01 token failure → readable error in `acmeOrders.errorMessage`.
- **Reconciliation scan**: 4 cases
  - Empty `conf.d/` → empty result.
  - Mixed DinoPanel-managed + hand-rolled files → both surfaced
    correctly.
  - File mode 0644 vs 0600 — both readable.
  - Permission-denied file → entry surfaced with `unreadable: true`
    instead of crashing the scan.

### e2e (playwright)

- `e2e/websites-create-static.spec.ts` — create a static site,
  drop an `index.html` via the existing files module API, assert
  `curl http://<test-domain>/` returns the file. (Uses
  `--add-host` in playwright config; test domain resolves to
  127.0.0.1.)
- `e2e/websites-reverse-proxy.spec.ts` — create a reverse proxy
  pointing at an in-test HTTP server, assert pass-through works
  end-to-end.
- `e2e/acme-http01.spec.ts` — gated on
  `process.env.DINOPANEL_E2E_ACME === '1'`. Spins up
  [pebble](https://github.com/letsencrypt/pebble) (Let's Encrypt's
  ACME test server) in a sidecar container, issues a cert, asserts
  cert files materialize and `sites.cert_expires_at` is set.
  Skipped in default CI (no pebble in the sandbox); runs in the
  nightly job once we add one.

## Out of scope (deferred)

- WAF / mod_security UI
- Custom error pages editor
- Multi-host load balancing
- HAProxy / Caddy / Traefik backends
- Wildcard via every DNS provider beyond Cloudflare
- Node / Java / Go / Python site types
- App Store integration (permanently removed; not coming back)
- Auto-installing the sudoers snippet — operator-side prep
  documented in `docs/websites.md`

## Estimate

Backend ≈ 9 dev-days (websites/ 4 + acme/ 4 + scheduler-glue 1),
frontend ≈ 4 dev-days, tests + polish ≈ 2 dev-days,
docs + smoke ≈ 1 dev-day → **~ 16 dev-days ≈ 3–4 weeks** at the
project's typical pace. Matches proposal sizing.
