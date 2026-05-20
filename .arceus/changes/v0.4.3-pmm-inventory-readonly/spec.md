# Spec — v0.5 read-only PMM inventory

## Acceptance criteria

### Phase 1 — PMM listServices client

- [ ] New module-internal `PmmInventoryClient` (sibling of
  `PmmPromqlClient`) or extended method on `PmmPromqlClient`.
  Decision: separate sibling `PmmInventoryClient` for clean
  separation, sharing `PmmClientConfig` + `resolveConfig()`.
- [ ] HTTP method **POST** `/v1/inventory/Services/List` with
  body `{}` (no filter; we want every service).
- [ ] Bearer token auth same as PromQL client; same TLS skip
  flag semantics.
- [ ] Typed result union mirroring `PromqlResult`:
  `{ ok: true, services: PmmService[] } | { ok: false, reason: PmmInventoryFailureReason }`
  with failure reasons: `not_configured | auth | unreachable | bad_response`.
- [ ] Normalize PMM's per-engine response groups (`mysql`,
  `postgresql`, `mongodb`, `proxysql`, `haproxy`, `external`) into
  a flat `PmmService[]`:
  ```ts
  interface PmmService {
    serviceId: string;
    serviceName: string;
    engine: 'mysql' | 'postgresql' | 'mongodb' | 'redis' | 'mariadb' | 'unknown';
    nodeId: string;
    address: string | null;
    port: number | null;
  }
  ```
- [ ] Engine mapping: `mysql` → `mysql` (also covers MariaDB
  since PMM doesn't distinguish — leave as `mysql` and let
  service-name heuristics handle it if needed later);
  `postgresql` → `postgresql`; `mongodb` → `mongodb`; `external`
  → `redis` if `service_name` matches `/redis/i`, else `unknown`.
- [ ] Unit tests against fake PMM server: ≥ 5 cases (success
  with mixed engines, empty result, auth 401, unreachable,
  malformed JSON, missing services array shape).

### Phase 2 — Backend endpoint (out of scope this session)

- [ ] `GET /api/databases/external-pmm` returns
  `{ services: PmmService[] }` with services that are NOT in
  `db_instances.serviceName` (dedup at server side).
- [ ] 30s in-memory cache keyed on PMM URL.
- [ ] Cache miss → call `PmmInventoryClient.listServices()`;
  cache hit → reuse.
- [ ] Failure modes surface as typed JSON: `{ services: [], error: { reason: '...' } }`
  so frontend can render distinct messages per failure.

### Phase 3 — Frontend (out of scope this session)

- [ ] `/databases` page renders two `<section>` blocks: managed
  (existing) and external (new).
- [ ] External section: collapsed by default if PMM URL not set
  (skip render entirely if `not_configured`).
- [ ] Empty state when PMM up but no extra services.
- [ ] Each row: service-name, engine badge, host:port, four
  read-only metric cards, "Open in PMM" link.
- [ ] Refresh button at section header — invalidates cache + refetch.
- [ ] i18n: zh-TW + en strings for section header / empty state /
  failure-mode hints.

### Phase 4 — Tests (out of scope this session)

- [ ] Server: dedup by `service_name` — if `db_instances` has
  `service_name='postgres-shop'` and PMM returns one with the
  same name, it's filtered out of the external list.
- [ ] Server: partial-failure path — PMM auth fail returns
  `{ services: [], error: { reason: 'auth' } }`, frontend shows
  "PMM auth failed" not "no external DBs".
- [ ] Frontend: stacked section renders correctly with mock data.

## Out-of-scope (explicit non-goals)

- Multi-host data model / remote agent registry.
- Auto-registering DinoPanel instances in PMM (covered by deferred
  `v0.4.x-pmm-cards-conditional` Option B).
- Cross-row operations (compare metrics across managed+external).
- Modifying external services in any way (DinoPanel never POSTs
  to PMM inventory in this scope).

## Verification gates

- typecheck pass
- lint pass (max-warnings=0)
- test pass: existing 255 + new Phase 1 cases (≥ 5)
- build pass
- Phase 1 commit: `feat(databases): PMM inventory client (phase 1)`
- No version bump until Phase 4 ships (v0.5.0 release commit).
