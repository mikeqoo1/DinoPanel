# ACME (v0.3 Phase 4)

DinoPanel issues and renews Let's Encrypt certificates via the
`acme-client` (Node) library. HTTP-01 + Cloudflare DNS-01 are
supported in v0.3; other DNS providers, wildcards, and SAN
multi-domain certs are deferred.

Companion module to `websites/` — every cert ultimately gets
written into a per-site directory and the matching site's nginx
conf is re-rendered with the SSL listener directives.

## Endpoints

All mounted under `/api/websites/:id/ssl/*`. Auth is global
(`APP_GUARD: JwtAuthGuard`).

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| POST | `/issue` | `{ challenge: 'http-01' \| 'dns-01', dnsProvider?: 'cloudflare' }` | `AcmeStatusResponse` |
| POST | `/renew` | — | `AcmeStatusResponse` |
| GET  | `/status` | — | `AcmeStatusResponse` |

`AcmeStatusResponse = { hasCert, expiresAt, lastIssuedAt, lastError }`.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `ACME_DIRECTORY_URL` | LE **staging** | ACME server. Flip to `https://acme-v02.api.letsencrypt.org/directory` for production |
| `ACME_EMAIL` | _(empty)_ | Required to issue. Empty → `ACME_EMAIL_NOT_SET` 500 |
| `PHP_FPM_SOCKET_PATH` | `/run/php-fpm/dinopanel-php-8.3.sock` | (Phase 3, see websites.md) |

Defaulting to staging is intentional — if a smoke run fails it
burns LE's 5-failed-validations-per-hour limit rather than the
50-certs-per-week prod limit.

## Account lifecycle

`AcmeAccountService.ensureAccount(directoryUrl, email)` is
idempotent. First call generates an RSA-2048 private key (via
`acme.crypto.createPrivateRsaKey`), registers with the directory,
and inserts a row into `acme_accounts`. Subsequent calls return
the cached row.

**The account key is stored as plain PEM in the SQLite DB**
(column `acme_accounts.key_pem`). Encryption at rest is the
operator's responsibility via filesystem permissions on the DB
file. A dedicated `SecretsService` is on the v0.4 roadmap; the
column is already typed appropriately so the move is a backfill
migration when that lands.

## HTTP-01

`Http01Challenger`:

1. ACME server says "prove control of `domain` by serving
   `<keyAuth>` at `http://<domain>/.well-known/acme-challenge/<token>`".
2. We write `<token>` → `<keyAuth>` at
   `<WEBSITES_ROOT>/acme/.well-known/acme-challenge/<token>` (default
   `/opt/dinopanel/acme/.well-known/acme-challenge/`).
3. Every site conf has a hard-coded
   `location ^~ /.well-known/acme-challenge/ { root <WEBSITES_ROOT>/acme/; }`
   block (added unconditionally by `conf-renderer.ts` since v0.3
   Phase 1) — so nginx serves the token without us having to
   reload or special-case anything.
4. ACME server fetches the token, validates, and signs the cert.
5. We delete the token file.

Token names are validated against `[A-Za-z0-9_-]+` (base64url) at
the writer to keep path traversal out of `<acmeRoot>`.

## DNS-01 (Cloudflare only in v0.3)

`CloudflareDns01Challenger`:

1. Look up the API token in `settings['acme.cloudflare.api_token']`.
   Set via `POST /api/settings` (Phase 5 surfaces a UI input).
2. `GET /zones?name=<candidate>` walking parent labels until a
   zone matches (so `www.example.com` resolves to the
   `example.com` zone).
3. `POST /zones/<zoneId>/dns_records` with type=TXT,
   name=`_acme-challenge.<domain>`, content=`base64url(sha256(keyAuth))`,
   ttl=60.
4. Poll Cloudflare's public DoH resolver (`1.1.1.1/dns-query`)
   for the TXT record. Default 30 attempts × 10 s = 5 min budget,
   tunable via `setPropagationTuning` for tests.
5. ACME server validates; we then
   `DELETE /zones/<zoneId>/dns_records/<recordId>` to clean up.

The CF API token needs `Zone:Read` + `Zone.DNS:Edit` for the
target zones.

### SAN / wildcards (deferred)

The orchestrator's `IssueArgs.domains` is an array, but the
controller only passes `[site.primaryDomain]` in v0.3. Multi-domain
support requires UI work and is reserved for a future release.

## Renewal

`AcmeRenewTaskRunner` is registered with the v0.5 scheduler as the
builtin task `system.acme_renew` (cron `0 */12 * * *`). On each
fire:

1. `SELECT * FROM sites WHERE cert_expires_at < now + 30 days`.
2. For each match, call `orchestrator.renew(siteId)` which re-uses
   the challenge type that worked last time (looked up from the
   most recent `acme_orders` row).
3. Per-site outcomes go into the run's `output` field; failures
   counter goes into `exitCode`.

The runner type `acme_renew` is added to `scheduledTaskType` enum
but hidden from the user-facing task type enum so the Scheduler UI
doesn't allow operators to create more of them by hand. The row is
visible only when `GET /api/scheduler/tasks?includeBuiltin=true`.

## Failure recording

Every issuance attempt writes one row to `acme_orders`:

```
{ siteId, challenge, status: 'pending' | 'success' | 'failed',
  errorMessage, startedAt, finishedAt }
```

The orchestrator updates this row exactly once per attempt — on
success or failure. `status: 'pending'` rows older than the
attempt timeout indicate a server crash mid-issuance; manual
cleanup for now (no automated sweep in v0.3).

## v0.4+ plans

- `SecretsService` for the account key + CF token (encrypted at
  rest with a key derived from `JWT_SECRET` or operator-supplied).
- Additional DNS providers (Route 53, DigitalOcean, etc.).
- Wildcard cert support (requires DNS-01 + UI for sub-zone selection).
- SAN multi-domain certs surfaced through the Issue UI.
