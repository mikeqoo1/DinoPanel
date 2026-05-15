# v0.2.1 — Task Checklist

- [x] `pnpm add -F @dinopanel/web yaml` *(2.9.0)*
- [x] Wire `parseDocument` + `setModelMarkers` inside
  `apps/web/src/routes/containers/compose-detail.tsx`
  *(closure helper `toMarker`, 200 ms debounce, cleanup on
  `editor.onDidDispose`; yaml package lands entirely inside the
  lazy `compose-detail` chunk — main bundle gzip unchanged at
  104.41 kB, compose-detail chunk now 34.05 kB gzip)*
- [x] Remove the v0.2 TODO comment for this hook-in
- [x] Verify: typecheck / lint / test (80/80) / build / playwright
  (5 baseline pass, 3 docker-gated skipped without env flag)
- [ ] Manual smoke: invalid YAML shows a red squiggle within ~200 ms;
  valid YAML clears it
  *(deferred — needs live UI session; logic verified via parser
  behaviour + agent's review of the wiring)*
