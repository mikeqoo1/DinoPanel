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
- [x] Manual smoke: invalid YAML shows a red squiggle within ~200 ms;
  valid YAML clears it
  *(verified 2026-05-17 on dev server — typed `services:\n  bad: [ un\n  another:\n    image: nginx:` into the `plane-app` compose editor; Monaco marker hover ("View Problem / No quick fixes available") + overview-ruler red indicator both visible, confirming `setModelMarkers` is firing)*
