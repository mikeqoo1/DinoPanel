# v0.4.1 — Smoke patches

**Status:** completed (2026-05-20)
**Target:** v0.4.1
**Depends on:** v0.4-databases (all six phases shipped)

## Context

v0.4 shipped six phases of databases + PMM + v0.3 carry-over work
on 2026-05-20 (commits `b421711` … `033db4c`). All code-side
verification gates passed (build / lint / test) but the operator
smoke pass against `192.168.199.234` (Rocky 9.4 production-class
host) surfaced five distinct issues that were fixed on main in the
hours after the v0.4.0 cut.

Each fix was a single-commit follow-up, independently reviewable,
and individually verified during the smoke session. This patch
release bundles them under a single version bump so operators
upgrading from v0.4.0 receive all five corrections in one tarball
rather than tracking individual commits.

The smoke session itself is documented in
`.arceus/changes/v0.4-databases/smoke-pass.md` (S1 create + cli ✓ ·
S2 rotate password ✓ · S3 lifecycle ✓ · S4–S6 deferred · S7 PMM
permanently deferred — Rocky 234 has no PMM endpoint).

## The five fixes

### 1. `install.sh` upgrade mode — admin seed (`a8b4fa9`)

The admin-seed step at the top of the script runs under
`set -u`. On upgrade installs `ADMIN_USERNAME` is not exported
(the operator already has an account) — the unbound reference
crashed the script.

Fix: wrap the seed branch in `if [[ $UPGRADE -eq 0 ]]; then …
fi`. Upgrades skip admin provisioning entirely.

### 2. PostgreSQL 18 default + cross-version PGDATA (`89eacd5`)

The PostgreSQL official image changed its `VOLUME` from
`/var/lib/postgresql/data` to `/var/lib/postgresql` starting at
the 18.0 release, and now expects `PGDATA` to be a subdirectory
of the volume. Pre-18 drivers mounted the data dir directly,
which works for 16/17 but produces an empty cluster on 18 (the
image refuses to initdb into a VOLUME that already exists at the
mount point).

Fix: rework `PostgresDriver` so all supported majors bind
`/var/lib/postgresql` and pass `PGDATA=/var/lib/postgresql/pgdata`
explicitly. The image VOLUME on 16/17 gets overridden by the
explicit bind, which is harmless. Default image bumped to
`postgres:18`.

### 3. `install.sh` tail message — `ADMIN_USERNAME` default (`bf49ef3`)

A separate `set -u` strike: the final summary `echo` referenced
`$ADMIN_USERNAME` even on upgrade installs, where it wasn't set
(see fix #1 — only the seed branch was guarded, not the tail
print).

Fix: `${ADMIN_USERNAME:-(preserved from prior install)}` in the
final summary. Upgrade installs now print a friendly note rather
than crashing on the last line.

### 4. dockerode `ensureImage` (`6a21d19`)

`docker run <image>` auto-pulls when the image isn't present
locally; dockerode's `container.create()` does **not**. On the
fresh Rocky 234 box without any postgres image cached, the v0.4.0
`DbInstancesService.create` failed with `(HTTP code 404) image not
found`.

Fix: add an `ensureImage()` helper that probes with
`docker.getImage(ref).inspect()` first, then runs `docker.pull` +
`modem.followProgress` to drain the pull stream before calling
`createContainer`. Applies to all five engine drivers via the
shared service.

### 5. Clipboard fallback for non-HTTPS contexts (`c4a29e2`)

`navigator.clipboard.writeText()` is gated by Chrome/Firefox to
**secure contexts only** — HTTPS, `localhost`, or `file:`. The
Rocky 234 deployment is a LAN-only HTTP install on
`192.168.199.234`, so any "copy connection string / password"
action in the database drawer threw `NotAllowedError` and silently
failed.

Fix: new `apps/web/src/lib/clipboard.ts` shared helper that
attempts `navigator.clipboard.writeText` first, falls back to a
hidden `<textarea>` + `document.execCommand('copy')` on failure.
All drawer copy actions route through the helper.

## What `v0.4.1` is, what `v0.4.1` isn't

**Is:** a meta-only patch release. Five bug fixes already on
main, bundled under a version bump (4 package.json files +
sidebar label + README tarball reference) so the next deploy
tarball ships them in a single drop.

**Isn't:** new features. The two follow-up themes that operator
surfaced post-smoke (drawer PMM cards conditional render +
multi-host PMM inventory) remain as drafts under
`.arceus/changes/v0.4.x-pmm-cards-conditional/` and
`.arceus/changes/v0.X-multihost-pmm-inventory/`. Neither is
included here — both await product-direction decisions before
activation.

## Version bump

- `package.json` (root) → `0.4.1`
- `apps/server/package.json` → `0.4.1`
- `apps/web/package.json` → `0.4.1`
- `packages/shared/package.json` → `0.4.1`
- `apps/web/src/components/layout/sidebar.tsx` label → `v0.4.1`
- `README.md` tarball reference → `dinopanel-0.4.1-prebuild-x64`

## Operator follow-ups (post-cut)

1. Rebuild tarball: `bash scripts/build-release.sh --prebuild=x64`
2. (Optional) redeploy to Rocky 234 to confirm the bundled fixes
   stick across a fresh upgrade install — exercises fixes #1, #3,
   and validates that the new install.sh path is upgrade-safe end
   to end.
