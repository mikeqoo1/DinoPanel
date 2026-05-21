# v0.4.5 — PMM 3.x API path + Settings UI for PMM credentials

**Status:** completed (2026-05-21)
**Target:** v0.4.5
**Depends on:** v0.4.4-pmm-tls-default
**Origin:** v0.4.4 deploy to Rocky 234 surfaced two distinct issues

## Two bugs, one release

### Bug 1: `/settings` has no UI for PMM API token + TLS skip

Operator opened `/settings`, found sections for ACME email, Cloudflare
token, PHP-FPM, audit retention, and a single PMM URL field — but
**no** input for `monitoring.pmm_api_token` or
`monitoring.pmm_tls_skip_verify`. They had to ssh in and edit `.env`
directly.

Root cause: `MonitoringController` only exposed `PUT /pmm/config`
which writes URL. The other two settings keys were only writable via
direct SQL or env var. Pure docs/UI gap — backend never grew the
endpoints.

### Bug 2: external PMM panel still shows "unreachable" after adding token

Operator added `MONITORING_PMM_API_TOKEN=glsa_...` to `.env` and
restarted dinopanel.service. The PMM service account's "Last used"
timestamp updated (proving the token was being sent), but the panel
banner stayed on "PMM 無法連線" — and `/monitoring` happily reported
"PMM 連線正常" against the same URL.

Root cause: Rocky 234 runs **PMM 3.5.0**. The v0.4.3 inventory
client was written against the PMM 2.x API:

| | PMM 2.x (v0.4.3 implementation) | PMM 3.x (Rocky 234 actual) |
| ---: | --- | --- |
| Path | `/v1/inventory/Services/List` | `/v1/inventory/services` |
| Method | POST | GET |
| Body | `{}` | (none) |

PMM 3.x returns `404 "Endpoint not found"` for the PMM 2.x path.
`PmmInventoryClient` maps any non-2xx + non-401/403 to `unreachable`,
so the operator-visible banner stayed on the same TLS-flavoured
error text even though the actual failure was now an endpoint-shape
mismatch.

Verified live by probing `https://192.168.199.234:18443/v1/inventory/services`
with the operator-supplied token: `200 OK` with a valid per-engine
bucketed body (`{ mysql: [...], postgresql: [...], ... }`). The
response shape is identical between PMM 2.x and 3.x — only the path
and method changed.

## Fixes

### Backend

- `MonitoringService`: add `getCredentialsView()` (returns
  `{ tokenSet: boolean, tlsSkipVerify: boolean | null }`; never the
  token string itself, parity with Cloudflare token handling) and
  `setCredentials({ apiToken, tlsSkipVerify })`.
- `MonitoringService`: add an `onCredentialsChange(listener)` registry.
  `setConfig` + `setCredentials` fire all listeners on mutation. This
  is an observer pattern, not direct service injection, because
  `DatabasesModule` already imports `MonitoringModule` — wiring it
  the other direction would create a circular import. `DbMetricsService`
  and `ExternalPmmService` subscribe in `onModuleInit` and call
  `invalidateAll()` when notified.
- `MonitoringController`: new `GET /monitoring/pmm/credentials` and
  `PUT /monitoring/pmm/credentials` endpoints.

### PMM Inventory client

- Switch `INVENTORY_PATH` from `/v1/inventory/Services/List` to
  `/v1/inventory/services`.
- Switch method from POST to GET; drop the `{}` body and
  `Content-Type: application/json` header.
- Parser unchanged — both PMM versions return the same per-engine
  bucketed object shape.

### Frontend

- New hooks `usePmmCredentials()` + `useSetPmmCredentials()` in
  `use-monitoring.ts`. The mutation invalidates monitoring + databases
  query keys so the external panel immediately reflects a
  credential change.
- `/settings` external_monitoring section gains:
  - **PMM API token** input — password-type with show/hide toggle
    (mirrors Cloudflare token UX). Placeholder reads "Stored
    (enter a new value to replace)" when one is already saved.
    Empty submit is disabled; explicit "Clear token" button for the
    erase path.
  - **TLS certificate verification** select with three options:
    Default (env-driven; currently skips since PMM ships self-signed
    after v0.4.4), Force skip, Force verify.
  - Both fields write through the new credentials endpoint and
    cascade through the observer chain into cache invalidation.
- i18n keys under `settings.external_monitoring.token_*` and
  `settings.external_monitoring.tls_*` (zh-TW + en).

## What v0.4.5 isn't

- Not a PMM 2.x backward-compat layer. Supporting both via a
  `/v1/server/version` probe + path branching is feasible (~half
  dev-day) but PMM 3 GA was Q1 2025 and the tail of PMM 2
  deployments is shrinking. Re-evaluate if an operator surfaces a
  PMM 2.x deployment.
- Not a PMM Inventory auto-register endpoint — that's still
  archived-v0.X Option B, gated on broader product direction.
- Not a UI for `monitoring.pmm_url` source disambiguation
  (env vs setting) — URL was already settable via UI in v0.2.1.

## Verification

- Tests pass (existing 250+ tests; ctor signature updates for the
  new `MonitoringService` dependency on `DbMetricsService` +
  `ExternalPmmService`).
- Live probe against Rocky 234's PMM 3.5.0 with operator's token
  confirmed the new path returns a parseable response containing
  `mike-mariadb` and `mariadb-234` services (those are the two
  external-PMM rows the operator should see in the panel after
  deploying v0.4.5).
- Token was rotated by operator post-experiment.

## Notes on credentials handling during development

The operator supplied a transient PMM service-account token + a
sudo password for diagnosis. Neither value is persisted in the repo
or in agent memory. The token was used only to probe the live PMM
API to confirm response shape; the sudo path was not exercised
because ssh + curl was enough to diagnose.
