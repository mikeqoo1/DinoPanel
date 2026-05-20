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

### Smoke patches surfaced (all on main, candidate v0.4.1)

| Commit    | Fix |
| --------- | --- |
| `a8b4fa9` | install.sh — skip admin seed on upgrade (set -u unbound ADMIN_USERNAME) |
| `89eacd5` | PostgresDriver — postgres:18 default + cross-version PGDATA layout |
| `bf49ef3` | install.sh tail message — ${ADMIN_USERNAME:-} default |
| `6a21d19` | DbInstancesService.create — auto-pull image before createContainer |
| `c4a29e2` | drawer Copy buttons — execCommand fallback for non-secure HTTP context |

### S1 — Create instance, connect via cli

- **Status:** ✅ PASS (PostgreSQL on 2026-05-20, MySQL also validated by operator)
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
- **Evidence (PostgreSQL):**
  ```
  $ sudo docker exec -e PGPASSWORD=pQe9npbOD-... dinopanel-postgresql-shop \
      psql -U postgres -c "SELECT version();"
  PostgreSQL 18.4 (Debian 18.4-1.pgdg13+1) on x86_64-pc-linux-gnu,
    compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit
  (1 row)
  ```
  - DB row: `id=1 · shop · postgresql · postgres:18 · port=5432 · user=postgres · status=running · password 43 chars (base64url 32B)`
  - Bind-mount: `/opt/dinopanel/databases/postgresql/shop/pgdata/` owned by UID 999 (postgres inside container = systemd-coredump on host), mode 0700.
- **Evidence (MySQL):** operator-validated via UI + cli (`mysql -uroot ... SELECT 1`).

### S2 — Rotate password, old conn fails, new works

- **Status:** ✅ PASS (operator-validated: drawer rotate button → new password → old auth fails, new auth works)
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

- **Status:** ✅ PASS (operator-validated: 啟動 / 停止 / 重啟 三顆 lifecycle 按鈕都 OK)
- **Steps:**
  1. Drawer → Stop. Status flips to `stopped`. `docker ps -a`
     shows container exited.
  2. Drawer → Start. Status returns to `running`. `mysqladmin
     ping` succeeds via `docker exec`.
  3. Drawer → Restart. PID inside container changes; status
     stays `running` post-restart.
- **Evidence:** _(paste docker ps + mysqladmin output)_

### S4 — Reconcile after `docker kill` outside DinoPanel

- **Status:** ⏸️ deferred — operator paused smoke at S3 with two new
  followup topics surfaced (see "Followups raised during smoke"
  below). Not blocking v0.4 ship; runtime path covered by Phase 2
  reconcile unit tests (matching / missing-container / orphan /
  empty).
- **Steps:**
  1. From the host: `docker kill dinopanel-mysql-shop`.
  2. UI → /databases → Reconcile.
  3. Row's status flips to `error` with `lastError:
     container_missing` (visible in the drawer or via
     `GET /api/databases/1`).
- **Evidence:** _(paste docker + reconcile response)_

### S5 — External-conf scan picks up `/etc/nginx/conf.d/test.conf`

- **Status:** ⏸️ deferred — same operator-pause as S4. Coverage via
  Phase 4 unit tests (managed-only / external-only / server_name
  conflict / symlink resolution × 4 cases).
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

- **Status:** ⏸️ deferred — same operator-pause. Coverage via
  Phase 4 unit tests (env wins / settings fallback / both unset
  throws / whitespace trim × 4 cases).
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

All five fixes shipped in-flight, listed in the "Smoke patches
surfaced" table near the top. v0.4.1 patch release will roll
them up + bump version strings.

## Followups raised during smoke (2026-05-20)

Operator surfaced two design questions at the end of S3 that need
their own change proposals (not v0.4.1 patch material):

1. **PMM cards conditional rendering** — when an instance isn't
   actually registered with PMM (the common case for fresh
   instances; spec.md flagged auto-register as a Phase 6 stretch
   that we didn't ship), the four cards render with "—"
   placeholders. Misleading: looks like PMM is broken when it's
   just "no service registered yet". Draft:
   `.arceus/changes/v0.4.x-pmm-cards-conditional/`.

2. **PMM-managed external databases in the /databases list** —
   operator wants to see DBs that PMM is already monitoring but
   that DinoPanel didn't create (different host, native install,
   different orchestrator). Pulls in multi-host inventory model,
   PMM service list API, UI badge for "monitored not managed".
   Bigger scope — bumps into the v0.5+ roadmap. Draft:
   `.arceus/changes/v0.X-multihost-pmm-inventory/`.

Both drafts carry the conversation context so a future session can
pick up without re-deriving the problem.
