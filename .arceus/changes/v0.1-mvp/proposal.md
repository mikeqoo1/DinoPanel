# MVP v0.1 — TypeScript + React clean-room reimplementation of 1Panel core

> **Historical record.** This proposal is reconstructed from memory + git
> history. The MVP was implemented and shipped before the
> `.arceus/changes/` mechanism existed (which started with
> `v0.1.1-consolidation` on 2026-05-14). The authoritative implementation
> plan still lives at
> `/home/mike/.claude/plans/whimsical-scribbling-sloth.md`.

## Why

DinoPanel exists to distil 1Panel's most-used host-management surface
into a TypeScript + React stack that the user's team (Taiwan,
concords.com.tw) can own and audit. 1Panel itself is Go-based and
ships from a PRC vendor, which is a hard non-starter for the user's
deployment context. TS + React across the whole stack is a non-
negotiable preference — see [[user-profile]].

The v0.1 cut is the smallest shippable panel that gives an operator a
real reason to install it: log in, watch the box, get a terminal, move
files, change a setting, walk away. Anything beyond that — Docker,
websites, databases, firewall — is deliberately out of scope and
sequenced into later releases.

## What ships in v0.1

Seven phases, all green and verified by hand on 2026-05-14. The full
phase breakdown lives in `meta.json` under `scope.in`. Summary:

- **Backend** — NestJS 11 + Fastify, Drizzle + better-sqlite3 (WAL),
  JWT auth with refresh-token rotation, rate limiting, raw ws for
  metrics + terminal + file-upload.
- **Frontend** — React 19 + Vite 6, Tailwind 4 + shadcn/ui, i18n
  (zh-TW + en), dark/light theme, AppShell + Sidebar + UserMenu.
- **Modules** — Dashboard (1Hz metrics broadcaster + Recharts), Web
  SSH (node-pty + xterm.js, multi-tab + resize + heartbeat), Files
  (full CRUD + Monaco), Settings (password / theme / language).
- **Packaging** — systemd unit + install.sh + build-release.sh.
  Single port 9999 for API + WS + SPA in production.

## What is explicitly NOT in v0.1

- Automated tests (came in v0.1.1 — 47 unit + 5 e2e).
- Bundle-size reduction (came in v0.1.1 — 400 kB → 98 kB gzip).
- Production root posture + fs errno mapping (came in v0.1.2).
- Docker / websites / databases / firewall / cron / logs — all later
  releases, see `.arceus/changes/` index for current state.

## Why this folder exists

Because v0.1 is the foundation of every version that came after. The
`.arceus/changes/` index without a v0.1 entry made it look like the
MVP didn't happen, which buried the most important context behind a
process gap. This entry restores version-history continuity. The
contents are intentionally short — they point at the real artefacts
(the plan file, the scaffold commit, the memory snapshots) rather
than re-deriving them.
