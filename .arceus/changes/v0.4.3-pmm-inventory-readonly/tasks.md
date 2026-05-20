# Tasks — v0.4.3 PMM inventory readonly

## Phase 1 — PMM listServices client (done 2026-05-20)

- [x] Create `apps/server/src/modules/monitoring/pmm-inventory.client.ts`
- [x] Export `PmmService` type + `InventoryResult` union
- [x] `@Injectable() PmmInventoryClient` class with `listServices()`
- [x] Standalone `executeInventoryList(config)` fn (for direct unit tests)
- [x] POST `/v1/inventory/Services/List` with `{}` body
- [x] Engine normalization (mysql/postgresql/mongodb pass-through;
  external+name~redis → redis; else unknown)
- [x] Drop rows missing required fields (service_id / service_name / node_id)
- [x] Wire provider into `MonitoringModule`
- [x] Unit tests at `apps/server/src/modules/monitoring/__tests__/pmm-inventory.test.ts`
  (10 cases — multi-engine flatten, empty, redis-via-external, unknown-via-external,
  drop-bad-rows, 401, unreachable, malformed, not_configured, request-shape)
- [x] typecheck + lint + test + build all green (265/265)
- [x] Commit: `feat(databases): PMM inventory client (phase 1 of v0.5)`

## Phase 2 — Backend endpoint (done 2026-05-20)

- [x] `GET /api/databases/external-pmm` route on databases controller
  (refresh=1 bypass mirrors `:id/metrics` contract)
- [x] 30s in-memory cache keyed on resolved PMM URL (auto-invalidate
  when settings URL changes — different key)
- [x] Dedup at server: filter PMM services whose `serviceName` matches
  any `db_instances.containerName` (containerName == PMM service_name
  by convention per paths.ts)
- [x] Failure modes wrap as `{ services: [], error: { reason }, fetchedAt }`
  with `not_configured | auth | unreachable | bad_response` reasons
- [x] Shared schema `pmmExternalServicesResponseSchema` added
- [x] `ExternalPmmService.invalidateAll()` for future settings-change hook
- [x] 8 service-level tests (dedup, empty, auth surface, not_configured,
  cache hit within 30s, refresh forces re-query, engine pass-through,
  invalidateAll)
- [x] typecheck + lint + test + build all green (273/273)
- [x] Commit: `feat(databases): external-pmm endpoint + cache (phase 2 of v0.5)`

## Phase 3 — Frontend section (done 2026-05-20)

- [x] New `apps/web/src/routes/databases/external-pmm-section.tsx`
- [x] New hooks `useExternalPmm()` + `useRefreshExternalPmm()` in `use-databases.ts`
  (refresh hits `?refresh=1` and `setQueryData` so UI updates in one round-trip)
- [x] `/databases/index.tsx` renders managed table + external section below,
  managed wrapped in a labelled `<section>` for symmetry
- [x] Hide entire external section when PMM URL not configured (either
  `pmmUrl==null` from `usePmmConfig` OR server-side `error.reason='not_configured'`)
- [x] Empty / error states with distinct copy (auth / unreachable /
  bad_response → distinct strings; not_configured → section disappears)
- [x] Extracted `MetricCard` + `fmtDuration` to shared `metric-card.tsx`
  for drawer + future re-use (drawer imports the new module)
- [x] Per-row layout: service-name (mono) + engine badge (reuses ENGINE_META)
  + host:port + Open in PMM link. **No per-row metric cards** —
  see D7 in decisions.md (cost vs. value).
- [x] Refresh button at section header → invalidates query + refetch +
  spinner animation while pending. Last-refreshed indicator alongside.
- [x] "Open in PMM" link template: `{pmmUrl}/graph/inventory/services/{serviceId}`
  (PMM 2.x deep-link to inventory service page)
- [x] i18n keys (zh-TW + en) under `databases.external_pmm.*` and
  `databases.section_managed` for the new label
- [x] typecheck + lint + test + build all green (273/273)
- [x] Commit: `feat(databases): /databases external PMM section (phase 3 of v0.5)`

## Phase 4 — Integration tests + v0.4.3 cut (done 2026-05-20)

> Re-numbered from v0.5.0 → v0.4.3 during Phase 4 — PMM inventory
> is v0.4 lineage, not a new release line. The v0.5 label was
> already taken by the firewall/scheduler/logs scope (shipped at
> package version 0.2.x without ever owning the 0.5.x package).

- [x] Server: dedup test — managed `containerName='dinopanel-mysql-shop'`
  AND PMM returns same → external list excludes it (Phase 2 test #1)
- [x] Server: partial-failure tests — auth (Phase 2) +
  not_configured (Phase 2) + unreachable (Phase 4) +
  bad_response (Phase 4) + failure-not-cached (Phase 4)
- [x] Frontend section: no new test — same deferral pattern as
  v0.4.2's drawer test (mostly layout glue over already-tested
  service layer)
- [x] Bump 0.4.2 → 0.4.3 (4 package.json + sidebar label + README
  tarball ref)
- [x] Rename change folder v0.5-pmm-inventory-readonly →
  v0.4.3-pmm-inventory-readonly; update meta.json id +
  archived-v0.X meta.json supersededBy reference
- [x] Update `.arceus/changes/README.md` index — v0.4.3 completed
  row replaces v0.5 row
- [x] Update `README.md` roadmap — add v0.4.3 row between v0.4.2
  and v0.6
- [x] Update `docs/databases.md` — header bump, new "External PMM
  section (v0.4.3)" with endpoint contract, dedup, engine
  normalization, D7 rationale. Also folded in a v0.4.2 drawer
  section that was missing from earlier docs.
- [x] typecheck + lint + test + build all green (276/276)
- [x] Commit: `release(v0.4.3): read-only PMM inventory section in /databases`

## Smoke (optional, post-merge, Rocky 234 has no PMM)

- v0.4.3 ships meaningful UI only if a PMM instance is reachable.
  Rocky 234 doesn't have one. Smoke this against a dev PMM container
  before tagging v0.4.3 as "smoke-passed", OR ship as code-only and
  flag in meta.
