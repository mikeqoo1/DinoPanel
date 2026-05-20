# Decisions — v0.5 PMM inventory readonly

## D1: Option B chosen (limited integration, not full union)

**Decision:** Surface external PMM services as a read-only section
under `/databases`, visually separated from the managed table.
**Not** a unified table with a "Source" column.

**Why:**
- Satisfies operator's stated need ("see PMM-monitored DBs in /databases")
- Doesn't commit DinoPanel to becoming a unified DB inventory tool
- Preserves the v0.4 stance "integrate PMM, don't reimplement"
- ~3 dev-days vs ~1-2 weeks for full union (A)
- B's code is a strict subset of A — if we ever choose to expand,
  no work is wasted

**Rejected: Option A** (~1-2 weeks). Full union implies multi-host
DinoPanel direction; not warranted until operator explicitly
requests it.

**Rejected: Option C** (decline). Operator's ask is concrete and
B addresses it cheaply.

## D2: Sibling client (`PmmInventoryClient`), not extended `PmmPromqlClient`

**Decision:** New file `apps/server/src/modules/monitoring/pmm-inventory.client.ts`
holding the inventory API logic, sharing `PmmClientConfig` and
`resolveConfig()` from the PromQL client.

**Why:**
- The two clients hit different PMM API surfaces
  (`/prometheus/api/v1/query` vs `/v1/inventory/Services/List`)
  with different request shapes (GET querystring vs POST JSON body)
- Tests stay focused — fake-PMM servers for inventory don't need
  PromQL parser scaffolding and vice versa
- Easier to delete one without affecting the other
- Type union pattern (`InventoryResult = { ok: true; services } | { ok: false; reason }`)
  mirrors `PromqlResult`, keeping consumer code symmetric

## D3: Refresh-button cadence (no polling)

**Decision:** Frontend fetches external inventory once on page
load + manually via a refresh button. No automatic polling.

**Why:**
- Inventory changes are deliberate operator actions (registering
  a DB in PMM is a multi-step manual process); polling has near-zero
  ROI vs API call cost.
- The 4 metric cards per external row will use the existing
  30s PromQL cache via the metrics endpoint — fresh metrics
  don't require fresh inventory.
- Server-side 30s cache on the inventory endpoint protects against
  refresh-button hammering.

## D4: Two stacked sections, not tabs

**Decision:** Both sections live in the same scroll view, managed
above, external below.

**Why:**
- Operator's mental model is "DinoPanel-managed plus everything
  else in PMM" — keeping them visible together reinforces that
  DinoPanel is intentionally a partial view of PMM's world.
- Tabs would hide one or the other; that's wrong for a "see
  everything PMM knows about" workflow.
- Stacked beats split-table-with-Source-column because the
  schemas differ — external rows have no actions and no
  connection card; mixing them in one row layout would be
  visually noisy.

## D5: Engine normalization keeps Redis explicit

**Decision:** Map PMM's `external` service type to `redis` when
the `service_name` matches `/redis/i`, otherwise `unknown`.

**Why:**
- PMM 2.x doesn't have first-class Redis support; operators
  typically register `redis_exporter` as an `external` service
- DinoPanel manages Redis as a first-class engine, so when
  matching external rows against `db_instances` we want to find
  a Redis name match
- `unknown` for anything else preserves the row in the UI but
  hides the engine badge

## D7: External rows show inventory metadata only, no per-row metric cards

**Decision:** In Phase 3, external PMM rows render service-name +
engine badge + host:port + Open-in-PMM link. **No** 4-card metric
grid per row.

**Why:**
- Option B's design framing is "DinoPanel surfaces what PMM knows
  about, PMM owns the live data". Rendering per-row metric cards
  duplicates effort — the operator who wants live numbers clicks
  Open-in-PMM, which is one click.
- Per-row metrics would mean 4 PromQL queries × N rows per refresh.
  Server-side 30s cache helps but the first refresh after any
  inventory change still hits PMM with `4*N` queries.
- The current proposal.md mentioned cards on external rows; this
  decision intentionally pulls them back. Symmetric layout with
  the drawer's 4 cards would be nice-to-have but is not load-bearing
  for the "see external DBs in /databases" workflow.
- Empty all-`—` cards would also collide visually with v0.4.2's
  "not registered" / "exporter unhealthy" hint UX — operators would
  rightly ask "is this exporter broken?" when the answer is just
  "we didn't fetch metrics here".

**Re-evaluate:** if operator asks for inline metrics on external
rows, add a separate `GET /api/databases/external-pmm/:serviceId/metrics`
endpoint with per-service PromQL fan-out + 30s cache (mirroring
the managed `:id/metrics` shape). Estimated +1 day. Probably best
to gate on real operator feedback rather than ship speculatively.

## D6: No version bump until all phases ship

**Decision:** Phases 1-4 each commit individually with
`feat(databases): PMM inventory ... (phase N)`. No `package.json`
bump or sidebar label change until Phase 4 lands; then cut v0.5.0
in a single release commit.

**Why:**
- Phase commits mid-feature shouldn't roll the version (followed
  v0.4 pattern with its 6 phases)
- One v0.5.0 release commit at the end gives a clean tarball
  artefact for operators to upgrade to
