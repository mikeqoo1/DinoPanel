# v0.3 — Discussion State (paused 2026-05-18)

The five-question round was started but paused mid-stream when the
user asked to detour into PMM integration (see
`backlog-pmm-integration/`). When resuming, all my picks below are
**recommendations only** — none have been confirmed by the user.
Treat this file as a starting point for the discussion, not a
decision record. The real decisions still need to be written into
`decisions.md` (which does not exist yet) once the user signs off
per question.

## Recommendations (claude, 2026-05-18) — awaiting confirmation

| # | Question | My pick | Rationale (one line) |
|---|---|---|---|
| 1 | Where does nginx run? | **host systemd** | Port 80 is the linchpin for ACME HTTP-01; Docker-in-Docker port races are the exact pain 1Panel learned from. |
| 2 | Config storage | **Live conf files + small SQLite metadata table** | Avoids the dual-write sync problem. nginx tests files anyway; admins will hand-edit conf — the file must be the source of truth. SQLite only tracks `site_type`, `cert_paths`, `managed_by_dinopanel`. |
| 3 | ACME library | **`acme-client` (Node)** | Pure-Node, fits the stack, no Python or Go runtime needed. Cloudflare DNS-01 is just CF API calls in Node. If we later want broad DNS provider coverage, shell out to `lego` then. |
| 4 | Site directory layout | **`/opt/dinopanel/sites/<name>/` with per-site override** | Don't squat on 1Panel's `/www` (non-standard on most distros) or Debian's `/var/www` (collides with apt-installed nginx defaults). Namespace under `/opt/dinopanel/`. |
| 5 | TLS auto-renewal | **In-process scheduler (12h `setInterval` checking expiry)** | Ships with v0.3. Gets folded into the v0.5 cron module when that lands. Waiting for v0.5 would block v0.3 ACME. Throw-away code cost is small. |

## What was *not* yet discussed

- The user did not get to react to any of the above. Q1–Q4 were
  bundled into one `AskUserQuestion` call that they interrupted
  before answering. Q5 was never asked.
- No `decisions.md` exists; no `spec.md`; no `tasks.md`.
- `meta.json.status` remains `draft`.

## Resume protocol

When the user is ready to come back to v0.3:

1. Re-ask Q1 alone first, with the above recommendation framed
   explicitly so they can react.
2. Iterate per-question. Each confirmed answer gets written into a
   new `decisions.md` immediately (one section per question), so
   if the conversation gets interrupted again the state survives.
3. After all five are written, flip `meta.json.status` to `active`,
   then draft `spec.md` and `tasks.md` for Phase 1.

## Related state

- `backlog-pmm-integration/` was opened as the detour — three
  options (link card / iframe embed / API summary cards) with
  claude recommending the link card first and saving the API-cards
  option for v0.4 when the database module lands.
- v0.4 (databases) decisions may retroactively affect Q4 (where
  site files live) if database data dirs end up sharing the
  `/opt/dinopanel/` namespace. Worth re-checking at that point.
