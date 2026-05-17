# backlog-compose-discovered-stack-readonly

## Problem

Stacks the backend lists as `source: "discovered"` (reverse-engineered
from running container labels rather than from a managed compose
project directory) come back from `GET /api/compose` with `path: ""`.
When the user clicks one of those stacks from the Compose list, the
frontend navigates to `/compose/:key` and the detail page issues
`GET /api/compose/:key/file`, which in `compose.service.ts` builds the
file path via `join(stack.path, 'compose.yml')`. With `stack.path === ""`,
that resolves to `compose.yml` relative to the server process's cwd,
e.g. `/Projects/DinoPanel/apps/server/compose.yml`, and the read fails
with `ENOENT` / "no such file or directory".

Reproduced 2026-05-17 against the dev environment with the
`plane-app` discovered stack: detail page opened, editor was blank,
clicking 驗證 returned
`open /Projects/DinoPanel/apps/server/compose.yml: no such file or
directory`.

## Why it matters

- Confusing UX: error message exposes a server-internal path.
- The Save / 驗證 buttons look enabled but cannot actually do anything
  for a discovered stack — there is no file to save to.
- Up / Down / Restart / Pull still work against discovered stacks (they
  go through the docker engine, not the file), so the detail page is
  *partially* useful, which makes the failure mode worse, not better.

## Options for fix

1. **Mark detail page read-only for discovered stacks.** Hide / disable
   the editor + Save + 驗證 buttons; keep Up/Down/Restart/Pull. Cheapest;
   honest about what we can do.
2. **Reconstruct a compose.yml from `docker inspect`.** Synthesise a
   read-only YAML from the running container labels + config. Closer to
   1Panel's behaviour but adds non-trivial code (label parser, env / port
   / volume reconstruction, no round-trip guarantee).
3. **Hide discovered stacks from the Compose list entirely**, surface
   them only under Containers. Cleanest separation but loses the
   "I want to see what's running grouped by stack" affordance.

Recommend (1) as the v0.3-era patch unless someone asks for (2).

## Out of scope

- Compose schema validation (separate v0.3+ item).
- Auto-importing a discovered stack into a managed compose directory.

## Status

Draft — small, no urgency, good as a warm-up patch alongside another
small change.
