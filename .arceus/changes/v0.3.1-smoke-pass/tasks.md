# v0.3.1 — Task Checklist

References `proposal.md` for context. This file tracks the discrete
verification items that landed in v0.3.1.

## Done (2026-05-19)

- [x] **Deploy v0.3 onto Rocky 9.4** @ `192.168.199.234`.
  - First attempt surfaced the `cp -r` nested-overwrite bug
    (described in `proposal.md`).
  - Second attempt (after manual `rm -rf` of nested dirs) succeeded.
- [x] **`install.sh` upgrade-safe fix** (commit `70a8d48`):
  - `rm -rf` before each `cp -r` so re-installs overwrite cleanly.
  - Detect upgrade by presence of `INSTALL_DIR/.env`; preserve the
    file, skip admin prompts, stop service before swapping code.
- [x] **Host bring-up checklist** (folded into `docs/websites.md`):
  - `dnf install nginx` + `systemctl enable --now nginx`
  - Stop the conflicting apitable stack that was holding port 80
    (`docker stop apitable-* && docker update --restart=no`)
  - SELinux relabel of `/opt/dinopanel/sites/` (Rocky)
  - firewalld http service open
  - Restart DinoPanel so bootstrap probe re-runs (informational)
- [x] **S1 — static site happy path** validated end-to-end:
  - Created `test1` (type static, domain `test1.local`) via UI
  - Verified `/opt/dinopanel/sites/test1/public/` was auto-created
  - Verified `/opt/dinopanel/nginx/conf.d/test1.conf` was written
  - Verified `nginx -t` + reload succeeded (service ran)
  - Wrote test `index.html`; `curl -sH "Host: test1.local"
    http://192.168.199.234/` returned the served content
- [x] **Version bump** to `0.3.0`:
  - 4 × `package.json`
  - Sidebar version string

## Deferred to a follow-up smoke (operator-side)

- [ ] **S2 reverse proxy** — pick any host-side upstream (PMM,
  Grafana, whatever's already on the box) and verify end-to-end
  pass-through with `X-Forwarded-*` headers honoured.
- [ ] **S3 reconcile orphan detection** —
  `sudo rm /opt/dinopanel/nginx/conf.d/test1.conf`, then
  `POST /api/websites/reconcile`; row should flip to
  `orphaned: true`. Reinstate the file, re-run reconcile; flag
  clears.
- [ ] **S4 ACME HTTP-01** — needs a public-facing domain (none of
  the .local hostnames work; LE needs to reach the challenge file
  over the public Internet on port 80). Wait until the operator
  has a real domain pointed at the box.
- [ ] **S5 ACME DNS-01 via Cloudflare** — needs a domain on
  Cloudflare + an API token with `Zone:Read` +
  `Zone.DNS:Edit`. Set the token via Settings → SSL providers,
  then issue a cert with challenge=dns-01.
- [ ] **S6 PHP-FPM** — operator must first run the
  `php:8.3-fpm` container per `docs/websites.md` (one-off Docker
  + pool config + SELinux relabel of `/run/php-fpm/`). Then create
  a PHP site and verify a `.php` file gets dispatched through
  FastCGI.
- [ ] **S7 delete + reload** — UI delete on a managed site;
  expect conf file removed, nginx reloaded, DB row gone.

## Verification gates (code-side, after version bump + evidence)

- [x] `pnpm typecheck` — 0 errors
- [x] `pnpm lint` — 0 errors, 0 warnings
- [x] `pnpm test` — 169/169 passing (unchanged from v0.3 Phase 5)
- [x] `pnpm build` — clean
