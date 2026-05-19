# v0.1 MVP — Acceptance spec (reconstructed)

> Historical reconstruction. Original spec is the implementation plan
> at `/home/mike/.claude/plans/whimsical-scribbling-sloth.md`.

## Done means

All seven phases below pass a manual smoke from a fresh checkout on a
clean Linux host, with the panel reachable at `http://<host>:9999`.

| Phase | Acceptance signal |
| ---   | --- |
| 0 — Monorepo | `pnpm install && pnpm -r build` succeeds end-to-end; `@dinopanel/shared` consumed by both server + web with no dual-package hazard. |
| 1a — Server core | `pnpm --filter @dinopanel/server start` boots NestJS on Fastify, Drizzle migrations apply against `apps/server/data/dinopanel.db`, pino logs structured JSON. |
| 1b — Auth | `POST /api/auth/login` with seeded `admin / DinoTest1234` returns JWT + refresh; refresh rotates; 6th login attempt inside a minute returns 429. |
| 2a — Web shell | `pnpm --filter @dinopanel/web dev` serves Vite on 5173, proxies to 9999; theme toggle + language toggle persist via localStorage. |
| 2b — Auth UI | Login screen renders, succeeds against backend, redirects to AppShell with Sidebar + UserMenu populated. |
| 3 — Dashboard | Logged-in user sees CPU / mem / disk / net updating at 1 Hz over WS; multiple tabs share one upstream poll (singleton broadcaster). |
| 4 — Terminal | `/terminal` opens xterm.js tab, types `echo hi` and gets `hi` back; new-tab + resize + 30 s heartbeat all work. |
| 5 — Files | `/files` lists `$HOME` by default, can mkdir / rename / copy / delete / upload / download / edit-in-Monaco; `../` traversal returns 400. |
| 6 — Settings | Change password requires old password, takes effect on next login; theme + language settings round-trip. |
| 7 — Packaging | `bash scripts/build-release.sh` produces a tarball; `bash install.sh` on a clean VM installs systemd unit `dinopanel.service`, which starts and survives reboot. |

## Out of scope (deferred)

- Automated test suite — v0.1.1.
- Bundle gzip ≤ 100 kB — v0.1.1.
- Run as non-root in production / refuse to start as non-root in prod
  with dev fallback — v0.1.2.
- `fs` errno mapping to HTTP status — v0.1.2.
- Files compress / extract UI — backlog (shipped in
  `backlog-files-compress-extract-ui` on 2026-05-17).
