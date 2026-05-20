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
| `v0.4.x-pmm-cards-conditional`              | draft      | v0.4.x  | Drawer PMM cards conditional rendering — distinguish 'not registered' from 'broken'          |
| `v0.X-multihost-pmm-inventory`              | draft      | v0.X    | Multi-host PMM inventory unified in /databases list (blocked on product-direction decision)  |

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
