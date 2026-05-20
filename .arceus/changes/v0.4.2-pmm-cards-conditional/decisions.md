# Decisions — v0.4.2 PMM cards conditional

## D1: Use existing `pmmRegistered` flag rather than PMM service-list probe

**Decision:** Distinguish "not registered" from "exporter down"
using the `pmmRegistered: boolean` column that already exists on
the `db_instances` schema and `DbInstanceResponse` DTO. Don't add
a PMM Management API service-list probe.

**Why:** The proposal's Q1 suggested a service-list probe to
distinguish the two states. After reading the code we found the
flag is already plumbed end-to-end — it's just defaulted to
`false` and no code path flips it. Using the existing field
keeps the change pure-frontend, avoids introducing a PMM
Management API client (which would also need credentials and
per-engine auth handling), and means the change can ship as a
patch release in ~2 hours instead of ~1 dev-day.

**Trade-off:** Until Option B (proper auto-register) ships,
`pmmRegistered` will always read `false`, so the UI will always
show "not-registered" rather than "exporter-unhealthy". This is
fine — `not-registered` is the accurate state for every Rocky 234
instance today (none of them are in PMM). When B eventually lands,
the flag will start flipping to `true` and `exporter-unhealthy`
will start triggering for real.

## D2: No "Mark as registered" button in UI

**Decision:** Don't add a button that lets operators flip
`pmmRegistered` from the UI without actually registering with PMM.

**Why:** The flag's value is "trust the server about whether PMM
has data for this instance". If we let a UI toggle flip it
arbitrarily, the flag becomes a lie when operators forget to
actually `pmm-admin add` on the PMM side, and we lose the only
signal that distinguishes "exporter down" from "never registered".
Better to wait for Option B (real register endpoint) than to ship
a half-measure that defeats D1.

## D3: Defer Option B (auto-register endpoint + button)

**Decision:** Don't ship `POST /api/databases/:id/pmm-register`
or a "Register in PMM" UI button in this release.

**Why:**
1. Larger scope (~2-3 days vs. ~2 hours).
2. Requires a decision on credentials UX — does PMM agent reuse
   the rotation password we manage, or does the operator provide
   a separate PMM agent account?
3. The "DinoPanel writes to PMM" direction is the same question
   the `v0.X-multihost-pmm-inventory` draft is gated on (does
   DinoPanel manage PMM, or just observe it?). Better to make
   that call once, for both changes.

**Re-evaluate:** when operator answers the
`v0.X-multihost-pmm-inventory` product-direction question.

## D4: Extract pure helper instead of testing the drawer directly

**Decision:** The conditional-render logic lives in a pure helper
`pmmCardState(input) → state-string`. The drawer JSX is a flat
mapping from state to UI element. Tests only cover the helper.

**Why:** Drawer-level tests would need QueryClient + i18n provider
+ all mutation hooks mocked — heavyweight for what is essentially
a state machine over `{ isPending, data, pmmRegistered }`. The
helper is 12 lines, has no React or async dependencies, and 8 unit
tests cover every state including settled-but-undefined-data and
partial-nulls (Redis has no replication lag).
