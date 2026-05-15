# v0.2 — Spec (draft)

## Verification gates

- `pnpm typecheck` — 0 errors
- `pnpm lint` — 0 errors, 0 warnings
- `pnpm test` — ≥ 80 vitest cases (current 55 + ≈ 25 new for the
  ContainersService / ImagesService / NetworksService / VolumesService /
  ComposeService)
- `pnpm build` — main bundle gzip stays under 130 kB (10 kB headroom
  for the new module)
- `pnpm exec playwright test` — ≥ 8 e2e (current 5 + 3 new for
  containers list / start-stop / exec)

## Acceptance criteria

### Backend (`apps/server/src/modules/containers/`)

- New module with submodules: `containers`, `images`, `networks`,
  `volumes`, `compose`.
- dockerode injected as a NestJS provider (singleton, configurable
  socket path via env, defaulting to `/var/run/docker.sock`).
- All endpoints under `/api/containers/*`, JWT-protected.
- WebSocket endpoints:
  - `/ws/containers/:id/logs?follow=true` — stream container logs
  - `/ws/containers/:id/stats` — stream stats every 1 s
  - `/ws/containers/:id/exec` — bidirectional exec, reusing terminal
    framing
- Use the v0.1.1 `ApiExceptionFilter` + `ApiErrorResponse` contract for
  all REST responses.
- Map dockerode errors to typed exceptions (parallel to `mapFsError`):
  404 for "no such container/image/network/volume", 409 for "container
  already exists / port in use", etc.

### Frontend (`apps/web/src/routes/containers/`)

- New route group with sub-pages: Containers, Images, Networks, Volumes,
  Compose.
- React.lazy for the whole module (don't bloat the main bundle).
- shadcn/ui patterns consistent with the existing Files page.
- Real-time updates via the new WS streams; existing react-query for
  REST.
- Monaco for the Compose YAML editor (already a chunk in the bundle).

### Shared (`packages/shared/src/schemas/`)

- Zod schemas for Container, Image, Network, Volume, ComposeStack.
- Container exec request/response types (already partially modelled by
  the terminal module — extract shared bits).

### Tests

- Unit: each service has happy-path + dockerode-error-path coverage
  (mock dockerode).
- e2e: requires docker socket access on the test runner. Spec gates on
  `process.env.DINOPANEL_E2E_DOCKER === '1'` so non-Docker dev
  environments skip cleanly.
