# Deployment

DinoPanel is a single-binary-style deployment: one Node process serves the API, WebSockets, and the React SPA on the same port.

## Requirements

- Linux (x86_64 or aarch64)
- Node.js **22.12 LTS or later** (uses `require(esm)` stable feature)
- Run as root (the panel manages the whole machine: files, services, containers, …)

## Quick install

```sh
# 1. download a release tarball (built by scripts/build-release.sh)
curl -fsSL https://your-host/dinopanel-0.1.0.tar.gz | tar -xz
cd dinopanel-0.1.0

# 2. interactive install
sudo bash install.sh
```

The installer:

- Validates Node version
- Prompts for admin username, password, port (default 9999), bind address (default `127.0.0.1`)
- Generates a 96-character JWT secret with `openssl rand`
- Copies files to `/usr/local/dinopanel/`
- Stores SQLite + WAL in `/var/lib/dinopanel/`
- Writes logs to `/var/log/dinopanel/`
- Installs and starts a systemd unit `dinopanel.service`

## Non-interactive install

```sh
sudo ADMIN_USERNAME=admin ADMIN_PASSWORD='Tr0ub4dor!42' PORT=9999 HOST=0.0.0.0 \
  bash install.sh
```

## Exposing to the network

By default, DinoPanel binds to `127.0.0.1` only. To expose it:

1. **Re-run with `HOST=0.0.0.0`** (the panel listens on all interfaces directly), **or**
2. **Use nginx as a TLS-terminating reverse proxy** — see `deploy/nginx/dinopanel.conf.example`.

The nginx route is recommended in production because it gives you HTTPS via Let's Encrypt and an extra layer of access control.

## Operations

| Action | Command |
|---|---|
| Tail logs | `journalctl -u dinopanel -f` |
| Restart | `sudo systemctl restart dinopanel` |
| Stop | `sudo systemctl stop dinopanel` |
| Status | `sudo systemctl status dinopanel` |
| Uninstall | `sudo bash uninstall.sh` |

## File layout after install

```
/usr/local/dinopanel/        # binaries, web bundle, runtime deps
├── .env                     # generated config (chmod 600)
├── server/dist/             # NestJS compiled output
├── server/node_modules/     # runtime deps installed via npm
├── server/drizzle/          # SQL migrations
├── web/                     # built React SPA
├── shared/dist/             # shared schemas (ESM)
└── deploy/                  # systemd unit + nginx example

/var/lib/dinopanel/          # persistent data
└── dinopanel.db             # SQLite (users, sessions, settings)

/var/log/dinopanel/          # appended logs
└── server.log
```

## Upgrading

1. Stop the service: `sudo systemctl stop dinopanel`
2. Extract the new tarball over the install dir (preserves `.env` if you skip `.env`)
3. Run migrations from the new release: `cd /usr/local/dinopanel/server && pnpm db:migrate`
4. Restart: `sudo systemctl start dinopanel`

## Building a release locally

```sh
pnpm install
pnpm build
bash scripts/build-release.sh
# → release/dinopanel-0.1.0.tar.gz
```

The tarball is self-contained (web + server + migrations + install script).

## Security checklist before going live

- [ ] Use a strong admin password (≥10 chars, mixed)
- [ ] Bind to `127.0.0.1` and front with nginx + TLS for public access
- [ ] Configure `CORS_ORIGINS` in `.env` if exposing the API to external origins
- [ ] Place behind a firewall (`ufw`, `firewalld`) — only expose 443
- [ ] Schedule regular SQLite backups (`/var/lib/dinopanel/dinopanel.db`)
- [ ] Subscribe to security advisories for upstream deps (NestJS, fastify, node-pty)
- [ ] Run `node --version` periodically; bump to latest LTS

## Troubleshooting

**Service fails to start with `EADDRINUSE`** — another process is using port 9999.
Find it: `sudo ss -tlnp | grep 9999`.

**`node-pty` fails to load** — the prebuild was incompatible with your Node version.
Rebuild: `cd /usr/local/dinopanel/server && npm rebuild node-pty`.

**Web SPA shows 404 on refresh** — make sure your reverse proxy forwards all paths to upstream, not just `/api`.

**WebSocket disconnects under nginx** — nginx default `proxy_read_timeout` of 60s closes idle WS. Set `proxy_read_timeout 86400s;` and ensure `proxy_set_header Upgrade $http_upgrade;`.
