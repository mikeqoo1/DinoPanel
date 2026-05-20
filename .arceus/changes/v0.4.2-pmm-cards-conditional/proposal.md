# v0.4.2 — Conditional PMM cards rendering

**Status:** completed (2026-05-20)
**Target:** v0.4.2
**Depends on:** v0.4.1-smoke-patches
**Origin:** v0.4 Rocky 234 smoke, 2026-05-20

## Problem

The drawer's `PMM 摘要` section rendered four cards (QPS / 連線數
/ 運行時間 / 複寫延遲) for every instance, even when:

1. `monitoring.pmm_url` IS configured globally
2. but the specific instance is **not registered with PMM**

In that case the PromQL queries match no series → server returns
`{ pmmConfigured: true, qps: null, connections: null, ... }` → UI
rendered "—" in all four cards.

Operator reads this as "PMM is broken" when really the answer is
"this instance was never told to PMM, so PMM has no data to show".

## What changed

Two new UI states under the PMM summary section:

1. **`not-registered`** — PMM is reachable, all four metrics null,
   `instance.pmmRegistered === false`. Renders a single line:
   "此實例尚未在 PMM 中註冊，無即時指標可顯示。請於 PMM 主機執行
   pmm-admin add 後再回來檢視。"

2. **`exporter-unhealthy`** — PMM is reachable, all four metrics
   null, `instance.pmmRegistered === true`. Renders:
   "已標記為已註冊但 PMM 沒有回傳資料，可能是 exporter 異常。
   請至 PMM 端確認該服務狀態。"

The existing `pmmConfigured === false` branch (no PMM URL set at
all) is unchanged.

## How the original Q1 was resolved

The proposal flagged Q1: distinguishing "instance not registered"
from "exporter down" — and suggested a PMM service-list probe as
the answer. After reading the code we noticed:

- `pmmRegistered: boolean` is **already** on the `db_instances`
  schema (`apps/server/src/database/schema.ts:222`)
- It's **already** on the DTO and the shared
  `DbInstanceResponse` schema (`packages/shared/src/schemas/databases.ts:84`)
- Default is `false`; no current code path flips it

So the answer to Q1 turned out to be cheaper than expected: use
the existing flag, no PMM service-list probe needed, no new PMM
Management API client. If `pmmRegistered === false`, it means the
operator (or a future Option B endpoint) hasn't told us "yes, this
instance is registered" — `not-registered` is the right message.
If `pmmRegistered === true` but PMM returns nothing, it's
genuinely an exporter problem.

## What's deferred

**Option B (auto-register)** — `POST /api/databases/:id/pmm-register`
that actually calls PMM Management API, plus a "Register in PMM"
button on the drawer. Deferred because:

1. The unit-of-work is larger (~2-3 days for PMM API client +
   per-engine agent config + credentials reuse decision).
2. Whether DinoPanel should actively write to PMM is bundled with
   the open product-direction question in
   `v0.X-multihost-pmm-inventory` (does DinoPanel become a unified
   DB inventory tool, or stay a panel for self-managed instances?).
   Better to decide both together.

**"Mark as registered" button** — also out of scope for this
release. Operators currently register from PMM side via
`pmm-admin add`. If `pmmRegistered` needs to be flipped, that
happens server-side as part of Option B (proper auto-register)
rather than a UI toggle that lets the flag drift from reality.

## Files touched

- `apps/web/src/routes/databases/pmm-card-state.ts` — new pure
  helper, takes `{ isPending, data, pmmRegistered }`, returns one
  of `'pending' | 'not-configured' | 'not-registered' |
  'exporter-unhealthy' | 'show-cards'`.
- `apps/web/src/routes/databases/__tests__/pmm-card-state.test.ts`
  — 8 cases covering every branch + edge cases (settled but data
  undefined, partial nulls like Redis which has no replication lag).
- `apps/web/src/routes/databases/database-drawer.tsx` — drawer
  routes the state to the right UI piece; cards still render via
  the same `MetricCard` mapping when state is `show-cards`.
- `apps/web/src/i18n/zh-TW.json` + `en.json` — added
  `pmm_not_registered` + `pmm_exporter_unhealthy` under
  `databases.drawer`.

## Verification

- 8/8 new helper unit tests pass.
- All existing tests still pass (~247 total across server/web/shared).
- typecheck + lint + build all green.
