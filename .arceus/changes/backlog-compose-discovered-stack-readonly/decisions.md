# Decisions — backlog-compose-discovered-stack-readonly

## 1. Detection strategy: use a backend-issued error code, not just frontend heuristics

**Decision:** The frontend treats *any* stack as read-only when either
(a) we already know `source === 'discovered' && path === ''`, or
(b) the file-load endpoint returns the error code
`COMPOSE_FILE_UNAVAILABLE`.

**Why:** A purely frontend rule (`source === 'discovered'`) would miss
the legitimate case of a registered stack whose `compose.yml` was
deleted out-of-band — that should also be read-only rather than 500.
Centralising the "is there a file?" answer on the backend keeps the
frontend honest with one rule and one error code.

**Trade-off:** One extra round-trip on the discovered path (we still
issue the GET and let it 409), in exchange for not having two
divergent code paths. Acceptable for a low-frequency view.

## 2. Single error code `COMPOSE_FILE_UNAVAILABLE` (409), not two

**Decision:** Collapse the previous `COMPOSE_FILE_NOT_FOUND` (404) and
the new empty-path case into one `COMPOSE_FILE_UNAVAILABLE` (409).

**Why:** From the consumer's perspective, both states mean "the
backend has no file to act on" and require the same UI response.
Separate codes would force the frontend to handle two equivalent
branches.

**Trade-off:** Slight loss of diagnostic fidelity in API logs — but
the human `message` field still carries the distinction (`stack has
no recorded path` vs `no compose file found in <path>`).

## 3. Status code 409 Conflict, not 404 or 400

**Decision:** Use 409 Conflict.

**Why:** The resource (the stack) exists, the request method (GET
file) is valid; what conflicts is the stack's state — no file is
associated with it. 404 would suggest the stack itself is missing,
which is the *next* layer of error and is already covered by
`COMPOSE_NOT_FOUND`. 400 would suggest a malformed request, which
isn't the case.

## 4. Action endpoints stay enabled

**Decision:** `up` / `down` / `restart` / `pull` remain reachable for
discovered-only stacks.

**Why:** They go through the docker engine / `docker compose -p
<name>` and do not require a file on disk. Removing them would be a
regression — users currently rely on being able to restart a
discovered stack from the detail page.

**Trade-off:** A user might expect "Up" on a discovered stack to
*re-create* the stack from a compose file, but with no file there is
nothing to (re)create from. `docker compose -p <name> up` against an
existing project still works the way Docker handles it (essentially
no-op when everything is running). We accept that asymmetry; the
banner makes the "you can't edit, but engine actions work" contract
visible.

## 5. No automated e2e for this change

**Decision:** Skip writing a Playwright test; cover via backend unit
tests + manual smoke on the existing discovered stack `plane-app`.

**Why:** The UI surface is two boolean toggles (`readOnly`, banner
visibility, two buttons hidden). The Playwright suite already
exercises the Compose detail page on registered stacks; adding a
discovered-stack fixture would mean either a real container running
in CI (heavy) or a docker mock (brittle). Cost-benefit doesn't pay
off for this scope.
