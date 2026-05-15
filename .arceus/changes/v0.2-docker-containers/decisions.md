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

## Decided 2026-05-15 — open questions resolved

The five open questions captured below were resolved in a per-item
discussion with the user before activation. Summary of the accepted
answers:

1. **dockerode socket: root-only.** Production runs as root and reads
   `/var/run/docker.sock` directly. Dev (non-root) is **not blocked** —
   if the user is in the `docker` group, dockerode connects naturally;
   no special-case code, no relaxation of the v0.1.2 non-root warning
   semantics. Rationale: docker-group membership is effectively root
   (`docker run -v /:/host` gives a chroot), so adding a separate
   "non-root but container-capable" mode would just be theatre.

2. **Compose file location: in-place.** Existing stacks are discovered
   via the `com.docker.compose.project` container label. Any directory
   can be registered as a stack (small SQLite table
   `compose_stacks(id, path, name, created_at)` for manual registrations).
   New-stack UI defaults the path to `~/dinopanel-stacks/<name>/` for
   users without a preference, but the field is editable. No managed
   directory, no copy-on-import, no parallel concept.

3. **`docker compose` v1 vs v2: v2-only.** v1 (`docker-compose`) reached
   EOL in June 2023 — no new releases, no security fixes. Detect at
   startup via `docker compose version`; absence yields a clear error
   pointing the user at `apt install docker-compose-plugin` or the
   distro equivalent. Single code path, no dispatch wrapper, no double
   testing matrix. v1 users are expected to upgrade — the migration is
   one apt-get away.

4. **Compose validation: two layers.** Live YAML parsing via the `yaml`
   package gives Monaco its red squiggles for syntax errors; this is
   instant and non-blocking on save. A separate "Validate" button
   spawns `docker compose -f <file> config` for deep semantic
   validation (variable expansion, cross-reference checks). Saves are
   never blocked beyond YAML-parse-ability so users can persist WIP.

5. **Image pull progress: raw events.** dockerode's JSON progress events
   are forwarded over the WS untouched. The frontend renders per-layer
   progress bars in `docker pull`-CLI style, computing per-layer percent
   from `progressDetail.current / progressDetail.total`. No backend
   aggregation — server-computed overall percent jumps backwards when
   cached layers skip events, which looks like a bug to users.

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
