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

## Validated 2026-05-19 (operator-side, second smoke session)

- [x] **S2 reverse proxy** — created `dino-proxy` (type
  reverse_proxy, primary domain `dp.local`, upstream
  `http://127.0.0.1:9999` — DinoPanel dogfooded itself).
  `curl -sIH "Host: dp.local" http://192.168.199.234/` returned
  200 with `X-Forwarded-*` headers correctly set on the proxied
  request. Site was then deleted as part of S7.
- [x] **S3 reconcile orphan detection** — `sudo rm
  /opt/dinopanel/nginx/conf.d/test1.conf`, clicked 重新對帳 in
  UI, observed test1 row flip to `orphaned: true` badge with
  toast "已掃描 ... 1 個孤兒". Cleanup followed via UI delete.
- [x] **S7 delete + reload** — UI delete on dino-proxy: conf file
  removed from `/opt/dinopanel/nginx/conf.d/`, nginx auto-reloaded,
  `curl` on `Host: dp.local` falls through to the default nginx
  welcome (no `X-Forwarded-*` headers anymore). DB row gone.

**Post-smoke state** (SSH verification by Claude, 2026-05-19):
- `dinopanel.service` active, 28 min stable uptime since last
  restart
- `/etc/nginx/conf.d/00-dinopanel.conf` intact (bootstrap idempotent
  across restarts)
- `/opt/dinopanel/nginx/conf.d/` empty — both confs cleanly removed
- `/opt/dinopanel/sites/test1/` content directory still present —
  expected behaviour: `SitesService.remove()` only deletes the conf
  file and the DB row, never touches site content (avoids accidental
  data loss when the operator just wants to take a site offline).
  A future "delete site + remove content" option could opt into the
  destructive flavour.
- `sites` table: 0 rows
- `acme_orders` table: 0 rows (no ACME exercises run; S4/S5 still
  deferred)

## Still deferred (need real-world prerequisites)

- [ ] **S4 ACME HTTP-01** — needs a public-facing domain (none of
  the `.local` hostnames work; LE needs to reach the challenge
  file over the public Internet on port 80). Wait until the
  operator has a real domain pointed at the box.
- [ ] **S5 ACME DNS-01 via Cloudflare** — needs a domain on
  Cloudflare + an API token with `Zone:Read` +
  `Zone.DNS:Edit`. Set the token via Settings → SSL providers,
  then issue a cert with challenge=dns-01.
- [ ] **S6 PHP-FPM** — operator must first run the
  `php:8.3-fpm` container per `docs/websites.md` (one-off Docker
  + pool config + SELinux relabel of `/run/php-fpm/`). Then create
  a PHP site and verify a `.php` file gets dispatched through
  FastCGI.

## Verification gates (code-side, after version bump + evidence)

- [x] `pnpm typecheck` — 0 errors
- [x] `pnpm lint` — 0 errors, 0 warnings
- [x] `pnpm test` — 169/169 passing (unchanged from v0.3 Phase 5)
- [x] `pnpm build` — clean
