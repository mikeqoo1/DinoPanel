# v0.1.1 — Technical Decisions

Decisions worth keeping around because they will be questioned again or
because they shape how future work should be done.

## Test framework

- **Vitest, not Jest.** Vitest works natively with the existing Vite +
  ESM toolchain (`@dinopanel/shared` is pure ESM); Jest would need ts-jest
  + esm flags + transformer juggling.
- **Playwright, not Cypress.** Single-binary install, native multi-browser,
  cleaner trace viewer, and the team already standardised on it elsewhere.
- **`globalSetup` over `webServer`.** Playwright's built-in `webServer`
  setting reuses an existing port-9999 process even if that process is the
  dev server serving Vite HMR instead of the prod SPA. We detect the
  `/assets/` fingerprint to decide whether to restart.
- **chromium-only.** Firefox / WebKit add CI time without exercising
  meaningfully different code paths for an admin panel.

## Bundle splitting

- **`React.lazy` first, `manualChunks` to taste.** `React.lazy` per route
  is enough for Monaco / xterm / recharts because they're each only used
  by one route. `manualChunks` is layered on for vendors (react, router,
  query, i18next) that are eagerly imported across the app shell.
- **Login stays eager.** Lazy-loading the first paint costs more than it
  saves.
- **Sourcemap off in prod.** Saves 5.6 MB of `.map` artifacts. If Sentry
  is added later, switch to `'hidden'`.

## Error contract

- **Semantic codes, not numeric.** `BAD_REQUEST` reads better than `400`
  in client-side discriminated unions and is stable across HTTP versions.
- **500 message is fixed.** Never echo `error.message` to the client on a
  500 — that's how stack contents leak. Log the full error on the server.
- **`details` is optional and unknown-typed.** Validation errors use
  `{ errors: [{ path, message }] }`; future error categories can add their
  own shapes without coupling.

## Path traversal fix

- **`path.resolve()`, not segment-scan blacklist.** The previous code did
  `normalize().split(sep).includes('..')`. `normalize()` folds `..` on
  absolute paths, so the segment scan only catches relative inputs — which
  are already rejected by the `isAbsolute()` check. The blacklist was dead
  code masquerading as defence.
- **Read wide, write narrow.** `resolvePath()` does input validation only;
  `assertWritable()` enforces deny-list on mutating ops. Reading
  `/etc/hosts` is a legitimate sysadmin task; modifying it from the panel
  is not.
- **No symlink realpath resolution (yet).** Symlinks are how admins make
  shortcuts to their working directories. Resolving them would break that
  workflow. If symlinks-into-deny-list becomes a problem, add a
  `realpath` check at write time, not read time.

## Files UI

- **Octal input for chmod, not RWX checkboxes (first pass).** Power
  users (the entire target audience) already think in 755. A checkbox
  matrix is a future refinement, not a v0.1.1 requirement.
- **Required uid + gid for chown.** Backend schema is strict; rather than
  carry "leave blank to keep existing" UX state, default the dialog to the
  current entry's uid/gid so the user only changes the field they care
  about.

## node-pty deployment

- **No `prebuildify` dependency.** Copy the pnpm-cached `build/Release/
  pty.node` into the tarball's `prebuilds/linux-<arch>/` path; node-pty's
  own `scripts/prebuild.js` will pick it up at install time on the target.
  Zero new dependencies.
- **CI matrix deferred.** install.sh / build-release.sh are ready for it;
  the `.github/workflows/` directory is intentionally still empty. Adding
  a release workflow is a separate change.

## Things explicitly not done

- No Sentry / OpenTelemetry wiring.
- No HTTPS / Let's Encrypt at the panel layer (run behind nginx).
- No multi-user RBAC.
- No bundle size CI gate (manual check for now).
- No Files compress/extract UI (backend ready, UI deferred to backlog).
