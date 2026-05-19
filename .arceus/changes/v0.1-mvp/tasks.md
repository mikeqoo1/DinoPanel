# v0.1 MVP — Task checklist (reconstructed, all complete)

> The real working checklist lived in the implementation plan at
> `/home/mike/.claude/plans/whimsical-scribbling-sloth.md` and was
> tracked task-by-task during the 12-day build. This is a compact
> retrospective so the `.arceus/changes/` index has a complete
> checklist on file.

## Phase 0 — Monorepo bootstrap
- [x] pnpm + Turbo workspaces (`apps/server`, `apps/web`, `packages/shared`)
- [x] TypeScript strict everywhere; shared `tsconfig.base.json`
- [x] ESLint flat config; `pnpm lint` exit-0 baseline
- [x] `@dinopanel/shared` pure ESM (Zod schemas + WS protocol types)

## Phase 1a — Server core
- [x] NestJS 11 + Fastify adapter
- [x] Drizzle ORM + better-sqlite3 (WAL); migrations under `apps/server/drizzle/`
- [x] pino logger with structured request logs

## Phase 1b — Auth
- [x] JWT access + refresh, rotation on `/auth/refresh`
- [x] bcrypt password hashing; seed `admin / DinoTest1234`
- [x] `@nestjs/throttler` 5/min on `/auth/login`

## Phase 2a — Web shell
- [x] Vite 6 + React 19 + Tailwind 4 + shadcn/ui
- [x] i18n (zh-TW + en) with localStorage persistence
- [x] Theme toggle (dark / light) with localStorage persistence

## Phase 2b — Auth UI
- [x] Login screen + form validation
- [x] AppShell + Sidebar + UserMenu
- [x] Axios interceptor for 401 → refresh → retry

## Phase 3 — Dashboard
- [x] `systeminformation` 1 Hz singleton broadcaster
- [x] WS `/ws/metrics` fan-out
- [x] Recharts cards: CPU / Mem / Disk / Net

## Phase 4 — Web SSH
- [x] node-pty backend with multi-tab
- [x] xterm.js frontend with FitAddon + 30 s heartbeat
- [x] Resize handshake (cols / rows over WS)

## Phase 5 — Files
- [x] REST: list / stat / read / write / mkdir / rename / copy / delete
- [x] Upload (multipart) + download (stream)
- [x] Monaco editor for in-browser edits
- [x] `FilesService.resolvePath()` rejects `..` / null byte / dangerous deletes

## Phase 6 — Settings
- [x] Change password (requires current)
- [x] Theme + language settings
- [x] About page

## Phase 7 — Packaging
- [x] `dinopanel.service` systemd unit
- [x] `install.sh` (Debian/Ubuntu/Rocky pre-flight)
- [x] `build-release.sh` (tarball + sha256)
- [x] Docs: README + INSTALL

## Verification (manual, 2026-05-14)
- [x] Login → refresh → rate-limit
- [x] Dashboard 1 Hz updates across tabs
- [x] Terminal echo + resize + multi-tab
- [x] Full Files CRUD + upload/download + Monaco round-trip
- [x] systemd unit starts on boot
