# Tasks — v0.5 PMM inventory readonly

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

## Phase 2 — Backend endpoint (next session)

- [ ] `GET /api/databases/external-pmm` route on existing databases controller
- [ ] 30s in-memory cache (Map<pmmUrl, { ts, services }>)
- [ ] Dedup at server: filter PMM services whose `serviceName` matches
  any `db_instances.serviceName` (column already exists per v0.4 schema)
- [ ] Failure modes wrap as `{ services: [], error: { reason } }`
- [ ] Controller test ≥ 4 cases
- [ ] Commit: `feat(databases): external-pmm endpoint with 30s cache (phase 2)`

## Phase 3 — Frontend section (next session)

- [ ] New `apps/web/src/routes/databases/external-pmm-section.tsx`
- [ ] New hook `useExternalPmm()` in `use-databases.ts`
- [ ] `/databases/index.tsx` renders managed table + external section below
- [ ] Hide entire external section when PMM URL not configured
- [ ] Empty / error states with distinct copy
- [ ] Each row uses existing MetricCard component for the 4 cards
- [ ] Refresh button at section header → invalidates query + refetch
- [ ] "Open in PMM" link template: `{pmmUrl}/graph/inventory/services/{serviceId}`
- [ ] i18n keys (zh-TW + en) under `databases.external_pmm.*`
- [ ] Commit: `feat(databases): /databases external PMM section (phase 3)`

## Phase 4 — Integration tests + v0.5.0 cut (next session)

- [ ] Server: dedup test — managed serviceName='postgres-shop' AND
  PMM returns same → external list excludes it
- [ ] Server: partial-failure tests (auth, unreachable, bad_response)
- [ ] Frontend: section renders against mock external services
- [ ] Bump 0.4.2 → 0.5.0 (4 package.json + sidebar + README tarball ref)
- [ ] Update `.arceus/changes/README.md` index → v0.5 completed
- [ ] Update `README.md` roadmap row for v0.5
- [ ] Update `docs/databases.md` with external-section docs
- [ ] Commit: `release(v0.5.0): read-only PMM inventory section in /databases`

## Smoke (optional, post-merge, Rocky 234 has no PMM)

- v0.5 ships meaningful UI only if a PMM instance is reachable.
  Rocky 234 doesn't have one. Smoke this against a dev PMM container
  before tagging v0.5.0 as "smoke-passed", OR ship as code-only and
  flag in meta.
