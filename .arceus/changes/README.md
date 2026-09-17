# Arceus Change Proposals

This directory tracks structured change proposals for DinoPanel — both
completed work (as historical record) and draft / in-progress work (as
plans to be implemented). Each change lives in its own folder
containing:

| File            | Purpose                                                  |
| --------------- | -------------------------------------------------------- |
| `proposal.md`   | Context, motivation, why this change exists              |
| `spec.md`       | Acceptance criteria — what "done" looks like             |
| `tasks.md`      | Concrete checklist used during implementation            |
| `decisions.md`  | Technical decisions and trade-offs worth remembering     |
| `meta.json`     | Status, dates, related commits, version target           |

Status values in `meta.json`:

- `draft` — being discussed, not yet approved
- `ready` — proposal/spec/tasks signed off, implementation not started
- `active` — approved, implementation in progress
- `completed` — implementation merged, history preserved
- `archived` — superseded or abandoned

## Current changes

| ID                                          | Status     | Target  | Summary                                                                              |
| ------------------------------------------- | ---------- | ------- | ------------------------------------------------------------------------------------ |
| `v0.1-mvp`                                  | completed  | v0.1    | MVP — Auth + Dashboard + Terminal + Files + Settings + Packaging (historical record) |
| `v0.1.1-consolidation`                      | completed  | v0.1.1  | Pre-v0.2 hardening: tests (47 unit + 5 e2e), bundle 400 → 98 kB gzip, security, deploy |
| `v0.1.2-production-posture`                 | completed  | v0.1.2  | Root posture, system info endpoint, fs errno mapping                                 |
| `v0.2-docker-containers`                    | completed  | v0.2    | Docker container management (dockerode + Compose, no App Store)                      |
| `v0.2.1-compose-yaml-lint`                  | completed  | v0.2.1  | Add `yaml` dep + live JS-side YAML lint in the Compose editor                        |
| `backlog-files-compress-extract-ui`         | completed  | any     | Files: new compress-to-disk + extract endpoints + multi-select UI (zip-slip guarded) |
| `backlog-compose-discovered-stack-readonly` | completed  | any     | Compose detail: read-only handling for discovered stacks (409 COMPOSE_FILE_UNAVAILABLE + banner) |
| `backlog-pmm-integration`                   | completed  | any → v0.4 | Option A shipped 2026-05-18 (link card + 30s health-ping). Option C folded into v0.4 |
| `v0.5-firewall-cron-logs`                   | completed  | v0.5    | Firewall (30s rollback) + Scheduler (6 task types) + Log Center (5 sources)          |
| `v0.5.1-consolidation`                      | completed  | v0.5.1  | Manual smoke pass on Rocky 9.4 + dogfood validation for v0.5                         |
| `v0.3-websites-acme`                        | completed  | v0.3    | Sites (static / reverse-proxy / PHP) + ACME (HTTP-01 + Cloudflare DNS-01)            |
| `v0.3.1-smoke-pass`                         | completed  | v0.3.1  | First v0.3 deploy on Rocky 9.4 — S1 static + S2/S3/S7 verified; install.sh fixes     |
| `v0.4-databases`                            | completed  | v0.4    | Databases (MySQL/MariaDB/PostgreSQL/Redis/MongoDB, container-only) + v0.3 carry-over + PMM C |
| `v0.4.1-smoke-patches`                      | completed  | v0.4.1  | Bundle five fixes surfaced during v0.4 Rocky 234 smoke (install.sh × 2, PG18 PGDATA, ensureImage, clipboard) |
| `v0.4.2-pmm-cards-conditional`              | completed  | v0.4.2  | Drawer PMM cards conditional rendering — distinguish 'not registered' from 'exporter unhealthy' via existing pmmRegistered flag |
| `v0.4.3-pmm-inventory-readonly`             | completed  | v0.4.3  | Read-only PMM inventory section in /databases (Option B scope of archived v0.X draft). Renamed from v0.5 — PMM work is v0.4 lineage |
| `v0.4.4-pmm-tls-default`                    | completed  | v0.4.4  | Align PMM PromQL/Inventory clients with v0.2.1 monitoring probe — default TLS skip-verify ON to match self-signed PMM norm |
| `v0.4.5-pmm-credentials-ui-and-pmm3`        | completed  | v0.4.5  | Two Rocky 234 bugs: (1) `/settings` had no UI for PMM token / TLS — add it; (2) inventory client was PMM 2.x, real PMM is 3.x — switch to `GET /v1/inventory/services` |
| `v0.4.6-pmm-deeplink-pmm3`                  | completed  | v0.4.6  | Open-in-PMM deep link was `/graph/inventory/services/<id>` (PMM 2.x guess); PMM 3.x route is `/inventory/services/<id>` (no /graph prefix) |
| `v0.4.7-pmm-deeplink-dashboard-and-version-badge` | completed | v0.4.7 | v0.4.6 path also 404'd — PMM 3 has no per-service-id UI route. Rewrite to per-engine Instance Summary dashboard `/graph/d/<uid>?var-service_name=<name>`. Also floating version badge top-right + Vite-injected version (single source) |
| `v0.4.8-version-badge-relocate`             | completed  | v0.4.8  | v0.4.7's floating top-right badge overlapped page action buttons. Move into sidebar bottom under user menu, `text-sm` bigger font |
| `v0.5-databases-backups`                    | completed  | v0.5.0  | Database backups + restore module — logical dumps, local storage, scheduler `db_backup` task type, restore-in-place, keep-last-N retention. 6 phases shipped 2026-05-29 (Rocky 234 smoke deferred) |
| `v0.5.2-files-upload-write-guard`           | completed  | v0.5.2  | Security blocker: apply `assertWritable()` to upload endpoint — closes panel-login → host-root escalation via `POST /api/files/upload?path=/etc/ssh` |
| `v0.5.2-files-read-symlink-protection`      | completed  | v0.5.2  | Security blocker: add read-side symlink-deny check (`assertReadable` + `realpath`) — closes `/etc/shadow` read via user-created symlink |
| `v0.5.2-db-instance-password-redact`        | completed  | v0.5.2  | Security blocker: strip plaintext DB password from API responses, add `/reveal-password` endpoint with re-auth |
| `v0.5.2-nginx-directive-injection-guard`    | completed  | v0.5.2  | Security blocker: tighten `indexFiles` / `documentIndex` schemas to safe-filename regex — closes nginx directive injection via site payload |
| `v0.6-toolbox`                              | completed  | v0.6.0  | Toolbox — NTP/time-sync + Fail2Ban (extend firewall in-place) + disk usage/curated cleaners. Clone of the firewall pattern; stateless. 6 phases shipped 2026-06-02 (`f240ad2`), Rocky 234 smoke S1-S3 passed (S2 hit the live fail2ban-absent 400 path; S4 N/A fail2ban not installed; S5 cleaners opt-in). Swap-write+Supervisor→v0.6.1, MFA→v0.7.0, Passkey blocked on TLS |
| `v0.6.1-supervisor-disk-denoise`            | completed  | v0.6.1  | Supervisor = systemd .service management (4th toolbox tab; list/status + start/stop/restart/enable/disable; tiered protected-units guard, .service-only + canonical-Id re-judge) + disk-table de-noise (`df -PTB1` fstype filter). Shipped 2026-06-03 (`35ef1e7`), Rocky 234 smoke S1-S3 + S6 passed (guard verified live incl. ssh.socket → SERVICE_PROTECTED). supervisord + swap-write NOT in this cut |
| `v0.6.6-podman-support`                    | completed  | v0.6.6  | Podman support — remote nodes fall back to `podman ps` when `docker` is absent (single read-only constant, exit 127 when neither); local containers module auto-detects docker → rootful podman → rootless podman socket and `docker compose` → `podman compose`. No API/schema change. Shipped 2026-09-16, local podman 6.1.1 smoke (ps fallback / dockerode API / compose label discovery / E2E 200s); pure-Podman remote host not yet verified |
| `v0.6.7-engine-badge-permission`           | completed  | v0.6.7  | Docker/Podman badge on remote containers card + local Containers page (`GET /containers/engine`, remote `__DINO_ENGINE__` marker → `engine`); engine present but socket permission denied → 200 `permissionDenied:true` + amber card (was 500 `NODES_COMMAND_FAILED`; no host permission changes); node list collapses on select. Shipped 2026-09-17 |
| `v0.6.8-multi-engine-sudo`                 | completed  | v0.6.8  | Remote container inventory runs docker + podman together (rows tagged engine/owner) and, as root, enumerates rootless podman per `/run/user/*` user. Optional per-node sudo password (AES-256-GCM, HKDF(JWT_SECRET), stdin-only, never returned) elevates non-root nodes. `sudoFailed` + per-engine `permissionDenied` are 200 states. Replaces v0.6.7 `engine`/`permissionDenied` top-level fields. Shipped 2026-09-17 |
| `v0.6.9-nexus-traffic`                     | completed  | v0.6.9  | Nexus Repository traffic monitoring: 60s scrape of /service/rest/metrics/prometheus (Jetty request/response counters + bytes_{down,up}loaded_by_format_*), samples in `nexus_samples` (migration 0006, 7-day retention), rates computed at read time with per-range buckets and counter-reset handling. Credentials reuse the v0.6.8 AES-GCM secrets helper. New /nexus page with recharts. Read-only. Shipped 2026-09-17 |
| `v0.6.10-nexus-usage-quota`                | completed  | v0.6.10 | Reads /service/rest/internal/ui/usage-metrics alongside the traffic scrape (5 nullable columns, migration 0007), bars requests_per_last_24h + components against per-instance limits editable via PATCH :id/limits (Nexus exposes no limit anywhere — checked API + UI bundle), charts the rolling 24h counter. Caught a method-level @UsePipes bug that validated @Param as the body schema. Shipped 2026-09-17 |
| `v0.6.11-nexus-limits-backcompat`          | completed  | v0.6.11 | storedInstanceSchema derived its required-ness from the API schema, so v0.6.10's new limit fields made every pre-existing KV row fail safeParse and get dropped — the panel showed zero Nexus instances. Stored limits are optional, defaults applied in toPublic. Lesson: a storage schema derived via omit() inherits new required fields. Shipped 2026-09-17 |
| `archived-v0.X-multihost-pmm-inventory`     | archived   | —       | Superseded by v0.4.3-pmm-inventory-readonly. Original 3-option draft (A full union / B limited / C decline); operator picked B |

