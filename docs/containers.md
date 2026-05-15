# Container Management

## Overview

The containers module (v0.2) adds Docker management to DinoPanel. It covers five sub-areas:

| Area | Feature |
|---|---|
| Containers | List, inspect, start, stop, restart, pause, unpause, kill, remove; live logs, CPU/memory stats, interactive exec |
| Images | List, pull (with per-layer progress), remove, tag |
| Networks | List, inspect, create, remove, connect/disconnect containers |
| Volumes | List, inspect, create, remove, prune |
| Compose | Stack discovery, file CRUD, validate, up/down/restart/pull via Docker Compose v2 |

### Design decisions

**Root-only in production.** DinoPanel must run as root to read `/var/run/docker.sock` (or the user must be in the `docker` group). See `docs/deployment.md` for details. In non-root dev mode the server starts but prints a warning; container features that require socket access will fail with `DOCKER_UNREACHABLE`.

**In-place compose files.** Compose stacks keep their `docker-compose.yml` / `compose.yaml` files at their original paths (no centralized storage). Stack discovery reads the `com.docker.compose.project` and `com.docker.compose.working_dir` container labels at runtime, then merges with rows in the `compose_stacks` SQLite table (registered stacks).

**Docker Compose v2 only.** The module calls `docker compose` (space, not hyphen — the v2 plugin). If the plugin is absent the `ComposeService` marks itself unavailable and all compose endpoints return `503 COMPOSE_UNAVAILABLE`.

**Socket path.** Configurable via `DOCKER_SOCKET_PATH` env var; defaults to `/var/run/docker.sock`.

---

## REST API

All endpoints are under `/api` and require a valid JWT (`Authorization: Bearer <token>`).

### Containers

#### `GET /api/containers`

List all containers (running + stopped).

Query params: none (currently returns all containers).

Response: `Container[]`

```json
[
  {
    "id": "3af04a75...",
    "name": "my-app",
    "image": "nginx:latest",
    "imageId": "sha256:...",
    "state": "running",
    "status": "Up 2 hours",
    "ports": [{ "ip": "0.0.0.0", "privatePort": 80, "publicPort": 8080, "type": "tcp" }],
    "labels": { "com.docker.compose.project": "mystack" },
    "createdAt": 1700000000
  }
]
```

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:9999/api/containers
```

#### `GET /api/containers/:id`

Inspect a single container. Returns the same `Container` shape as the list endpoint (normalized, not raw Docker inspect).

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:9999/api/containers/3af04a75
```

#### `POST /api/containers/:id/start` → 204

#### `POST /api/containers/:id/stop` → 204

#### `POST /api/containers/:id/restart` → 204

#### `POST /api/containers/:id/pause` → 204

#### `POST /api/containers/:id/unpause` → 204

#### `POST /api/containers/:id/kill` → 204

#### `DELETE /api/containers/:id` → 204

Query params: `force=1` (remove running container), `v=1` (remove anonymous volumes).

```bash
curl -X DELETE -H "Authorization: Bearer $TOKEN" "http://localhost:9999/api/containers/3af04a75?force=1"
```

All action endpoints return 304 from Docker (container already in target state) silently as a no-op 204.

---

### Images

#### `GET /api/images`

List local images. Response: `Image[]`

```json
[
  {
    "id": "sha256:aaa...",
    "tags": ["nginx:latest"],
    "size": 142000000,
    "created": 1700000000
  }
]
```

#### `GET /api/images/:id`

Inspect a single image.

#### `DELETE /api/images/:id` → 204

Query: `force=1`, `noprune=1`.

#### `POST /api/images/:id/tag` → 204

Body: `{ "repo": "my-registry/nginx", "tag": "v1.0" }`

Pull is done via WebSocket — see §WebSocket Streams.

---

### Networks

#### `GET /api/networks`

List networks. Response: `Network[]`

#### `GET /api/networks/:id`

Inspect a network.

#### `POST /api/networks` → 201

