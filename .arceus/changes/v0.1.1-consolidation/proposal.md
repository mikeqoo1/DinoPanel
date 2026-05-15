# v0.1.1 — Consolidation Phase

**Status:** completed
**Date:** 2026-05-14
**Commits:** `075929b` (security), `30d1018` (feat/infra)

## Context

DinoPanel MVP v0.1 shipped on 2026-05-14 with all 7 phases verified end-to-end
(auth, dashboard, terminal, files, settings, packaging). Before starting v0.2
(Docker container management) we identified five documented pieces of
technical debt and one structural risk:

1. **Web bundle weight** — single-chunk 1.37 MB raw / 400 kB gzipped; everything
   eagerly imported including Monaco, xterm, recharts.
2. **No automated tests** — vitest installed but zero specs; no e2e harness.
3. **node-pty deployment fragility** — native build requires
   build-essential / python3 on the target machine; install.sh does not detect.
4. **Coarse error parsing** — `extractErrorMessage` does not handle nested
   API errors, Zod details, or class-validator message arrays.
5. **Files UI gaps** — backend supports copy / chmod / chown but the React
   UI doesn't expose them.

The structural risk is that v0.2 will introduce a second WebSocket stream
(container exec) and a substantially heavier frontend (Compose editor). Adding
that on top of zero test coverage and an oversized bundle is asking for
regressions.

## Goals

Land all five pieces of tech debt **and** add the missing safety nets
(typecheck/lint/test/build CI plumbing + e2e smoke) before any v0.2 work
begins. The output of this phase is a foundation that v0.2 can build on
without fear.

## Non-goals

- No new product features for end users (no Docker, no website management).
- No UI redesign or theme refinement.
- No new locales beyond the existing en + zh-TW.
- No App Store / template mechanism (permanently removed from roadmap).

## Outcome

All eight planned tasks plus one mid-flight security fix (path traversal in
`FilesService.resolvePath()`, discovered while writing task #7's unit tests)
landed in two commits. 47 unit tests + 5 e2e tests passing.

Main bundle gzip: **400.59 kB → 98.45 kB** (-75%).

See `tasks.md` for the per-task checklist and `decisions.md` for the
trade-offs worth keeping in mind.
