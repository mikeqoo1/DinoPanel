# v0.2 — Technical Decisions (draft)

## Decided

- **dockerode over docker-modem / direct HTTP.** Mature, typed, supports
  streams natively, hides the engine API version mess.
- **No App Store.** Removed permanently from the roadmap on 2026-05-14.
  Users can write their own Compose files.
- **Single host only.** No Swarm, no Kubernetes adapter. DinoPanel
  manages one machine.
- **WebSocket reuse.** Exec, logs, stats, and image-pull progress all
  reuse the terminal module's WS framing (JWT-on-connect, binary
  frames, heartbeat) where possible.

## To decide before implementation

- **dockerode socket path is root-only by default.** If we want to
  permit the panel running as a `docker`-group member instead of root,
  we need to relax the v0.1.2 startup-warning logic. Lean: keep root-
  only for v0.2; revisit if a credible non-root use case appears.
- **Compose file location.** Two options:
  1. Wherever the user already has them (browse via Files module, edit
     in place).
  2. A managed directory (`/var/lib/dinopanel/stacks/`) with import.
  
  Lean: option 1, with a "register this directory as a stack" action.
  Option 2 creates a parallel concept that doesn't add value.
- **`docker compose` v1 vs v2.** v1 is binary `docker-compose`; v2 is
  subcommand `docker compose`. Lean: detect at startup and pick the
  available one; fail with a clear error if neither is present.
- **Compose file validation.** Run `docker compose config` against the
  edited file before writing? Could be slow on large stacks; could
  short-circuit obvious YAML errors via JS-side parsing. Lean: JS-side
  parse + lint, plus optional "validate via docker" button.
- **Image-pull progress.** dockerode emits JSON progress events; the
  question is whether to forward raw events to the client or aggregate
  into a percentage. Lean: raw events, let the client render — same
  pattern as `docker pull` CLI.

## Things explicitly not in scope

- BuildKit / Dockerfile build UI (separate change, v0.2.1 candidate).
- Container resource limits editor (memory/CPU caps; deferred).
- Image vulnerability scanning.
- Registry management UI (Docker config file is fine).
- Multi-host federation.

## Tied to broader DinoPanel decisions

- Frontend stays React + Vite + shadcn — no new framework for containers.
- Backend stays NestJS + Fastify on port 9999 — no new ports.
- SQLite remains the metadata store; container state is sourced from
  the docker engine, not duplicated.
