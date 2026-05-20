# Tasks — v0.4.2 PMM cards conditional

## Scope

Option A only. Option B (auto-register endpoint + button)
intentionally deferred — bundled with the product-direction
decision in `v0.X-multihost-pmm-inventory`.

## Implementation

- [x] Verify `pmmRegistered` flag flows from schema → DbInstanceResponse
  → drawer `instance` prop (no new server work needed)
- [x] Add `pmm_not_registered` + `pmm_exporter_unhealthy` keys to
  `apps/web/src/i18n/zh-TW.json` and `apps/web/src/i18n/en.json`
- [x] Extract `pmmCardState(input)` pure helper at
  `apps/web/src/routes/databases/pmm-card-state.ts`
- [x] Wire the drawer (`database-drawer.tsx`) to consume the helper
  and route the 5 states to UI
- [x] Add helper unit tests (8 cases covering every branch)

## Verification

- [x] `pnpm typecheck` — green
- [x] `pnpm lint` — green
- [x] `pnpm test` — green (8 new + 247 existing)
- [x] `pnpm build` — green

## Release

- [x] Bump 4 package.json + sidebar label + README tarball reference
  to v0.4.2
- [x] Update `.arceus/changes/README.md` index
- [x] Update top-level `README.md` roadmap
- [x] Commit + push origin/main
- [ ] Tarball rebuild (operator-triggered)
- [ ] Rocky 234 redeploy (operator-triggered)

## Out of scope (deferred)

- Auto-register endpoint (`POST /api/databases/:id/pmm-register`)
- "Register in PMM" or "Mark as registered" buttons
- PMM service-list probe / PMM Management API client