Body: `{ "name": "mynet", "driver": "bridge", "internal": false }`

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"mynet"}' http://localhost:9999/api/networks
```

#### `DELETE /api/networks/:id` → 204

#### `POST /api/networks/:id/connect` → 204

Body: `{ "containerId": "3af04a75..." }`

#### `POST /api/networks/:id/disconnect` → 204

Body: `{ "containerId": "3af04a75...", "force": false }`

---

### Volumes

#### `GET /api/volumes`

List volumes. Response: `Volume[]`

#### `GET /api/volumes/:name`

Inspect a volume.

#### `POST /api/volumes` → 201

Body: `{ "name": "mydata", "driver": "local", "labels": {} }`

#### `DELETE /api/volumes/:name` → 204

Query: `force=1`.

#### `POST /api/volumes/prune` → 200

Remove all unused volumes. Response: `{ "volumesDeleted": ["mydata"], "spaceReclaimed": 1024000 }`

---

### Compose

#### `GET /api/compose`

List all stacks (merged: discovered via labels + registered in SQLite).

Response: `ComposeStack[]`

```json
[
  {
    "id": 1,
    "name": "myapp",
    "path": "/home/user/myapp",
    "source": "registered",
    "services": ["web", "db"],
    "containerCount": 2,
    "runningCount": 2
  }
]
```

#### `GET /api/compose/:key`

Get a single stack by numeric id or name string.

#### `POST /api/compose`

Register a new stack.

Body: `{ "name": "myapp", "path": "/home/user/myapp", "content": "version: '3'..." }`

`path` defaults to `~/dinopanel/stacks/<name>/compose.yaml` if omitted. `content` is written to the file at `path` if provided.

#### `DELETE /api/compose/:id` → 204

Unregister a stack from SQLite (does not delete the compose file). `id` must be the numeric SQLite row id.

#### `GET /api/compose/:key/file`

Read the compose file content. Response: `{ "content": "version: '3'..." }`

#### `PUT /api/compose/:key/file` → 204

Write compose file. Body: `{ "content": "version: '3'..." }`

#### `POST /api/compose/:key/validate`

Validate via `docker compose -f <file> config`. Response:

```json
{
  "valid": true,
  "errors": []
}
```

On failure: `{ "valid": false, "errors": [{ "line": 5, "message": "invalid key" }] }`

Actions (up/down/restart/pull) are done via WebSocket — see §WebSocket Streams.

---

## WebSocket Streams

All WebSocket endpoints require authentication via `?token=<jwt>` query parameter (same JWT as REST).

Base URL: `ws://host:port`

### `/ws/containers/:id/logs`

Stream container log output.

Query params:
- `token` — JWT (required)
- `tail` — number of lines to tail on connect (default: 200, max: 10000)
- `follow` — ignored; always follows

**Frames (server → client):**
- Binary frames — raw multiplexed Docker log bytes. Passed directly to `xterm.write()`.
- Text frame `{ "type": "end" }` — container stopped, no more logs.
- Text frame `{ "type": "error", "code": "DOCKER_UNREACHABLE" | "DOCKER_NOT_FOUND" }` — error, connection closes.

**Close codes:**
- 1000 — normal end
- 1001 — server shutdown
- 1011 — stream error

