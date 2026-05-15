# DinoPanel

[繁體中文](./README_zh-TW.md)

> Modern Linux server management panel. Built with TypeScript + React + NestJS.

DinoPanel is a self-hosted control panel for managing a single Linux server:
files, terminal, containers, websites, databases, monitoring, and more — all
through a clean web UI. Designed as an independent clean-room reimplementation
inspired by best-in-class panels.

> **Status:** Pre-alpha. MVP under active development.

## Features (MVP)

- **Dashboard** — Real-time CPU / memory / disk / network metrics (1Hz)
- **Web SSH terminal** — Multi-tab, fully featured xterm.js shell
- **File manager** — Browse, edit (Monaco), upload, download, compress, permissions
- **Settings** — Language, theme, account management
- **Auth** — JWT-based with refresh token rotation, bcrypt password hashing

## Roadmap

- v0.2 — Docker container management + lightweight App Store
- v0.3 — Website management (nginx reverse proxy + ACME SSL)
- v0.4 — Database management (MySQL / PostgreSQL / Redis)
- v0.5 — Firewall, cron jobs, log center
- v0.6 — Toolbox (Fail2Ban, Supervisor, etc.), MFA, Passkey
- v1.0 — Stable release

## Tech Stack

| Layer    | Choice                                          |
| -------- | ----------------------------------------------- |
| Frontend | React 19 + Vite 6 + TypeScript                  |
| UI       | Tailwind CSS 4 + shadcn/ui + Radix              |
| Backend  | NestJS 11 + Fastify + TypeScript                |
| Database | SQLite (better-sqlite3) + Drizzle ORM           |
| Realtime | Native WebSocket (no Socket.IO)                 |
| Terminal | @xterm/xterm + node-pty                         |
| Editor   | Monaco Editor                                   |

## Development

```sh
# Requirements: Node 22 LTS, pnpm 9
corepack enable

# Install dependencies
pnpm install

# Run dev (server + web together)
pnpm dev

# Typecheck & lint
pnpm typecheck
pnpm lint

# Build production bundle
pnpm build
```

## Repository Layout

```
apps/
  web/        # React + Vite frontend (SPA)
  server/     # NestJS backend (REST + WebSocket)
packages/
  shared/     # Shared Zod schemas, WS protocol types, error codes
scripts/      # install.sh, build-release.sh
deploy/       # systemd unit, nginx examples
docs/         # Architecture, API reference, deployment guide
```

## License

[Apache License 2.0](./LICENSE)
