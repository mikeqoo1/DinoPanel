# v0.1.2 — Technical Decisions

## Posture model

- **Production = root, dev = warn-not-block.** A panel that controls files,
  services, firewall, and containers genuinely needs root. Splitting the
  product into "root mode" and "user mode" doubles UI complexity for an
  audience (sysadmins running their own box) that already expects root.
  Dev users running on a workstation still need to be able to start the
  server without sudo — they get a warning, not an exit.

- **No `NODE_ENV` branch for the warning.** Logging "you're non-root" is
  useful in any environment, including production deploys gone wrong.

- **Endpoint name: `/process-info`, not `/info`.** There is an existing
  `/api/system/info` (or similar) for `systeminformation` metrics. Using
  `process-info` keeps the runtime-user vs hardware-metrics distinction
  obvious at the URL level.

## Errno mapping

- **Helper is module-level, not a service method.** It's a pure function:
  no `this`, no dependencies, easier to test in isolation.

- **`EACCES` and `EPERM` are merged.** Semantically very close on POSIX,
  and clients don't need to discriminate. Same goes for `EEXIST` and
  `EBUSY` both → 409.

- **`ENOSPC` is 413, not 507.** Nest doesn't have a `InsufficientStorage`
  helper. 413 (Payload Too Large) is the closest standard; clients can
  branch on the `FILE_NO_SPACE` code if they need exact semantics.

- **Unknown errnos rethrow, not "always 500-with-code".** A rethrow gives
  the global filter the chance to log the full stack server-side. If
  every errno became a typed exception, we'd lose visibility on the ones
  we hadn't anticipated.

- **No mapping at the controller / WS gateway layer.** Files-specific
  errno mapping belongs in the FilesService. WS gateways have different
  failure modes (connection lifecycle, backpressure) and need separate
  treatment if/when those surface.

## Frontend

- **`enabled` flag on `useFileList`, not a guard inside the route.**
  React Query's `enabled` is the idiomatic way to gate a query. Adding
  an `if (!currentPath) return null` early-return in the route would
  bypass the cache properly but lose the loading-state coordination.

- **`staleTime: Infinity` for process info.** uid / gid / home don't
  change while a node process is alive. The only "refetch" trigger is
  a server restart, which already invalidates the session anyway.

- **Empty-string initial path, not `null`.** Keeps the type as `string`
  instead of `string | null`; the gating `enabled` flag is what
  actually represents "not ready yet."

## Things explicitly not done

- No symlink realpath resolution.
- No errno mapping for stream errors in `createDownloadStream` — those
  fire asynchronously after the controller has already responded; needs
  pipeline-level handling, out of scope here.
- No retry-on-EBUSY anywhere; surfacing the 409 is enough for now.
- No bundle size gate in CI (still manual).
