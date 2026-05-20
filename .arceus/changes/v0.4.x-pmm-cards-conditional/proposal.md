# v0.4.x — Conditional PMM cards rendering

**Status:** draft
**Origin:** v0.4 Rocky 234 smoke, 2026-05-20

## Problem

The drawer's `PMM 摘要` section renders four cards (QPS / 連線數
/ 運行時間 / 複寫延遲) for every instance, even when:

1. `monitoring.pmm_url` IS configured globally
2. but the specific instance is **not registered with PMM**

In that case the PromQL queries match no series → server returns
`{ pmmConfigured: true, qps: null, connections: null, ... }` → UI
renders "—" in all four cards.

Operator reads this as "PMM is broken" when really the answer is
"this instance was never told to PMM, so PMM has no data to show".

## What was supposed to happen

spec.md flagged auto-register in PMM as a Phase 6 stretch goal:
`POST /api/databases/:id/pmm-register` calling
`pmm-admin add --service-name=<containerName>` so newly-created
instances would appear in PMM automatically.

That endpoint shipped as a stub (returns
`{ stub: true, phase: 6 }`); the wiring to PMM Management API was
deferred. So the gap exists by design — but the UI doesn't
acknowledge it.

## Options

**A. Hide the cards when all four metrics are null** — cheap; the
existing `pmmConfigured` boolean already distinguishes
"no PMM URL" from "PMM reachable but empty". Add a second branch
in the drawer: when `pmmConfigured && qps==null && connections==null
&& uptimeSeconds==null && replicationLagSeconds==null` → show a
single line "此實例未在 PMM 中註冊。" + an "Auto-register in PMM"
button (calls the existing stub, ideally Phase 6's real impl).

**B. Ship the auto-register Phase 6 stretch** — call PMM Management
API on instance create (and on a "Register in PMM" drawer button).
Bigger lift; needs PMM API client beyond the PromQL one we shipped.

**C. Both A and B** — the cleanest end state but two pieces of
work.

Recommendation: ship A in v0.4.1, defer B to a later release
once we know how often operators want auto-register vs manual.

## Open questions

- Q1: distinguish "all 4 nulls but PMM is up" (instance not
  registered) from "PMM exporter for that engine is down"? The
  former is OK + actionable, the latter is a real problem.
  Probably need a fifth probe (PMM service-list lookup) before
  rendering "not registered" vs "exporter down".

- Q2: auto-register UX — does the operator have to provide
  per-engine credentials again (PMM agent needs a DB user with
  PROCESS / REPLICATION CLIENT privs)? Or can we reuse the
  rotation password we already manage?

## Sizing

Option A alone: ~1 dev-day (UI conditional + small backend
endpoint to check PMM service list).

Option B (auto-register): ~2-3 dev-days depending on per-engine
agent-config quirks.

## Related

- `.arceus/changes/v0.4-databases/decisions.md` Q5 (PMM
  integration depth)
- `.arceus/changes/v0.4-databases/spec.md` §PMM Management API
  (Phase 6 stretch)
- `apps/server/src/modules/databases/db-metrics.service.ts`
  (`summaryFor` returns `pmmConfigured` flag — already there)
- `apps/web/src/routes/databases/database-drawer.tsx` (the cards
  render unconditionally inside the `if pmmUrl` branch right now)
