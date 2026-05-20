# v0.5 — Read-only PMM inventory section in /databases

**Status:** active (phase 1 in progress)
**Target:** v0.5
**Supersedes:** `v0.X-multihost-pmm-inventory` (draft, B-scope chosen)
**Depends on:** v0.4.2-pmm-cards-conditional

## Problem

Operator runs a PMM instance that already monitors a dozen DBs
across multiple hosts. Some are DinoPanel-managed, but many are
not (native installs on other Rocky boxes, separate Docker hosts,
RDS-style remote endpoints). Today DinoPanel's `/databases` page
only shows what it created itself, so operator sees a half-picture
in DinoPanel and the full picture only after switching to PMM.

Original v0.X draft framed three options for resolving this:
A (full inventory union, ~1-2 weeks), B (limited read-only panel,
~3 days), C (decline, archive). After review, **B** chosen — it
satisfies the operator's stated need without the structural commit
of unifying inventory schemas or implying a multi-host DinoPanel
direction.

## What B is

Under `/databases`, two stacked sections:

1. **"DinoPanel-managed"** — existing table, unchanged.
2. **"External PMM-monitored"** — new read-only panel listing
   services PMM knows about that are **not** in DinoPanel's
   `db_instances` (deduplicated by `service_name`).

For each external row:
- service-name, engine type, host, port from PMM inventory
- the 4 metric cards (QPS / connections / uptime / replication lag)
- a per-row "Open in PMM" deep link
- **no** connection-info card (we don't have credentials)
- **no** start/stop/restart/rotate buttons (we don't manage it)

## What B is not

- Not a unified table — managed and external stay visually
  separated. Operator can tell at a glance which DBs DinoPanel
  controls.
- Not a remote-host inventory. We don't introduce a `hosts`
  table, agent registry, or remote-control plane.
- Not auto-register or "Mark as registered" — those would expand
  scope toward `v0.4.x-pmm-cards-conditional` Option B and the
  underlying "DinoPanel writes to PMM" direction. Out of scope.

## How this resolves v0.4 decisions.md Q5

v0.4's stance was "DinoPanel integrates PMM, doesn't reimplement".
B respects that — PMM stays the source-of-truth for inventory of
external DBs; we just project a read-only slice of it into our UI
so operators don't have to context-switch for a quick glance.

## Resolved sub-questions (from v0.X draft)

- **Q1 cadence**: refresh-button + initial fetch on page load.
  No polling. Inventory changes are deliberate operator actions —
  polling wastes API calls.
- **Q2 UI representation**: two stacked sections, managed on top,
  monitored below. Not a unified table, not tabs.
- **Q3 external-row display**: service-name, engine, host, port,
  4 metric cards, "Open in PMM" link. No connection card, no
  actions.
- **Q4 managed row whose PMM service was deleted**: already
  covered by v0.4.2 — reconcile flips `pmmRegistered=false` →
  drawer shows "not registered" hint. No new work in v0.5.
- **Q5 multi-host lock-in**: explicitly avoided. B is pure
  UX-side fetch, no remote-host data model introduced.

## Phases

- **Phase 1** (~1 day) — PMM `listServices()` client + auth failure
  handling + unit tests against fake PMM server.
- **Phase 2** (~0.5 day) — Backend endpoint
  `GET /api/databases/external-pmm` + 30s cache (mirroring the
  existing PromQL cache).
- **Phase 3** (~1 day) — Frontend stacked section under
  `/databases` + read-only metric card reuse + i18n.
- **Phase 4** (~0.5 day) — Tests: dedup by service-name,
  partial-failure paths (PMM down vs auth fail vs empty).

Total: ~3 dev-days. Likely spans 2-3 sessions.

## Sessions log

- 2026-05-20: activated; Phase 1 starting (this session).

## Related code

- `apps/server/src/modules/monitoring/pmm-promql.client.ts` —
  Phase 1 either extends this with a `listServices()` method or
  adds a sibling `pmm-inventory.client.ts`. Will share the
  `resolveConfig()` and `PmmClientConfig` shape regardless.
- `apps/web/src/routes/databases/index.tsx` — gains a second
  section below the managed table.
- `.arceus/changes/v0.4-databases/decisions.md` Q5 — original PMM
  integration framing.
- `.arceus/changes/v0.X-multihost-pmm-inventory/` — superseded
  draft (archived).
