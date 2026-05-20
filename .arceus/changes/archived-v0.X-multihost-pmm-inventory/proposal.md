# v0.X — Multi-host PMM inventory in /databases

**Status:** draft
**Origin:** v0.4 Rocky 234 smoke, 2026-05-20
**Note:** Larger scope than v0.4.1 — bumps roadmap (likely v0.5 or v0.6).

## Problem

Operator runs a PMM instance that already monitors a dozen DBs
across multiple hosts:
- some DinoPanel-managed (containers DinoPanel created)
- some operator-managed (native install on Rocky, separate
  Docker hosts, RDS-style remote endpoints, etc.)

Today DinoPanel's `/databases` page only shows what it created
itself (rows in `db_instances`). The operator sees a half-picture
in DinoPanel and the full picture in PMM. They want to see
**everything PMM knows about** under one /databases list, with
clear labels for "DinoPanel-managed" vs "external (PMM-monitored)".

## Why this is a bigger lift than v0.4.1

1. **Inventory source changes**: today the list comes from
   `db_instances` table. After: union of (`db_instances` rows) +
   (PMM `inventoryService.listServices` results), de-duplicated by
   `service_name` (which DinoPanel managed instances already use
   as their PMM identifier per decisions.md Q5).

2. **Multi-host model**: an external PMM-monitored DB sits on a
   host that isn't running DinoPanel. The UI needs:
   - separate badge/icon for "remote" rows
   - host/port/agent-id columns from PMM inventory
   - disabled Start/Stop/Restart/Rotate (no docker socket access)
   - read-only PMM cards for these rows (the metrics are the
     *only* thing we can show)

3. **Auth model**: DinoPanel currently treats PMM as a downstream
   metrics source. After: PMM is also an upstream inventory source
   — need to handle pagination, auth failures, partial inventory
   sync, network blips during inventory fetch.

4. **DinoPanel becomes a "PMM viewer"**: this is a positioning
   decision. v0.4's framing (decisions.md Q5) was "DinoPanel
   integrates PMM, doesn't reimplement". This expands that
   integration deeper — DinoPanel becomes a UX layer over PMM for
   the DB list itself. Worth confirming with operator that this
   is the intended direction (vs operator-side "open PMM in tab"
   workflow they currently have).

## Open questions (need answers before activating)

1. **Inventory refresh cadence?** Polled every 30 s like the PromQL
   summary, on-demand only (refresh button), or live via PMM
   webhook? Probably 60 s polling + refresh button.

2. **Local vs remote union — UI representation?** One table with a
   "Source" column? Two stacked sections ("Managed by DinoPanel"
   on top, "Monitored only" below)? Tabs?

3. **What happens when a PMM service has no matching DinoPanel
   row?** Show the limited info we have (host / port / agent-id /
   service-name / engine type from PMM metadata) + the four PromQL
   cards. No connection card (we don't have credentials). That's
   the explicit "monitored not managed" state.

4. **Reverse — DinoPanel row whose PMM service was deleted by
   operator?** Today our reconcile already marks
   `pmmRegistered: false` if registration fails. With the union,
   need a way to flag this in the unified list ("monitored ❌").

5. **Multi-host implications for v0.5+ roadmap?** If we go down
   this path, the next natural step is multi-host DinoPanel itself
   (control plane managing remote DinoPanel agents). Different
   scope entirely. Worth at least *not painting ourselves into a
   corner* — keep the inventory model open enough.

## Sizing (rough — depends on Q1/Q2 answers)

- PMM inventory API client + sync service: ~3 dev-days
- UI unification + per-source badge + disabled action states for
  remote rows: ~2 dev-days
- Testing (multi-source merge, dedup, partial-failure paths):
  ~2 dev-days
- Total: **~1 week** if Q1/Q2 stay simple; up to ~2 weeks if we
  end up redesigning the row schema or introducing a remote-host
  model.

## Related

- `.arceus/changes/v0.4-databases/decisions.md` Q5 — original
  framing of DinoPanel as PMM integrator
- `apps/server/src/modules/monitoring/pmm-promql.client.ts` —
  HTTP layer we'd extend with a `listServices()` method against
  PMM's inventory API
- `apps/server/src/modules/databases/db-instances.service.ts`
  — `reconcile()` already has a "scan dockerode, sync rows"
  pattern that the PMM-inventory sync could mirror

## Next step

Activate this change only after the operator confirms direction:
"Yes, DinoPanel should be the unified DB inventory view across
managed + PMM-monitored" is a significant product decision.
