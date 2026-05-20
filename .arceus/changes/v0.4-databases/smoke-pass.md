# v0.4 — Rocky 234 smoke pass

Live verification of v0.4 on the same Rocky Linux 9.4 host
(`192.168.199.234`) where v0.3 was smoked. Mirrors the v0.3.1
smoke-pass layout — each scenario gets a status + evidence block.

## Pre-flight

- Host: Rocky Linux 9.4, Xeon Gold 5218, 600+ days uptime
- DinoPanel: v0.4.0 installed via `scripts/deploy-rocky.sh`
  (upgrade-safe — `.env` preserved from prior v0.3.x install)
- docker: already running (used by v0.2 containers module + v0.3
  smoke); user `mike` in the `docker` group
- SELinux: enforcing — install.sh relabel_path() applied
  `container_file_t` to `/opt/dinopanel/databases/` and reapplied
  `httpd_sys_content_t` to `/opt/dinopanel/sites/`

## Scenarios

### S1 — Create MySQL instance, connect via mysql cli

- **Status:** ⏳ pending
- **Steps:**
  1. UI → /databases → Add database → name=`shop`, engine=`mysql`,
     port=`3306`, leave imageTag default (`mysql:8.4`), no custom
     credentials.
  2. Wait for status badge to flip from `creating` → `running`.
  3. Click row → drawer shows host=`127.0.0.1`, user=`root`,
     password=`<32 char>`.
  4. Copy password, then from the Rocky host:
     ```sh
     mysql -uroot -h127.0.0.1 -P3306 -p<paste> -e 'SELECT 1'
     ```
  5. Expect `+---+\n| 1 |\n+---+\n` output.
- **Evidence:** _(paste curl/mysql output here after run)_

### S2 — Rotate password, old conn fails, new works

- **Status:** ⏳ pending
- **Steps:**
  1. Drawer → Rotate password → confirm.
  2. Verify old password (from S1 step 4) now fails:
     ```sh
     mysql -uroot -h127.0.0.1 -P3306 -p<old> -e 'SELECT 1'
     # expects ERROR 1045
     ```
  3. Drawer shows new password — verify it works.
- **Evidence:** _(paste mysql output here)_

### S3 — Stop / start / restart from drawer

- **Status:** ⏳ pending
- **Steps:**
  1. Drawer → Stop. Status flips to `stopped`. `docker ps -a`
     shows container exited.
  2. Drawer → Start. Status returns to `running`. `mysqladmin
     ping` succeeds via `docker exec`.
  3. Drawer → Restart. PID inside container changes; status
     stays `running` post-restart.
- **Evidence:** _(paste docker ps + mysqladmin output)_

### S4 — Reconcile after `docker kill` outside DinoPanel

- **Status:** ⏳ pending
- **Steps:**
  1. From the host: `docker kill dinopanel-mysql-shop`.
  2. UI → /databases → Reconcile.
  3. Row's status flips to `error` with `lastError:
     container_missing` (visible in the drawer or via
     `GET /api/databases/1`).
- **Evidence:** _(paste docker + reconcile response)_

### S5 — External-conf scan picks up `/etc/nginx/conf.d/test.conf`

- **Status:** ⏳ pending
- **Steps:**
  1. From the host: write a minimal external conf
     ```sh
     sudo tee /etc/nginx/conf.d/legacy-test.conf <<'EOF'
     server {
       listen 8081;
       server_name legacy.test.local;
       return 200 "external\n";
     }
     EOF
     ```
  2. `sudo nginx -t && sudo systemctl reload nginx` so the server
     block actually runs (curl test later).
  3. UI → /websites → Reconcile.
  4. New row appears with `legacy.test.local` + `External` badge.
  5. Click the row → drawer shows `Source conf path:
     /etc/nginx/conf.d/legacy-test.conf` + Copy button; Edit /
     Delete buttons are disabled.
  6. Cleanup: `sudo rm /etc/nginx/conf.d/legacy-test.conf && sudo
     systemctl reload nginx` after the smoke is logged.
- **Evidence:** _(paste reconcile response + screenshot OR row
  state)_

### S6 — ACME_EMAIL settings UI saves, takes effect on next issue

- **Status:** ⏳ pending
- **Steps:**
  1. Verify `ACME_EMAIL` env on Rocky 234 is empty (or unset):
     `grep ACME_EMAIL /usr/local/dinopanel/.env || true`.
  2. UI → Settings → SSL providers → ACME registration email →
     enter `ops@example.com` → Save. Toast confirms.
  3. `curl -H 'Authorization: Bearer <jwt>'
     http://127.0.0.1:9999/api/acme/config` → response shows
     `email: "ops@example.com", emailSource: "settings"`.
  4. (Optional) Set `ACME_EMAIL=env@example.com` in `.env` →
     restart service → settings input locks; GET shows
     `emailSource: "env"`, `email: "env@example.com"`.
- **Evidence:** _(paste curl response from /api/acme/config)_

### S7 — PMM summary cards render

- **Status:** ⏭️ deferred — PMM not currently reachable from Rocky
  234. Will revisit when a test PMM is available (or the operator
  points DinoPanel at the prod PMM with a read-only API token).

## Post-smoke state

_(fill after smoke completes — service uptime, /opt/dinopanel/
disk usage, docker ps for managed DBs + php-fpm if applicable,
any unexpected SELinux denials in `ausearch -m AVC -ts recent`)_

## Bugs surfaced

_(record anything that broke during the smoke — patch commit
references like v0.3.1 did with 70a8d48)_