Released latest first: `033db4c` v0.4.0 release cut, `c8f76c4` Phase 5
frontend, `5d17596` Phase 4 v0.3 carry-over, `0df3071` Phase 3 PMM,
`1538a05` Phase 2 engine drivers, `620f4fd` Phase 1 foundation,
`b421711` Phase 0 activation. Followed by five smoke patches:
`a8b4fa9`, `89eacd5`, `bf49ef3`, `6a21d19`, `c4a29e2` — bundled into
the v0.4.1 cut.

## Where v0.1 went

Note: `v0.1-mvp/` is a **reconstructed** historical record — the MVP
itself shipped 2026-05-14, before this `.arceus/changes/` mechanism
existed (the mechanism started with `v0.1.1-consolidation` on the same
day). The authoritative implementation plan is still
`/home/mike/.claude/plans/whimsical-scribbling-sloth.md`; the folder
here exists for version-history continuity so the index reads
end-to-end from v0.1 onwards.

## Backlog notes

- **PMM integration**: Option A shipped 2026-05-18 (external link card
  + 30s health ping). Option C (API summary cards) is now folded into
  `v0.4-databases` as the `pmmIntegration: api-summary-cards-plus-link`
  decision — natural home alongside the database connection cards.
- The Files compress/extract scope was bigger than the original draft
  implied — the README's "backend already exists" claim was wrong, only
  the streaming archive-download did. The completed change adds two
  new endpoints + UI. See its `decisions.md` §1.

