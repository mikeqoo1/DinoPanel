# Tasks — v0.4.1 smoke patches

Meta-only release: five fixes already on main, bundled under a
version bump. The tasks below are the release-cut checklist, not
implementation work.

## Pre-cut state

- [x] All five fix commits on `main` (a8b4fa9, 89eacd5, bf49ef3,
  6a21d19, c4a29e2)
- [x] v0.4.0 release commit `033db4c` is the immediate parent of
  the fix chain
- [x] Working tree clean before bump

## Cut steps

- [x] Bump `package.json` (root) → `0.4.1`
- [x] Bump `apps/server/package.json` → `0.4.1`
- [x] Bump `apps/web/package.json` → `0.4.1`
- [x] Bump `packages/shared/package.json` → `0.4.1`
- [x] Bump `apps/web/src/components/layout/sidebar.tsx` label → `v0.4.1`
- [x] Bump `README.md` tarball reference (`tar -xzf …` snippet)
- [x] Create `.arceus/changes/v0.4.1-smoke-patches/{meta,proposal,tasks}.md`
- [x] Update `.arceus/changes/README.md` index — add v0.4.1 row
- [x] Update `README.md` roadmap — add v0.4.1 row

## Verification

- [ ] `pnpm typecheck` — green
- [ ] `pnpm lint` — green
- [ ] `pnpm test` — green
- [ ] `pnpm build` — green
- [ ] Single release commit `release(v0.4.1): bundle five smoke patches`

## Optional operator steps (post-cut)

- [ ] Rebuild tarball: `bash scripts/build-release.sh --prebuild=x64`
- [ ] Redeploy to Rocky 234 to confirm upgrade-mode install path
  (exercises fixes #1 and #3 end to end)

## Deferred (out of scope, drafts already exist)

- `v0.4.x-pmm-cards-conditional` — drawer PMM cards show "—"
  when instance not registered with PMM (UI hint + optional
  auto-register; spec mentions stretch goal not shipped)
- `v0.X-multihost-pmm-inventory` — surface non-DinoPanel DBs
  visible to PMM under `/databases` (large change, blocked on
  product-direction decision: does DinoPanel become a unified DB
  inventory tool, or stay a panel for self-managed instances?)
