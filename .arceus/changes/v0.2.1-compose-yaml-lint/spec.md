# v0.2.1 — Spec

## Verification gates

- `pnpm typecheck` — 0 errors
- `pnpm lint` — 0 warnings
- `pnpm test` — 80/80 still passing (no new tests this iteration)
- `pnpm build` — successful; main bundle gzip stays under 110 kB
- `pnpm exec playwright test` — 5 baseline + 3 docker-gated still green

## Acceptance criteria

### 1. Dependency

- `apps/web/package.json` lists `yaml` under `dependencies` (latest
  stable, ≥ 2.x).
- `pnpm-lock.yaml` updated.
- No other dependency churn.

### 2. Monaco markers wired

In `apps/web/src/routes/containers/compose-detail.tsx`:

- `handleEditorMount` (or equivalent place that owns the model) sets
  up a content-change listener.
- On change, debounce ~200 ms before running `parseDocument(content)`.
- For every entry in `doc.errors` and `doc.warnings`, build a marker:
  ```ts
  {
    startLineNumber, startColumn,
    endLineNumber, endColumn,
    severity: doc.errors.includes(e) ? MarkerSeverity.Error : MarkerSeverity.Warning,
    message: e.message,
  }
  ```
  Positions come from `e.linePos` (1-based already; coerce to Monaco's
  1-based shape).
- `monaco.editor.setModelMarkers(model, 'yaml', markers)` replaces the
  prior set on every run.

### 3. TODO removed

The `// TODO: wire up setModelMarkers ...` comment from v0.2 is gone.

### 4. Manual smoke

- Type a syntactically invalid YAML (e.g. unbalanced bracket); a red
  squiggle appears under the offending token within ~200 ms.
- Fix the YAML; the marker clears.
- The Validate button continues to behave exactly as in v0.2 —
  semantic errors still come from the backend round-trip.

## Out of scope

Anything from `proposal.md` "Non-goals".
