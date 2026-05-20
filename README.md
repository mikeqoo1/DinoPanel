# DinoPanel

[繁體中文](./README_zh-TW.md)

> Modern Linux server management panel. Built with TypeScript + React + NestJS.

DinoPanel is a self-hosted control panel for managing a single Linux
server: files, terminal, containers, websites with auto-issued SSL,
firewall, scheduled tasks, log centre, and more — all through a clean
web UI. Designed as an independent clean-room reimplementation
inspired by best-in-class panels, deliberately trimmed to what one
maintainer can actually own.

> **Status:** Pre-1.0, actively developed. Through v0.4 the panel
> handles containers, websites + ACME SSL, **databases (MySQL /
> MariaDB / PostgreSQL / Redis / MongoDB) with PMM PromQL summary
> cards**, firewall, scheduler, and log centre. Validated end-to-end
> on Rocky Linux 9.4 production-class hardware (Xeon Gold 5218,
> 600+ days uptime). Next milestone is v0.6 (toolbox).

## Features

### Core (v0.1)

- **Dashboard** — Real-time CPU / memory / disk / network metrics (1 Hz)
- **Web SSH terminal** — Multi-tab, fully-featured xterm.js shell with
  WebSocket transport
- **File manager** — Browse, edit (Monaco), upload, download,
  compress, permissions
- **Auth** — JWT with refresh token rotation, bcrypt password hashing
- **Settings** — Language (zh-TW / en), theme (light / dark / system),
  account management

### Containers (v0.2)

- Docker container CRUD (start / stop / restart / remove / inspect)
- Image management (pull, tag, prune)
- Network + volume management
- Docker Compose stack editor with Monaco YAML highlighting
- PMM integration (link card to existing Percona Monitoring)

### Websites + ACME (v0.3, extended in v0.4)

- Static / reverse-proxy / PHP-FPM site types
- Host-side nginx integration (atomic conf write + rollback on
  `nginx -t` failure)
- Reconcile / orphan detection — files on disk win on conflict
- **v0.4 — external-conf import**: reconcile also walks
  `/etc/nginx/conf.d/*.conf` and surfaces operator-managed confs as
  read-only rows with an `External` badge
- **v0.4 — PHP-FPM auto-provision**: empty `PHP_FPM_SOCKET_PATH`
  flips to managed mode; DinoPanel runs `php:8.3-fpm` itself, idle
  stops after the last PHP site is removed
- Let's Encrypt cert issuance: HTTP-01 + Cloudflare DNS-01
- **v0.4 — `ACME_EMAIL` settings UI** (env-first, settings fallback)
- Auto-renewal every 12 h via the v0.5 scheduler (renews at ≤ 30 d
  expiry)
- `/opt/dinopanel/` namespace keeps everything DinoPanel-managed under
  one tree (backup-friendly, uninstall-friendly)

### Databases (v0.4)

- Five engines, all-container: MySQL 8 / MariaDB 11 / PostgreSQL 16 /
  Redis 7 / MongoDB 7
- Bind-mount data dirs under `/opt/dinopanel/databases/<engine>/<instance>/`
  — `ls`/`tar`/`du` directly, no named-volume ceremony
- Plaintext credentials in the connection card with Copy + Rotate
  (decisions.md Q3: don't run DinoPanel on hosts that expose the
  data dir)
- 6-step atomic create with rollback (validate → mkdir → SELinux
  relabel → dockerode create → start → DB insert)
- PMM PromQL summary cards inline in the drawer — QPS / connections /
  uptime / replication lag, fan-out cached 30 s server-side; falls
  back to the v0.2.1 "Open in PMM" link card when not configured
- `Sheet` drawer primitive (also retrofitted to `/websites`)

### Operations (v0.5)

- **Firewall** — ufw + firewalld driver detection, with a 30-second
  rollback safeguard on every rule change (auto-revert if not
  confirmed)
- **Scheduled tasks** — cron-driven runner for shell, file backup,
  log cleanup, service restart, HTTP request, plus a built-in audit
  log purge
- **Log centre** — system / SSH / operation / login / task / website
  log views with cursor pagination and WebSocket live tail
- **Audit interceptor** — every mutating API call writes an
  `operation_log` row with redacted body and rotating retention

## Roadmap

