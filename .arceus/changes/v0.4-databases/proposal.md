# v0.4 — Databases module (+ v0.3 carry-over backlog)

**Status:** draft
**Target:** v0.4
**Depends on:** v0.3 shipped + smoke pass (S1 validated 2026-05-19)

## Context

v0.3 (websites + ACME) is code-complete and the static-site happy
path validated on production-class Rocky 9.4 hardware. The original
roadmap puts **databases** as v0.4 — MySQL / MariaDB / PostgreSQL /
Redis / MongoDB management — explicitly without the App Store
template mechanism that was permanently dropped in v0.2.

This proposal scopes v0.4 around databases as the headline feature
while also carrying forward the deferred items from the v0.3
deviation logs.

## Goals

### Primary: databases module

Manage common DB engines without forcing operators into App Store
templates. Two parallel installation strategies per engine — same
posture as v0.3's nginx (host systemd) vs PHP-FPM (operator-provisioned
container):

1. **Native install** — for engines that ship cleanly via distro
   package managers (MySQL/MariaDB on Rocky via `dnf module`,
   PostgreSQL via the official PGDG repo, Redis via `dnf`).
   DinoPanel detects + manages the systemd unit, exposes connection
   info, surfaces logs from the v0.5 log centre.
2. **Docker install** — for engines where the official upstream
   image is the canonical distribution (MongoDB, or operator
   preference). DinoPanel pulls + runs the container via the v0.2
   container module's existing dockerode service.

Engines for v0.4:

- **MySQL 8.x** — native or container
- **MariaDB 10.x / 11.x** — native or container
- **PostgreSQL 16.x** — native or container
- **Redis 7.x** — native or container
- **MongoDB 7.x** — container only (no native package on Rocky)

Per-engine UI:

- Connection info card (host, port, credentials).
- "Open in PMM" deep-link (reuses the PMM integration from v0.2.1).
- Quick actions: start / stop / restart, view logs, edit
  configuration (textarea, no schema-aware editor for v0.4).

### Secondary: v0.3 carry-over

Items in the v0.3 deviation logs that should land in v0.4 without
re-opening that change:

- **`SecretsService`** — encrypted-at-rest storage for the ACME
  account key (`acme_accounts.key_pem`) and Cloudflare API token
  (`settings['acme.cloudflare.api_token']`). Encryption key
  derived from `JWT_SECRET` or operator-supplied. Backfill
  migration moves existing plain values into the encrypted column.
- **Drawer / Sheet primitive** — replace the v0.3 inline detail
  panel on `/websites` with a proper Sheet drawer so the list
  stays visible. Same primitive serves the v0.4 databases detail
  view.
- **Auto-provisioned PHP-FPM container** — the v0.3 deferral
  (operator runs `docker run` manually). Now that v0.4 will own
  Docker-image provisioning anyway (databases via container), the
  same machinery can manage `php:8.3-fpm`. Phase 3 of v0.3 already
  has the conf renderer side ready.
- **UI for `ACME_EMAIL`** — currently env-only. Move to settings
  with env fallback so the operator can change it without editing
  `.env`.
- **External-conf import in reconcile** — schema discriminator
  (`managed | external`) for `siteResponseSchema`; reconcile imports
  external `.conf` files as `managed_by_dinopanel: false` rows so
  they show up in the list with a clear badge.

### Out of scope (deferred to v0.5+)

- DB clustering, replication, HA — single-instance only
- Schema-aware editors (Monaco SQL etc.)
- Backup / restore (intentionally separate — the v0.5 scheduler's
  `backup_files` runner can dump a DB to disk via shell, that's
  the v0.4 escape hatch)
- Multi-DNS-provider ACME (Route 53, DigitalOcean, etc.) — wait
  for demand
- Wildcard / SAN cert UI
- Multi-PHP-version support

## Open questions to resolve before activation

Same per-question discussion pattern v0.3 used. Five questions in
mind right now — do NOT bundle when asking:

1. **Native vs container as default per engine?** MySQL on Rocky
   has `mysql-community` repo; just use container to keep the
   surface uniform? Operator preference may flip this per engine.
2. **Where do DB data dirs live?** `/opt/dinopanel/databases/<engine>/<instance>/`
   would mirror v0.3's namespacing. Docker bind-mounts vs named
   volumes is the second sub-question.
3. **Credential surfacing.** Generate strong defaults on install
   and show once? Always plaintext in the connection card (DinoPanel
   already runs as root)? Encrypted via SecretsService once that
   lands?
4. **`SecretsService` design.** Per-secret AES-GCM with a master
   key from `DATA_DIR/.secret-key` (auto-generated, 0600)? Or
   derive from `JWT_SECRET`? The latter rotates secrets when JWT
   rotates which is bad — likely option A.
5. **PMM integration depth.** v0.2.1 ships a link-card; v0.4 has
   a chance to push the API-cards (option C from the original
   PMM proposal). Cost vs payoff unclear until we see real DB
   instances in the UI.

Activate this change only after the five are answered the v0.3 way
— per-item, written into `decisions.md`.

## Rough sizing

- DB engine drivers (5 engines × ~1d each) — 1 week
- UI (list + detail with the new Drawer) — 1 week
- `SecretsService` + backfill — 3 days
- v0.3 carry-over (php-fpm auto-provision, ACME_EMAIL UI, external
  reconcile) — 3 days
- E2E + docs + polish — 3 days
- Total: ~3 weeks
