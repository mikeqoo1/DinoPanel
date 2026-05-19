# Websites (v0.3)

The Websites module manages nginx-served sites and Let's Encrypt
certificates. Sits behind `/api/websites/*` plus
`/api/websites/:id/ssl/*` (added in v0.3 Phase 4). The frontend
lives at `/websites` (Phase 5).

> v0.3 ships incrementally:
> Phase 1 = foundation (this doc covers it),
> Phase 2 = static + reverse-proxy CRUD,
> Phase 3 = PHP-FPM,
> Phase 4 = ACME issuance + auto-renew,
> Phase 5 = UI + docs polish.

## Filesystem layout

All DinoPanel-managed website state lives under a single root
(default `/opt/dinopanel`, overridable via `WEBSITES_ROOT`):

```
/opt/dinopanel/
├── sites/<name>/               # per-site content (mode 0755)
├── nginx/conf.d/<name>.conf    # per-site nginx confs (mode 0755)
└── acme/                       # ACME state (mode 0700)
    ├── certs/<siteId>/         # issued certs (mode 0700)
    │   ├── fullchain.pem
    │   └── privkey.pem
    └── .well-known/acme-challenge/   # HTTP-01 webroot
```

`WebsitesService.onApplicationBootstrap()` creates these directories
idempotently on every boot. If any step fails the module flags
itself **degraded** (writes `settings['websites.bootstrap_failed']`)
but does **not** crash the process — the rest of DinoPanel keeps
working. The `/api/websites/status` endpoint reports the flag.

### Why `/opt/dinopanel/` and not `/www` or `/var/www`?

`/www` is non-standard on Rocky and Ubuntu (1Panel adds it). Using
`/var/www` would collide with the default site that
`apt install nginx` ships on Debian/Ubuntu. `/opt/dinopanel/` keeps
everything DinoPanel owns under one tree, which makes backup,
SELinux relabeling, and "uninstall DinoPanel" all trivially
scoped. See `.arceus/changes/v0.3-websites-acme/decisions.md` Q4
for the full rationale.

## nginx include glue

`WebsitesService` writes a single file (default
`/etc/nginx/conf.d/00-dinopanel.conf`, overridable via
`WEBSITES_NGINX_INCLUDE_PATH`):

```nginx
# Managed by DinoPanel — do not edit.
include /opt/dinopanel/nginx/conf.d/*.conf;
```

Both Rocky 9 (`nginx` from the official repo) and Ubuntu/Debian
(`apt install nginx`) include `/etc/nginx/conf.d/*.conf` from the
main config, so this single file is enough — DinoPanel never has
to patch `/etc/nginx/nginx.conf`. The file is overwritten on every
boot with the same content (idempotent).

If your distro packages already own a file at the same path,
override `WEBSITES_NGINX_INCLUDE_PATH` to something like
`00-dinopanel-include.conf` or a different conf.d directory.

## Sudoers contract

DinoPanel runs as an unprivileged user and shells out via `sudo`
for two operations: `nginx -t` and `systemctl reload nginx`. Add
this snippet to `/etc/sudoers.d/dinopanel` (mode 0440) once at
install time:

```
dinopanel ALL=(root) NOPASSWD: /usr/sbin/nginx -t, \
    /usr/bin/systemctl reload nginx, \
    /usr/bin/systemctl start nginx, \
    /usr/bin/systemctl stop nginx
```

Adjust the user name if you run the panel under a different
account.

On boot `NginxService` runs `sudo -n nginx -t` as a probe. The
result feeds `WebsitesService.getStatus()`. If sudo isn't
configured and `WEBSITES_REQUIRE_SUDO=true` (the default) the
module logs a clear warning pointing at this file. Set
`WEBSITES_REQUIRE_SUDO=false` in development to silence the
warning.

## SELinux / AppArmor

On Rocky / RHEL / CentOS Stream with SELinux enforcing, label the
sites tree as nginx-readable web content:

```sh
sudo semanage fcontext -a -t httpd_sys_content_t '/opt/dinopanel/sites(/.*)?'
sudo restorecon -R /opt/dinopanel/sites
```

For the ACME challenge directory (HTTP-01 reads from it):

```sh
sudo semanage fcontext -a -t httpd_sys_content_t '/opt/dinopanel/acme/.well-known(/.*)?'
sudo restorecon -R /opt/dinopanel/acme/.well-known
```

On Ubuntu / Debian with AppArmor enforcing, extend the nginx
profile (`/etc/apparmor.d/local/usr.sbin.nginx`) with:

```
/opt/dinopanel/sites/** r,
/opt/dinopanel/nginx/conf.d/*.conf r,
/opt/dinopanel/acme/.well-known/** r,
/opt/dinopanel/acme/certs/*/fullchain.pem r,
/opt/dinopanel/acme/certs/*/privkey.pem r,
```

then `sudo systemctl reload apparmor`.

## Phase 1 surface (current)

Only path resolution + bootstrap are real in Phase 1. Mutating
endpoints declare their shape but throw `NOT_IMPLEMENTED_YET` with
the target phase number. `GET /api/websites` returns an empty
list; `GET /api/websites/status` returns the degraded flag.

ACME endpoints (`/api/websites/:id/ssl/*`) are stubbed identically
and land in Phase 4.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `WEBSITES_ROOT` | `/opt/dinopanel` | Root of the on-disk tree |
| `WEBSITES_NGINX_INCLUDE_PATH` | `/etc/nginx/conf.d/00-dinopanel.conf` | Where the include glue file lands |
| `WEBSITES_REQUIRE_SUDO` | `true` | Warn at boot if `sudo -n nginx -t` fails |
