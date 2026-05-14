# Architecture

DinoPanel is a monorepo with three packages:

```
apps/web      — React 19 + Vite 6 + TypeScript SPA
apps/server   — NestJS 11 + Fastify + TypeScript backend
packages/shared — Zod schemas, WebSocket message types, error codes
```

## Runtime topology

Single Node process. Same port serves three protocols:

```
                                 ┌─ /        → static SPA assets
   browser ──── HTTP(S) ────▶───┤─ /api/*   → REST controllers
                                 └─ /ws/*    → raw WebSocket gateways
```

Vite dev server (5173) proxies `/api` and `/ws` to the Node server (9999) during development. In production the Node server serves everything from `apps/web/dist` directly.

## Backend layout

```
apps/server/src/
├── main.ts                  # bootstrap (Fastify adapter, static serve, WS attach)
├── app.module.ts            # global guards (Throttler), module wiring
├── config/                  # Zod-validated env, derived AppConfig
├── database/                # Drizzle schema, db.module, migrations runner
├── common/
│   ├── decorators/          # @Public, @CurrentUser
│   ├── guards/              # JwtAuthGuard, authenticateWs helper
│   └── pipes/               # ZodValidationPipe
├── modules/
│   ├── health/              # liveness probe (public)
│   ├── users/               # bcrypt-backed user CRUD
│   ├── auth/                # JWT access+refresh, login/refresh/me/logout
│   ├── system/              # systeminformation poller + REST + WS gateway
│   ├── terminal/            # node-pty WebSocket gateway
│   └── files/               # filesystem REST endpoints
└── seed/initial-admin.ts    # idempotent admin user seeding
```

### Auth flow

1. POST `/api/auth/login` → bcrypt verify → issue access (15m) + refresh (7d) tokens
2. Refresh tokens carry a JTI tracked in the `sessions` table
3. `POST /api/auth/refresh` rotates: delete old jti, issue new pair
4. Global `JwtAuthGuard` (APP_GUARD) protects every endpoint except `@Public()`
5. WebSocket connections pass the access token via `?token=…` query string

### Realtime metrics

`SystemService` runs one `setInterval(1000)` and pushes snapshots to an RxJS `Subject`. `MetricsGateway` subscribes once and broadcasts to all connected clients — N clients ≠ N polls.

### Terminal

`TerminalGateway` spawns `bash -l` per WebSocket connection via `node-pty`. Stdin from the browser passes through directly; control frames (resize, heartbeat) come in as JSON.

Heartbeat watchdog kicks in at 90 s of silence — the gateway closes the socket, kills the pty.

### Files

`FilesService.resolvePath()` is the security choke point: rejects relative paths, null bytes, and explicit `..` segments. All write ops also refuse a hardcoded blacklist (`/`, `/etc`, `/usr`, `/var`, `/root`).

Uploads stream straight to disk via `pipeline()`; the gateway never buffers the full file.

## Frontend layout

```
apps/web/src/
├── main.tsx, App.tsx         # entry + router
├── routes/                   # one component per page
│   ├── login.tsx
│   ├── dashboard.tsx
│   ├── terminal.tsx
│   ├── files.tsx
│   ├── settings.tsx
│   └── auth-guard.tsx
├── components/
│   ├── ui/                   # shadcn primitives (manually maintained)
│   ├── layout/               # AppShell, Sidebar, UserMenu
│   ├── charts/               # Recharts wrappers
│   ├── terminal/             # xterm.js mount
│   ├── files/                # browser, breadcrumb, Monaco editor
│   └── theme-provider.tsx
├── hooks/                    # use-system, use-files (TanStack Query)
├── lib/                      # api (axios), ws helper, utils
├── stores/auth.ts            # Zustand persisted store
└── i18n/                     # i18next + zh-TW.json + en.json
```

### State

- **Server state**: TanStack Query — declarative caching, background refetch.
- **Auth state**: Zustand with `persist` middleware (only `user` is persisted; tokens are in their own localStorage entry).
- **Theme**: a custom provider that listens to `prefers-color-scheme` when `theme=system`.
- **i18n**: detected from `localStorage` → falls back to navigator → falls back to `zh-TW`.

### WebSocket

`createWsClient(opts)` wraps reconnect / heartbeat / token-on-query. Terminal uses raw `WebSocket` directly because it needs binary frames and tight per-tab lifecycle.

## Shared package

Pure ESM, compiled to `dist/`. Server's CommonJS output uses Node 22.12+'s `require(esm)` to import it. Types are surfaced via package `exports` (`@dinopanel/shared`, `@dinopanel/shared/schemas`, `@dinopanel/shared/ws-protocol`, `@dinopanel/shared/errors`).

## Security model

DinoPanel runs **as root**. There is no chroot, no per-user permission model — the panel administrator controls the whole machine. The auth boundary is at the network edge.

Mitigations layered in:

- bcrypt cost 12 password hashing
- Refresh token rotation; revoked jti rejected at refresh time
- Throttler: 5 logins/min on `/api/auth/login`
- Strict path validation; refuse traversal/null/relative; blacklist critical paths for delete
- 5 MB read limit, 100 MB upload limit; binary-detection refuses text-read on opaque files
- CORS off by default (same-origin only)
- Pino redaction strips auth headers and password fields from logs
- Sensitive env (`JWT_SECRET`, `.env`) is mode 600

Future hardening (v0.2+): MFA / TOTP, Passkey, IP allowlist, fail2ban-style lockout, signed cookies for refresh.
