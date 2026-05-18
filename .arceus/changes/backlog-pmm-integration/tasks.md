# Task Checklist — backlog-pmm-integration (Option A)

## Backend

- [x] **Storage decision revised**: reuse the existing key-value
  `settings` table with key `monitoring.pmm_url` rather than
  introduce a new single-row table — saves a migration. See
  `decisions.md §4`.
- [x] New module `apps/server/src/modules/monitoring/`:
  - `monitoring.module.ts`
  - `monitoring.service.ts` — `getConfig()`, `setConfig(url)`,
    `getPmmStatus()`. Probe uses `node:https.request` with
    `rejectUnauthorized: false`, 5 s timeout, latency measured
    via `performance.now()`.
  - `monitoring.controller.ts` — three endpoints
    (`GET /config`, `PUT /config`, `GET /status`).
- [x] Registered MonitoringModule in `app.module.ts`.
- [x] 8 vitest cases (more than the spec asked for — added
  setConfig validation + null clearing + non-200 / unreachable
  status paths).

## Frontend

- [x] `apps/web/src/hooks/use-monitoring.ts` — `usePmmConfig()`,
  `useSetPmmConfig()`, `usePmmStatus()` (auto-refresh every 30 s,
  enabled only when a URL is configured).
- [x] New route `apps/web/src/routes/monitoring.tsx`, lazy-loaded
  via `App.tsx`. Empty-state when no URL configured; status card
  with traffic-light dot, URL, latency, "last checked" relative
  time, "Open in PMM" button + "Configure" deep link.
- [x] Sidebar entry in `apps/web/src/components/layout/sidebar.tsx`
  using lucide `Activity`, positioned after Compose and before
  Settings.
- [x] Settings page card `external_monitoring` with a PMM URL
  input + Save button.
- [x] i18n keys in zh-TW + en for `nav.monitoring`, `monitoring.*`,
  `settings.external_monitoring.*`.

## Verification

- [x] `pnpm typecheck` 0 errors.
- [x] `pnpm lint` 0 warnings (fixed an `import type` lint hit on
  AddressInfo in the test file).
- [x] `pnpm test` 98 / 98 green (90 baseline + 8 new MON-1..MON-8).
- [x] `pnpm build` pass. Main bundle gzip 104.87 → 105.60 kB
  (+0.73 — page + hook + settings card).
- [x] Live API smoke against user's PMM at 192.168.199.234:18443:
  - GET /config → null (initial).
  - PUT /config → `{ url: "https://192.168.199.234:18443" }` (trim).
  - GET /status → `{ ok: true, latencyMs: 57, lastChecked: ... }` —
    confirms the self-signed-cert relaxation works.
  - PUT bad URL ("not-a-url") → 400 `MONITORING_INVALID_URL`.

## Close-out

- [x] `meta.json.status` flipped to `completed`, verification
  block populated.
- [x] `.arceus/changes/README.md` index + next-session note
  updated.
