# v0.2.1 — Compose Editor: JS-side YAML Lint

**Status:** active
**Date:** 2026-05-15
**Depends on:** v0.2-docker-containers (completed)

## Context

v0.2 shipped the Compose editor with Monaco's built-in YAML syntax
highlighting and a "Validate" button that calls
`POST /api/compose/:key/validate` to spawn `docker compose config` for
semantic validation. That covers the heavy case but leaves a gap:

- **No instant feedback for syntax errors.** The decisions log for v0.2
  called for live JS-side YAML parsing so Monaco would red-squiggle
  invalid YAML as the user types, without waiting for the Validate
  button (which spawns a process and round-trips through the backend).
- **The placeholder is already in place.** `compose-detail.tsx`
  `handleEditorMount` carries a TODO marker for exactly this hook-in.

The reason it didn't land in v0.2 is that the `yaml` package was not
yet a project dependency and the Phase 4 task constrained the agent
from adding deps unilaterally. v0.2.1 closes that gap.

## Goals

1. Add `yaml` (eemeli/yaml) as an `apps/web` runtime dep.
2. Run `parseDocument` against the Monaco buffer on debounced change
   (≈ 200 ms).
3. Translate the parser's `errors` and `warnings` arrays into Monaco
   markers via `setModelMarkers(model, 'yaml', markers[])`.
4. Reuse the same Validate button for semantic checks — JS-side lint
   only handles syntax (the cheap, fast layer).

## Non-goals

- No JSON Schema validation against Compose spec.
- No Compose-specific lint rules (e.g. "service has no image").
- No auto-fix actions; markers are diagnostic only.
- No change to the Validate button behaviour.

## Scope

One frontend dep added, ~30–50 lines of Monaco wiring inside
`compose-detail.tsx`. No backend changes.
