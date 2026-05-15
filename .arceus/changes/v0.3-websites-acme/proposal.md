# v0.3 — Websites + ACME SSL

**Status:** draft
**Target:** v0.3 (≈ 4 weeks)
**Depends on:** v0.2-docker-containers (completed)

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
4. **Backend nginx**: run nginx as a Docker container managed by
   DinoPanel itself (reuse v0.2 container management).

## Non-goals (deferred or rejected)

- WAF rules / mod_security UI (Pro-feature territory, skip).
- Custom error pages editor (later).
- Multi-host load balancing.
- HAProxy / Caddy / Traefik backends — nginx only for v0.3.
- App Store integration (App Store is permanently removed).
- Wildcard SSL via every DNS provider 1Panel supports (50+); v0.3
  ships Cloudflare DNS-01 and HTTP-01 only.

## Open questions to resolve before activation

1. **nginx where?** Docker container managed by DinoPanel (reuse v0.2
   infra), or host nginx via systemd? Docker is cleaner; host is
   what 1Panel actually does because Docker's port 80 binding conflicts
   easily.
2. **Config storage**: live nginx confs vs DinoPanel SQLite mirror?
   1Panel writes files + DB. Pro vs con.
3. **ACME library**: `acme-client` (Node), shelling out to certbot,
   or `lego` binary (Go)? Each has trade-offs around DNS provider
   coverage and dep weight.
4. **Site directory layout**: where do user files live? `/www/sites/<name>/`
   mirrors 1Panel but might collide with existing servers.
5. **TLS auto-renewal cadence**: cron? systemd timer? in-process
   scheduler? (v0.5 will add a cron module anyway — wait or build a
   stop-gap?)

Activate this change only after the five questions are answered the
same way v0.2's five were — per-item, written into `decisions.md`.

## Rough sizing

- nginx integration + reverse proxy + static: 1.5 weeks
- PHP (PHP-FPM container coordination): 0.5 week
- ACME HTTP-01 + Cloudflare DNS-01: 1.5 weeks
- E2E + docs + polish: 0.5 week
- Total: ~4 weeks
