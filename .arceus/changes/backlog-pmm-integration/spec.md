# Spec — backlog-pmm-integration (Option A)

Scope: Option A from `proposal.md` only. Option C is deferred to
v0.4 when the database module gives those cards a natural home.

## Acceptance criteria

### Backend

- New module `apps/server/src/modules/monitoring/`.
- New endpoint `GET /api/monitoring/pmm/status` returning:
  ```ts
  { ok: boolean; latencyMs: number | null; lastChecked: string }
  ```
  - Fetches `<pmmUrl>/v1/readyz` with a 5 s timeout.
  - Trusts self-signed certificates for the admin-configured URL.
    Justified by: the URL is set explicitly by the panel admin
    (not user-supplied), and PMM ships with self-signed certs by
    default.
  - `ok: true` when HTTP 200; `ok: false` otherwise (timeout,
    network error, non-200 status).
  - `latencyMs` is the round-trip in milliseconds; `null` on
    failure.
- New endpoint `GET /api/monitoring/pmm/config` and
  `PUT /api/monitoring/pmm/config`:
  - GET returns `{ url: string | null }`.
  - PUT accepts `{ url: string | null }`. URL must be a valid
    `https?://...` (no path / query enforcement — PMM serves the
    health endpoint at the root). Persisted as
    `settings.key = 'monitoring.pmm_url'` in the existing
    `settings` table — no migration needed (see decisions.md §4).
- No credentials are stored. PMM authentication happens entirely
  inside PMM's own UI when the user opens it in a new tab.
- Auth: existing JWT guard applies to all three endpoints (only
  logged-in panel users can read / write the config).

### Frontend

- Sidebar entry `資料庫監控 / Database Monitoring` (lucide
  `Activity` icon), positioned after `Compose` and before
  `Settings`.
- New route `/monitoring` renders a single page with:
  - If no URL configured: an empty-state card saying "PMM URL not
    configured" with a link to Settings.
  - If URL configured: a status card showing:
    - A status dot (green if `ok`, red if not), the URL, the last
      check timestamp, and the latency in ms.
    - A button "在 PMM 中查看 / Open in PMM" that opens the URL in
      a new tab (`target="_blank"`, `rel="noopener noreferrer"`).
    - The status auto-refreshes every 30 s via react-query.
- Settings page gains a new section "外部監控 / External monitoring"
  with a `PMM URL` text input + Save button. Save calls the PUT
  endpoint and invalidates the status query.
- All new strings have keys in both `zh-TW.json` and `en.json`.

### Tests

- Backend unit tests in
  `apps/server/src/modules/monitoring/__tests__/`:
  1. `status` returns `{ ok: true, latencyMs: <num> }` when the
     PMM endpoint responds 200.
  2. `status` returns `{ ok: false, latencyMs: null }` when the
     PMM endpoint times out.
  3. `status` returns `{ ok: false, latencyMs: null }` when no URL
     is configured (instead of throwing).
- Vitest suite stays at 90 baseline + 3 new = 93.
- Typecheck / lint clean, build green.

### Out of scope

- iframe embedding (Option B from proposal).
- Any PMM API consumption beyond `/v1/readyz`.
- Storing PMM credentials.
- Per-database / per-instance summary cards (Option C — deferred
  to v0.4).
- Multi-instance PMM (one PMM at a time).
