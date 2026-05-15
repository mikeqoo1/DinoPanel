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

## Phase 2 — Containers (REST + WS)

- [ ] `ContainersService` + `ContainersController`: list / inspect /
  start / stop / restart / pause / unpause / kill / remove
- [ ] WS gateways: logs stream, stats stream, exec stream
- [ ] Frontend list page with status badges, ports, image
- [ ] Frontend detail page with logs tail, stats sparkline, exec drawer
- [ ] Unit tests: 8 cases covering happy path + 404 / 409

## Phase 3 — Images / Networks / Volumes

- [ ] `ImagesService` + controller: list / pull (progress WS) / remove /
  tag
- [ ] `NetworksService` + controller: list / create / remove / connect /
  disconnect
- [ ] `VolumesService` + controller: list / create / remove
- [ ] Frontend pages for each
- [ ] Unit tests: 4 cases per service

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
