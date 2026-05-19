# v0.3 — Websites + ACME SSL

**Status:** active (activated 2026-05-18, all 5 open questions confirmed — see `decisions.md`)
**Target:** v0.3 (≈ 4 weeks)
**Depends on:** v0.2-docker-containers (completed), v0.5-firewall-cron-logs (completed — TLS renewal uses v0.5 scheduler)

## Context

After v0.2 the panel can manage Docker. v0.3 is the next big product
slice: **websites and HTTPS**, the most common reason a sysadmin
reaches for a panel like this.

The scope mirrors 1Panel's "網站" module but stays trimmed to what
the team can actually maintain. Same "trim aggressively, ship what
matters" posture that produced v0.2 without an App Store.

## Goals

1. **Site types** (subset; trim aggressively from 1Panel's 6 types):
   - Static (HTML/JS/CSS in a directory)
   - Reverse proxy (point a domain at an upstream URL or container)
   - PHP (probably via PHP-FPM container)
   - That's it for v0.3 — Node / Java / Go / Python deferred until
     there's demand.
2. **Domain + virtual host management**: nginx config generation
   per site.
3. **SSL via ACME** (Let's Encrypt + optional ZeroSSL): HTTP-01
   challenge first, DNS-01 for selected DNS providers (Cloudflare
   most likely, others to follow).
4. **Backend nginx**: nginx runs on the host under systemd, **not**
   in a Docker container. DinoPanel writes confs to
   `/opt/dinopanel/nginx/conf.d/*.conf` (included from
   `/etc/nginx/nginx.conf`) and triggers `nginx -t` +
   `systemctl reload nginx` via sudoers. (Q1 decision — see
   `decisions.md`. Original Docker-container plan reverted because
   port 80 binding races would block ACME HTTP-01, which is the
   exact reason 1Panel itself switched back to host nginx.)

## Non-goals (deferred or rejected)

- WAF rules / mod_security UI (Pro-feature territory, skip).
- Custom error pages editor (later).
- Multi-host load balancing.
- HAProxy / Caddy / Traefik backends — nginx only for v0.3.
- App Store integration (App Store is permanently removed).
- Wildcard SSL via every DNS provider 1Panel supports (50+); v0.3
  ships Cloudflare DNS-01 and HTTP-01 only.

## Open questions

All five resolved 2026-05-18 — see `decisions.md` for full rationale.
Short form:

1. **nginx where?** → host systemd
2. **Config storage** → live conf files + thin SQLite metadata (files win on conflict)
3. **ACME library** → `acme-client` (Node)
4. **Site directory layout** → `/opt/dinopanel/sites/<name>/`
5. **TLS auto-renewal** → v0.5 scheduler job `acme-renew`, 12h cadence, renew at ≤30d (context shift: v0.5 scheduler shipped between pause and resume, so the original in-process stop-gap is no longer needed)

## Rough sizing

- nginx integration + reverse proxy + static: 1.5 weeks
- PHP (PHP-FPM container coordination): 0.5 week
- ACME HTTP-01 + Cloudflare DNS-01: 1.5 weeks
- E2E + docs + polish: 0.5 week
- Total: ~4 weeks
