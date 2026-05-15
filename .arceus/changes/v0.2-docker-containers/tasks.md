# v0.2 — Task Checklist (draft)

Phases match the v0.1.1 working pattern: foundation → parallel feature
slices → end-to-end → tests in each phase, not bolted on at the end.

## Phase 1 — Foundation ✅ (2026-05-15)

- [x] Add `dockerode` + `@types/dockerode` to `apps/server`
  *(dockerode 5.0.0, @types/dockerode 4.0.1)*
- [x] `ContainersModule` skeleton with dockerode provider, env-driven
  socket path *(DOCKER token = `Symbol('DOCKER')`,
  env `DOCKER_SOCKET_PATH` default `/var/run/docker.sock`)*
- [x] `mapDockerError(err, op)` helper analogous to `mapFsError`
  *(`apps/server/src/modules/containers/docker-error.ts`,
  7 statusCode branches + transport-error branch)*
- [x] Shared schemas: Container, Image, Network, Volume, ComposeStack
  *(`packages/shared/src/schemas/containers.ts`,
  re-exported from index)*
- [x] Route group skeleton + lazy loading in `apps/web/src/App.tsx`
  *(5 lazy routes + sidebar items + i18n; main bundle +1.2 kB gzip
  → 100.14 kB total)*

## Phase 2 — Containers (REST + WS) ✅ (2026-05-15)

- [x] `ContainersService` + `ContainersController`: list / inspect /
  start / stop / restart / pause / unpause / kill / remove
  *(idempotent 304 handling for start/stop/etc; `mapDockerError` on
  the failure path; DOCKER token moved to `docker.token.ts` to break
  a service→module→service circular import)*
- [x] WS gateways: logs stream, stats stream, exec stream
  *(`logs.gateway.ts`, `stats.gateway.ts`, `exec.gateway.ts`; JWT via
  `?token=` query, attached in main.ts via the existing
  Fastify upgrade hook; binary frames for logs/exec, JSON frames for
  stats and control messages)*
- [x] Frontend list page with status badges, ports, image
  *(shadcn `<Table>`, auto-refresh toggle, per-row action icons
  start/stop/pause/unpause/restart/remove)*
- [x] Frontend detail page with logs tail, stats sparkline, exec drawer
  *(4 tabs — Logs/Stats/Inspect/Exec — using xterm + recharts +
  Monaco-read-only respectively)*
- [x] Unit tests: 8 cases covering happy path + 404 / 409
  *(list/inspect happy, start-idempotent-304, start-404, stop-304,
  remove-409, remove-force-ok, transport-ENOENT-503)*

## Phase 3 — Images / Networks / Volumes ✅ (2026-05-15)

- [x] `ImagesService` + controller: list / pull (progress WS) / remove /
  tag *(pull streams dockerode JSON events raw through
  `pull.gateway.ts` at `/ws/images/pull?ref=<encoded>&token=<jwt>`)*
- [x] `NetworksService` + controller: list / create / remove / connect /
  disconnect *(create accepts `{name, driver, internal}`, default
  driver bridge)*
- [x] `VolumesService` + controller: list / create / remove
  *(plus `prune` returning `{volumesDeleted, spaceReclaimed}`; create
  inspects post-create to populate full Volume shape — dockerode v5's
  `createVolume()` returns a wrapper, not raw JSON)*
- [x] Frontend pages for each *(Images: pull dialog with per-layer
  progress + tag + remove; Networks: create with driver select,
  built-in network remove disabled; Volumes: create + prune + remove)*
- [x] Unit tests: 4 cases per service *(12 total, all green; suite now
  75 tests across 10 files)*

## Phase 4 — Compose

- [ ] `ComposeService` detecting stacks via container labels
  (`com.docker.compose.project`)
- [ ] CRUD on stack-level compose files (read / write / validate)
- [ ] `up` / `down` / `restart` / `pull` actions (shelling out to
  `docker compose`, captured into the same WS framing as logs)
- [ ] Monaco editor with YAML mode
- [ ] Unit tests: 5 cases

## Phase 5 — E2E + polish

- [ ] e2e/containers-list.spec.ts
- [ ] e2e/containers-start-stop.spec.ts
- [ ] e2e/containers-exec.spec.ts (gated on `DINOPANEL_E2E_DOCKER=1`)
- [ ] Bundle size check (main + per-route chunks)
- [ ] Docs: `docs/containers.md` covering the new module

## Open questions (resolve before implementation)

- [ ] dockerode socket access: do we require the panel user be in the
  `docker` group, or do we rely on root only?
- [ ] Compose file storage: project root vs. `~/dinopanel/stacks/`?
- [ ] Image pull progress framing: reuse log WS format or new one?
- [ ] How to handle `docker compose` v1 vs v2 (CLI differs)?