```js
const ws = new WebSocket(`ws://localhost:9999/ws/containers/${id}/logs?token=${jwt}&tail=200`);
ws.binaryType = 'arraybuffer';
ws.onmessage = (e) => {
  if (e.data instanceof ArrayBuffer) {
    term.write(new Uint8Array(e.data));
  }
};
```

### `/ws/containers/:id/stats`

Stream container CPU/memory/network stats at ~1 s intervals.

Query params: `token` (required).

**Frames (server → client):**
- Text frames — raw Docker stats JSON (large object from Docker Engine API). The client parses this and computes `cpuPct`, `memPct`, etc.

The `stats.gateway.ts` forwards the raw JSON directly; the `use-containers.ts` hook (`useContainerStatsWs`) handles the parsing and normalization into `ContainerStats`.

### `/ws/containers/:id/exec`

Bidirectional exec shell.

Query params:
- `token` (required)
- `cmd` — command to execute (default: `/bin/sh`)
- `cols`, `rows` — initial terminal size (defaults: 80x24)

**Frames (client → server):**
- Binary frames — raw stdin bytes to the shell.
- Text frame `{ "type": "resize", "cols": N, "rows": N }` — resize the PTY.
- Text frame `{ "type": "heartbeat" }` — keep-alive; server responds with `{ "type": "pong" }`.

**Frames (server → client):**
- Binary frames — stdout/stderr bytes from the shell.
- Text frame `{ "type": "end" }` — process exited normally.
- Text frame `{ "type": "error", "code": "DOCKER_UNREACHABLE" | "DOCKER_NOT_FOUND" }` — docker error.

**Close codes:** 1000 (normal), 1001 (server shutdown), 1011 (error).

### `/ws/images/pull`

Stream image pull progress (per-layer download events).

Query params: `token` (required), `ref` — image reference e.g. `nginx%3Alatest` (URL-encoded).

**Frames (server → client):**
- Text frames — Docker pull progress JSON: `{ "status": "Pulling from ...", "id": "layer-id", "progressDetail": {...} }`
- Text frame `{ "type": "end" }` — pull complete.
- Text frame `{ "type": "error", "code": "..." }` — pull failed.

### `/ws/compose/:key/action`

Stream compose action output (up / down / restart / pull).

Query params: `token` (required), `type` — one of `up | down | restart | pull`.

**Frames (server → client):**
- Binary frames — stdout/stderr bytes from `docker compose`. Rendered in xterm.
- Text frame `{ "type": "exit", "code": N }` — action completed with exit code N.
- Text frame `{ "type": "error", "code": "SPAWN_FAILED" | "NOT_FOUND" }` — spawn or lookup error.

When the client closes the connection, the server sends SIGTERM to the child process, then SIGKILL after 10 s.

---

## Frontend Pages

| Route | Component | Key interactions |
|---|---|---|
| `/containers` | `ContainersPage` | Table with state badges; per-row actions (start/stop/pause/restart/remove); auto-refresh toggle (10 s) |
| `/containers/:id` | `ContainerDetailPage` | 4-tab detail: Logs (xterm), Stats (recharts sparklines), Inspect (Monaco read-only JSON), Exec (shell Dialog) |
| `/images` | `ImagesPage` | List with pull dialog (per-layer progress bar), tag, remove |
| `/networks` | `NetworksPage` | List; create dialog (name + driver + internal flag); remove; built-in networks show remove disabled |
| `/volumes` | `VolumesPage` | List; create dialog; prune button with confirmation; remove |
| `/compose` | `ComposePage` | Stack list showing service count + running count; create dialog; link to detail |
| `/compose/:key` | `ComposeDetailPage` | Monaco YAML editor; validate button; action buttons (up/down/restart/pull) that open a terminal drawer |

All container routes are lazy-loaded as separate chunks via `React.lazy`. The main bundle is not affected.

---

## Configuration

| Env var | Default | Description |
|---|---|---|
| `DOCKER_SOCKET_PATH` | `/var/run/docker.sock` | Path to the Docker daemon Unix socket |

The socket path is injected as a NestJS provider token `DOCKER` (defined in `docker.token.ts`) so it can be replaced in tests.

**Docker Compose v2 detection.** On `ContainersModule` init, the server runs `docker compose version` with a 3 s timeout. If it exits 0, compose features are enabled. If not, all compose endpoints return `503 COMPOSE_UNAVAILABLE`.

---

## Permissions

DinoPanel must be able to read/write the Docker socket. Two approaches:

1. **Run as root** (recommended for production) — root always has access to `/var/run/docker.sock`.
2. **docker group** — add the DinoPanel user to the `docker` group: `usermod -aG docker dinopanel`. This grants equivalent socket access without full root, but DinoPanel still needs root for file management, systemd, and firewall features.

**Dev mode (non-root).** The server starts and prints a warning. REST endpoints that proxy Docker will return `503 DOCKER_UNREACHABLE` if the current user cannot reach the socket.

---

## Troubleshooting

### `DOCKER_UNREACHABLE` — cannot connect to Docker daemon

Symptoms: All container/image/network/volume endpoints return 503.

Checks:
1. Is Docker running? `systemctl status docker`
2. Does the DinoPanel process have socket access? `ls -la /var/run/docker.sock` → should be accessible by root or `docker` group.
3. Is the socket path correct? Check `DOCKER_SOCKET_PATH` env var; default is `/var/run/docker.sock`.

Fix:
```bash
systemctl start docker
# or add user to docker group
usermod -aG docker <user> && newgrp docker
```

### `COMPOSE_UNAVAILABLE` — docker compose v2 not found

Symptoms: All `/api/compose` endpoints return 503.

Fix (Ubuntu/Debian):
```bash
apt-get install docker-compose-plugin
```

Fix (manual):
```bash
docker compose version   # must succeed
```

### `DOCKER_CONFLICT` — container already exists or port in use

Common causes:
- Trying to create a network/volume with a name that already exists.
- Trying to remove a running container without `?force=1`.
- Port binding conflict when starting a container.

The HTTP status is 409. The response body contains the Docker error message which usually names the conflicting resource.

---

## Bundle Impact (v0.2 vs v0.1.1 baseline)

Build output from `pnpm --filter @dinopanel/web build`:

| Chunk | Raw | gzip |
|---|---|---|
| `index-CR-d1qwx.js` (main bundle) | 325.0 kB | **104.4 kB** |
| `metric-chart-*.js` (recharts) | 386.3 kB | 106.9 kB |
| `xterm-*.js` (xterm.js) | 290.6 kB | 72.3 kB |
| `vendor-react-*.js` | 194.4 kB | 60.8 kB |
| `vendor-i18n-*.js` | 55.1 kB | 17.1 kB |
| `vendor-router-*.js` | 37.9 kB | 13.7 kB |
| `vendor-query-*.js` | 35.7 kB | 10.6 kB |
| `container-detail-*.js` | 15.6 kB | 4.7 kB |
| `files-*.js` | 21.7 kB | 6.0 kB |
| `images-*.js` | 12.2 kB | 4.0 kB |
| `compose-detail-*.js` | 10.6 kB | 3.6 kB |
| `containers-*.js` | 7.0 kB | 2.3 kB |
| `networks-*.js` | 7.1 kB | 2.4 kB |
| `volumes-*.js` | 7.7 kB | 2.6 kB |
| `compose-*.js` | 7.9 kB | 2.3 kB |

**Main bundle comparison:**
- v0.1.1 baseline: 98.45 kB gzip
- v0.2 (after Phase 5): **104.4 kB gzip** (+5.95 kB / +6%)

The increase is from the new sidebar nav items and i18n keys for the containers module. All new route components are lazy-loaded and do not contribute to the main bundle. The spec limit was 130 kB gzip; v0.2 is well within budget.

**Large vendor chunks note:**
- `metric-chart` (recharts, 106.9 kB gzip) and `xterm` (72.3 kB gzip) are lazy-loaded with the route chunks that use them and do not appear until the user navigates to a containers page.
- `index-CR-d1qwx.js` contains Monaco editor worker + runtime; it is split out by Vite as a separate chunk from the container-detail page.
