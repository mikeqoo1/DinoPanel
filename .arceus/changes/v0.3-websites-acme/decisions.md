# v0.3 — Decisions

Written incrementally as each open question is confirmed. Resume
protocol (see `discussion-state.md`) requires per-question persist
so an interrupted conversation doesn't lose state.

## Q1 — nginx where? → **Host systemd**

- **Confirmed:** 2026-05-18
- **Decision:** nginx runs on the host, managed by systemd. Not a
  Docker container.
- **Why:**
  - Port 80 is the linchpin for ACME HTTP-01. Docker port binding
    races are exactly the pain 1Panel learned from and reverted on.
  - ACME cert files + nginx `reload` signal stay on a single host
    namespace — no volume mounts or cross-container signaling.
  - 1Panel itself runs host nginx for the same reason; we inherit
    that lesson instead of re-discovering it.
- **Implications:**
  - DinoPanel backend shells out to `nginx -t` / `systemctl reload nginx`
    on the host (needs sudoers entry or capability).
  - SELinux on Rocky / AppArmor on Ubuntu must allow nginx to read
    DinoPanel-managed conf + cert paths. Document in deploy guide.
  - Proposal `goals[4]` ("run nginx as a Docker container") is now
    superseded — update `proposal.md` before flipping status to
    `active`.

## Q2 — Config storage? → **Live conf files + small SQLite metadata**

- **Confirmed:** 2026-05-18
- **Decision:** nginx `.conf` files are the single source of truth.
  SQLite stores only auxiliary metadata per site: `site_type`,
  `cert_paths`, `managed_by_dinopanel` flag, plus whatever ACME
  bookkeeping (next-renewal-at, last-issued-at) Q5 ends up needing.
- **Why:**
  - `nginx -t` already validates files — making files authoritative
    means there's no dual-write divergence to debug.
  - Admins will hand-edit conf in emergencies. Their edits must
    survive the next DinoPanel reload, not be silently overwritten.
  - 1Panel's DB-as-master model is one of its most-reported sources
    of issues; we explicitly diverge here.
- **Implications:**
  - On boot / on reload, DinoPanel re-scans `/etc/nginx/conf.d/`
    (or wherever Q4 lands) and reconciles SQLite to whatever it
    finds — files win on conflict.
  - `managed_by_dinopanel` flag in metadata lets the UI show
    hand-edited sites as read-only-from-UI (still editable on disk).
  - SQLite schema kept deliberately thin — resist the urge to mirror
    every directive.

## Q3 — ACME library? → **`acme-client` (Node)**

- **Confirmed:** 2026-05-18
- **Decision:** ACME issuance + renewal goes through the `acme-client`
  npm package. No Python (certbot) or Go (lego) runtime dependency.
- **Why:**
  - Stays inside the existing TS/Node stack — no new runtime to
    install, package, or document.
  - Cloudflare DNS-01 is straightforward CF API calls from Node;
    the only provider v0.3 ships, so library breadth isn't needed.
  - Avoids 1Panel's certbot-snap-vs-apt user-confusion class of
    issues.
- **Implications:**
  - DNS provider coverage is **manual per-provider** code. v0.3
    ships HTTP-01 + Cloudflare DNS-01 only (matches proposal scope).
  - If a future release ever needs broad DNS provider coverage,
    revisit and shell out to `lego` then — not pre-emptively.
  - Account keys + order state stored under DinoPanel's data dir
    (path settled in Q4 → `/opt/dinopanel/`).

## Q4 — Site directory layout? → **`/opt/dinopanel/sites/<name>/`**

- **Confirmed:** 2026-05-18
- **Decision:** All DinoPanel-managed site content lives under
  `/opt/dinopanel/sites/<name>/`. nginx confs in
  `/opt/dinopanel/nginx/conf.d/<name>.conf` (included from host
  `/etc/nginx/nginx.conf`). ACME state + cert output under
  `/opt/dinopanel/acme/`.
- **Why:**
  - Doesn't squat on 1Panel's `/www` (non-standard on Rocky / Ubuntu).
  - Doesn't collide with `/var/www` defaults from apt-installed
    nginx on Debian/Ubuntu.
  - Single namespace under `/opt/dinopanel/` makes backup, SELinux
    relabeling, and "uninstall DinoPanel" all trivially scoped to
    one tree.
- **Implications:**
  - Host nginx must `include /opt/dinopanel/nginx/conf.d/*.conf;` —
    DinoPanel installer writes this snippet on first run.
  - SELinux: relabel `/opt/dinopanel/sites/` as
    `httpd_sys_content_t` (Rocky) on install. AppArmor profile on
    Ubuntu needs `/opt/dinopanel/sites/** r,` granted.
  - Future v0.4 database data dirs **also** land under
    `/opt/dinopanel/` (e.g. `/opt/dinopanel/databases/`) — keeps the
    one-tree property when v0.4 lands. Re-check at v0.4 kickoff.

## Q5 — TLS auto-renewal cadence? → **v0.5 scheduler (cron module)**

- **Confirmed:** 2026-05-18
- **Context shift since discussion-state.md was written:** v0.5
  scheduler + cron + audit log shipped between the pause and resume
  (commits `f1f0204`, `9a70d83`), and were smoke-tested on Rocky
  9.4 in v0.5.1. The original "in-process setInterval as a
  stop-gap" recommendation is now strictly worse — the thing it was
  a stop-gap *for* exists.
- **Decision:** v0.3 registers an `acme-renew` job with the v0.5
  scheduler. Runs every 12h. Sweeps all DinoPanel-managed certs
  and renews any with ≤ 30 days to expiry.
- **Why:**
  - One scheduler in the product, not two. v0.5 already provides
    audit-log visibility, manual "Run now", and the failure-history
    UI; ACME renewal inherits all of that for free.
  - No throwaway code, no later "migrate stop-gap to v0.5" task.
  - Restart resiliency comes from the scheduler's persistence layer
    (v0.5 already solved this), not from a fragile in-process
    setInterval that resets on every DinoPanel restart.
- **Implications:**
  - v0.3 has a hard dependency on v0.5 scheduler API surface.
    Acceptable — v0.5 is already main-line.
  - The renewal job needs a stable id so re-registration on boot
    is idempotent. Use `acme-renew` as the canonical job name.
  - Audit-log entries for renewal success/failure are first-class
    UX, not afterthoughts — surface them in the v0.3 Sites UI as
    "last renewal" / "next attempt" badges.