| Version | Scope | Status |
| ------- | ----- | ------ |
| v0.1    | MVP — dashboard / terminal / files / auth | ✅ shipped |
| v0.2    | Containers (Docker + Compose) | ✅ shipped |
| v0.5    | Firewall + scheduler + log centre | ✅ shipped |
| v0.3    | Websites + ACME SSL | ✅ shipped (smoke S1/S2/S3/S7 on Rocky 9.4) |
| v0.4    | Databases (5 engines, all-container) + PMM summary cards + v0.3 carry-over (Sheet drawer, auto-provision PHP-FPM, ACME_EMAIL UI, external-conf reconcile) | ✅ shipped |
| v0.4.1  | Smoke patches — install.sh upgrade-mode (×2), PostgreSQL 18 PGDATA layout, dockerode `ensureImage`, clipboard fallback for non-HTTPS contexts | ✅ shipped |
| v0.4.2  | Drawer PMM cards conditional render — distinguish "not registered" from "exporter unhealthy" via existing `pmmRegistered` flag (no PMM Management API client added) | ✅ shipped |
| v0.6    | Toolbox (Fail2Ban / Supervisor / Swap / NTP) + MFA + Passkey | planned |
| v1.0    | Stable release with full i18n | planned |

App Store / template-based one-click installs were dropped permanently
in v0.2 — each module owns its own install path instead.

## Tech Stack

| Layer    | Choice                                          |
| -------- | ----------------------------------------------- |
| Frontend | React 19 + Vite 6 + TypeScript 5                |
| UI       | Tailwind CSS 4 + shadcn/ui + Radix              |
| Backend  | NestJS 11 + Fastify 5 + TypeScript 5            |
| Database | SQLite (better-sqlite3) + Drizzle ORM 0.36      |
| Realtime | Native WebSocket (no Socket.IO)                 |
| Terminal | @xterm/xterm + node-pty                         |
| Editor   | Monaco Editor                                   |
| Scheduler| node-cron + cron-parser                         |
| ACME     | acme-client (pure Node, no Python/Go deps)      |

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

# Run unit tests (currently 169 passing)
pnpm test

# Build production bundle
pnpm build
```

## Deployment

```sh
# Build a release tarball (prebuilt x64 binaries for node-pty included
# — target machine doesn't need build-essential / python3)
bash scripts/build-release.sh --prebuild=x64

# Copy the tarball to the target host, then on the target:
tar -xzf dinopanel-0.4.2-prebuild-x64.tar.gz
cd dinopanel-0.4.2-prebuild-x64
sudo bash install.sh
```

`install.sh` is upgrade-safe (since `70a8d48`):

- Re-running on an existing install preserves `.env` (no JWT_SECRET
  rotation, no operator-tuned env vars wiped)
- Skips admin credential prompts when upgrading
- Stops the systemd service before swapping code and atomically
  cleans the target dirs to avoid `cp -r` nesting

For the websites module specifically, the target host needs nginx
installed under systemd and ports 80 / 443 free. See
[`docs/websites.md`](./docs/websites.md) for the SELinux / AppArmor
relabel snippets and the optional sudoers contract.

## Repository Layout

```
apps/
  web/                # React + Vite frontend (SPA)
  server/             # NestJS backend (REST + WebSocket)
packages/
  shared/             # Shared Zod schemas, WS protocol types, error codes
scripts/              # install.sh (upgrade-safe), build-release.sh
deploy/               # systemd unit, nginx examples
docs/                 # Architecture, websites, ACME, firewall, scheduler, logs
.arceus/changes/      # Change-management proposals + decisions + tasks per version
release/              # Built tarballs (gitignored content)
```

## Documentation

- [Architecture](./docs/architecture.md) — module boundaries, request lifecycle
- [Websites](./docs/websites.md) — site CRUD, nginx integration, sudoers, SELinux
- [ACME](./docs/acme.md) — issuance flows, Cloudflare DNS-01 setup, renewal
- [Firewall](./docs/firewall.md) — ufw / firewalld drivers, rollback safeguard
- [Scheduler](./docs/scheduler.md) — cron jobs, runners, dogfooded purge
- [Logs](./docs/logs.md) — five log sources, retention, audit interceptor
- [Deployment](./docs/deployment.md) — production install + upgrade flow

## License

[Apache License 2.0](./LICENSE)