## Next session — pick up here

Currently active: **`v0.4-databases`** (created + activated 2026-05-19,
right after the v0.3.1 release cut). All five open questions resolved
in `decisions.md`. Engines: MySQL / MariaDB / PostgreSQL / Redis /
MongoDB, all container-only with bind-mounts under
`/opt/dinopanel/databases/<engine>/<instance>/`. Carry-over from v0.3:
Drawer/Sheet primitive, auto-provisioned PHP-FPM, ACME_EMAIL settings
UI, external-conf import in reconcile.

Suggested execution order:

1. **Phase 1 — Foundation** — engine registry + connection card schema
   + container-launch helper (reusing v0.2 dockerode glue).
2. **Phase 2 — Per-engine drivers** — incremental: MySQL/MariaDB first
   (closest siblings), then PostgreSQL, then Redis, then MongoDB.
3. **Phase 3 — Connection-card UI + Drawer/Sheet primitive** —
   replaces the v0.3 inline detail panel on `/websites` at the same
   time it lands on `/databases`.
4. **Phase 4 — v0.3 carry-over** — auto-provisioned PHP-FPM container,
   ACME_EMAIL settings page, reconcile `managed | external`
   discriminator.
5. **Phase 5 — PMM Option C** — API summary cards + deep links on the
   connection card, keeping the existing Open-in-PMM link-card.
6. **Phase 6 — Smoke pass on Rocky 234** (mirrors v0.3.1 / v0.5.1).

After v0.4 the open headline items are: multi-node was explicitly
**rejected** on 2026-05-18 (~8w+, security blast radius too big,
premature for current install base — revisit post-v1.0 only); the
remaining 1Panel-shaped surface to consider is backups + cross-host
file sync, but neither is scheduled.
