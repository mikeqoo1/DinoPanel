# v0.3.1 — Smoke pass + release-pipeline fix

**Status:** completed (2026-05-19)
**Target:** v0.3.1
**Depends on:** v0.3-websites-acme (all five phases shipped)

## Context

v0.3 shipped five phases of websites + ACME functionality (commits
`1b2dd7b` … `833edca`) on 2026-05-19. Code-side verification gates
all passed (169/169 tests, lint clean, build clean) but the spec
explicitly defers the operator-side smoke pass to a real Rocky 9.4
host — same pattern v0.5.1 used.

This change records the deploy + the first smoke validation against
`192.168.199.234` (Rocky 9.4, 600 days uptime, Intel Xeon Gold 5218,
Active production-style host that already runs PMM + apitable + a
bunch of other services).

## What was validated (S1)

**S1: Static site happy path** ✓

End-to-end on the Rocky box:
1. Created site `test1` via UI (`/websites` route).
   - Type: 靜態網站 (static)
   - Primary domain: `test1.local`
   - Index files: `index.html index.htm`
2. Backend pipeline observed:
   - `POST /api/websites` accepted (201).
   - `/opt/dinopanel/sites/test1/public/` auto-created.
   - `/opt/dinopanel/nginx/conf.d/test1.conf` written via atomic
     temp+rename.
   - `sudo nginx -t` passed (exit 0).
   - `sudo systemctl reload nginx` passed.
   - `sites` row inserted with `managed_by_dinopanel: true`,
     `orphaned: false`.
3. Manually wrote `<h1>Hello from DinoPanel v0.3</h1>` to
   `/opt/dinopanel/sites/test1/public/index.html`.
4. `curl -sH "Host: test1.local" http://192.168.199.234/` returned
   the served HTML.

The full chain — UI → API → ConfRenderer → atomic conf write →
nginx -t → reload → sites row → nginx serves on `Host:` match —
works end-to-end on the production-class host.

## What surfaced during deploy (now fixed in 70a8d48)

Two `install.sh` bugs blocked the first upgrade attempt:

1. **`cp -r SRC DEST` nested rather than overwrote when `DEST`
   already existed.** A re-install left the old code at
   `/usr/local/dinopanel/server/dist/` and nested the new code at
   `/usr/local/dinopanel/server/server/dist/`. systemd kept serving
   the old build, so the new `/websites` route looked "missing"
   even though the tarball was correct.
   - Fix: `rm -rf $DEST` before each `cp -r` so cp creates the
     destination anew.

2. **`.env` got rewritten on every install** (regenerating
   `JWT_SECRET`, prompting interactively for port/host, wiping
   any operator-tuned env vars like `ACME_*` / `WEBSITES_*`).
   - Fix: upgrade-vs-fresh detection via `INSTALL_DIR/.env`
     presence. Upgrade mode preserves the file, skips prompts,
     and stops the systemd service before swapping code.

Both fixes are in commit `70a8d48` (`fix(release): install.sh
upgrade-safe`). DB migrations + admin seed were already idempotent;
no changes needed there.

## Host prerequisites the smoke established

Operator steps the first install on a new box needs (now folded
into `docs/websites.md`):

- `sudo dnf install -y nginx` — Rocky's official repo
- `sudo systemctl enable --now nginx` — port 80 must be free
  (apitable stack on this box was holding 80, stopped via
  `docker stop apitable-*` + `docker update --restart=no` for
  persistence)
- `sudo dnf install -y policycoreutils-python-utils` for `semanage`
- SELinux relabel `/opt/dinopanel/sites/` as
  `httpd_sys_content_t`
- `firewall-cmd --permanent --add-service=http` if firewalld is
  enforcing
- `sudo systemctl restart dinopanel` once nginx is up — re-runs
  the bootstrap probe and flips `sudoProbeOk` to true (informational
  only; create-site flow re-spawns sudo on every call so it
  worked even without the restart)

DinoPanel runs as `root` per `dinopanel.service`, so the documented
sudoers contract was not exercised in this smoke — `sudo -n` as
root is a no-op. The sudoers entries become relevant when the
service is hardened to a non-root user (a v0.4+ task).

## What's deferred (S2–S7)

| ID | Scenario | Blocker |
| --- | --- | --- |
| S2 | Reverse proxy round-trip | Need an in-host upstream container with a known response |
| S3 | Reconcile orphan detection | Just needs a 30-second exercise — operator todo |
| S4 | ACME HTTP-01 against LE **staging** | Need a public domain pointing at the Rocky box (no public IP yet) |
| S5 | ACME DNS-01 via Cloudflare | Need a domain on Cloudflare + API token; same blocker as S4 |
| S6 | PHP-FPM site | Need the operator-provisioned `php:8.3-fpm` container per docs/websites.md |
| S7 | Delete + nginx reload round-trip | Same trivial follow-up as S3 |

S2 + S3 + S7 are quick wins for the next smoke session. S4–S6 wait
on real-world prerequisites and don't block declaring v0.3 done.

## Version bump

Phase 1–5 shipped with `package.json` still on `0.2.1` because the
v0.3 work was scoped per-phase and not formal-release-tagged. This
consolidation change bumps:

- `package.json` (root) → `0.3.0`
- `apps/server/package.json` → `0.3.0`
- `apps/web/package.json` → `0.3.0`
- `packages/shared/package.json` → `0.3.0`
- Sidebar label string → `v0.3.0`

## What v0.3 is, what v0.3 isn't

**Is:** static + reverse-proxy + PHP-FPM site CRUD; conf renderer
with ACME location block; atomic write + rollback on `nginx -t`
failure; reconcile (orphan detection only); HTTP-01 + Cloudflare
DNS-01 issuance; auto-renew via v0.5 scheduler; `/websites` UI;
SSL providers settings card; release pipeline upgrade-safe.

**Isn't:** SAN / multi-domain / wildcard certs; DNS providers
beyond Cloudflare; auto-provisioned PHP-FPM container; UI for
`ACME_EMAIL`; encrypted-at-rest secret storage (account key + CF
token in plain SQLite); Drawer-style detail panel; multi-PHP-version
support. All deferred to v0.4+ — see the v0.3 tasks.md deviation
log and `.arceus/changes/v0.4-databases/` (planning).
