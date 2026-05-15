# v0.2 — Docker Container Management

**Status:** draft
**Target:** v0.2 (≈ 2.5–3 weeks)
**Depends on:** v0.1.2 completed (consolidation foundation in place)

## Context

With v0.1.1 + v0.1.2 the foundation is solid: 55 unit tests + 5 e2e
covering the existing surface, bundle under 100 kB gzip, canonical error
contract, hardened path resolution, root posture explicit.

v0.2 introduces container management — the first product-level feature
since MVP. It is the single largest module in the roadmap and unlocks
v0.3 (websites typically deployed as containers) and v0.4 (databases
often containerised too).

## Scope

Pure container management — no App Store, no Compose templates, no
one-click installers. App Store was permanently removed from the
roadmap on 2026-05-14: the upstream model (data.yml schemas, PANEL_*
env injection, curated template repo) is too much surface area for
the team size, and the security model of one-click installers is hard
to get right.

What's in:

1. **Container CRUD**
   - List containers (running + stopped, with status, ports, image)
   - Start / stop / restart / pause / unpause / kill
   - Remove (with `--force` confirmation)
   - Logs view (tail + follow, via WebSocket stream)
   - Exec into container (xterm + WebSocket, reusing the terminal stack)
   - Inspect (JSON viewer)
   - Stats stream (CPU / mem / net / disk per container, WebSocket)

2. **Image CRUD**
   - List images (with size, tags, created)
   - Pull from registry (with progress stream)
   - Remove (with dangling-image cleanup helper)
   - Tag / retag

3. **Network CRUD**
   - List networks (with driver, scope, attached containers)
   - Create / remove user networks
   - Inherit / preserve the `dinopanel-network` bridge convention

4. **Volume CRUD**
   - List volumes (with driver, mountpoint, used-by)
   - Create / remove
   - Show contents via Files module (mountpoint navigation)

5. **Docker Compose**
   - Detect Compose-defined stacks via container labels
   - Edit `docker-compose.yml` in Monaco
   - `up` / `down` / `restart` / `pull` against a stack
   - Stream logs at the stack level (aggregated)

What's out:

- App Store templates (permanently removed)
- Docker Swarm / Kubernetes (single-host only)
- Registry management UI (login is fine via Docker config; UI deferred)
- BuildKit / image build from Dockerfile (deferred)
- Container resource limits editor (deferred to v0.2.1 if asked)

## Rationale

- **dockerode is the right SDK.** Pure JS, no Go bindings, actively
  maintained, used by all major Node-based container tools.
- **Compose without App Store is still valuable.** Users have existing
  Compose files they want to manage; that doesn't require a curated
  catalogue.
- **WebSocket reuse.** The terminal stack (xterm + custom WS framing
  + JWT auth on connect) is exactly what's needed for `docker exec`
  and for log/stats streams. Building on it is cheaper than introducing
  a new WS layer.
