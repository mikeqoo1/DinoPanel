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

## PHP-FPM setup (one-time operator step)

PHP sites use a shared FPM socket. v0.3 does **not** auto-provision
the FPM container — the operator runs it once and DinoPanel just
generates an nginx conf that points `fastcgi_pass` at the socket.
Auto-provisioning may land in a future release; the rationale for
deferring it is in `.arceus/changes/v0.3-websites-acme/tasks.md`
(Phase 3 deviation log).

The expected socket path is `PHP_FPM_SOCKET_PATH`
(default `/run/php-fpm/dinopanel-php-8.3.sock`). Override the env
var if you place the socket elsewhere.

### Minimal Docker example (PHP 8.3)

```sh
sudo mkdir -p /run/php-fpm
sudo chmod 0755 /run/php-fpm

docker run -d \
  --name dinopanel-php-8.3 \
  --restart=unless-stopped \
  -v /opt/dinopanel/sites:/opt/dinopanel/sites:ro \
  -v /run/php-fpm:/run/php-fpm \
  --user "$(id -u www-data):$(id -g www-data)" \
  php:8.3-fpm \
  php-fpm \
    --nodaemonize \
    --fpm-config /usr/local/etc/php-fpm.d/zz-docker.conf
```

Then add a pool config that listens on the Unix socket. Drop a
file at `/etc/dinopanel/php-8.3-pool.conf`:

```ini
[www]
listen = /run/php-fpm/dinopanel-php-8.3.sock
listen.owner = www-data
listen.group = www-data
listen.mode = 0660
user = www-data
group = www-data
pm = dynamic
pm.max_children = 16
pm.start_servers = 4
pm.min_spare_servers = 2
pm.max_spare_servers = 8
```

…and mount it into the container with
`-v /etc/dinopanel/php-8.3-pool.conf:/usr/local/etc/php-fpm.d/zz-pool.conf:ro`.

### SELinux note (Rocky)

The nginx user needs to read the socket. Label `/run/php-fpm/` with
`httpd_var_run_t`:

```sh
sudo semanage fcontext -a -t httpd_var_run_t '/run/php-fpm(/.*)?'
sudo restorecon -R /run/php-fpm
sudo setsebool -P httpd_can_network_connect 1
```

### PHP version selection in v0.3

Only **PHP 8.3** is supported. The `siteCreate.payload.phpVersion`
enum is locked to `'8.3'`. Other versions are deferred until a
release sees demand; the schema is already in place to extend, but
container provisioning + per-version socket routing has to land
first.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `WEBSITES_ROOT` | `/opt/dinopanel` | Root of the on-disk tree |
| `WEBSITES_NGINX_INCLUDE_PATH` | `/etc/nginx/conf.d/00-dinopanel.conf` | Where the include glue file lands |
| `WEBSITES_REQUIRE_SUDO` | `true` | Warn at boot if `sudo -n nginx -t` fails |
| `PHP_FPM_SOCKET_PATH` | `` (empty) | v0.4: empty → managed mode (auto-provision php:8.3-fpm); `unix:/path` or `/path` → external socket; `tcp://host:port` → external TCP |
| `HOST_NGINX_CONFD_DIR` | `/etc/nginx/conf.d` | v0.4: host nginx tree scanned for external confs during reconcile |
| `ACME_EMAIL` | `` (empty) | Env-first ACME registration email; v0.4 also reads `settings['acme.email']` as fallback |

## v0.4 carry-over changes

Three things shifted in v0.4 without changing the v0.3 contract.

### External-conf reconcile

`SitesService.reconcile` now walks both:

1. `/opt/dinopanel/nginx/conf.d/*.conf` — the managed tree
   (orphan detection: missing files → row marked `orphaned: true`).
2. `/etc/nginx/conf.d/*.conf` (or wherever `HOST_NGINX_CONFD_DIR`
   points) — operator-managed external confs (new for v0.4).

External entries are imported as rows with
`managedByDinopanel: false` and an `externalConfPath` field set to
the absolute path. The UI badges them as **External** in the list
and renders the drawer in read-only mode (Issue/Renew/Delete are
disabled — the file isn't ours to touch).

**Exclusions** (reconcile skips these even when present in the
host tree):

- The DinoPanel glue file
  (`WEBSITES_NGINX_INCLUDE_PATH`, default
  `/etc/nginx/conf.d/00-dinopanel.conf`) — it's an `include`
  directive, not a server block.
- Any file whose `realpath` resolves under `WEBSITES_ROOT` — covers
  symlinks pointing back into our managed tree.

**`server_name` conflicts**: when the same `server_name` appears
in two external files, reconcile surfaces the conflict in
`ReconcileResponse.serverNameConflicts: string[]` and the UI shows
a toast. Reconcile **never** auto-resolves — the operator chooses
which file wins (usually by `mv`-ing one out of the way).

**`server_name` extraction**: lightweight regex parse —
`/\bserver_name\s+([^;]+);/`. We don't run `nginx -t` against
external files; reconcile is read-only on the operator's tree.
The first non-wildcard hostname becomes the row's `primaryDomain`;
wildcards (`*.foo`) and the special `_` token are surfaced as-is
when nothing else is present.

### PHP-FPM auto-provision

v0.3 expected the operator to run a `php:8.3-fpm` container by
hand and point `PHP_FPM_SOCKET_PATH` at its socket. v0.4 makes
that the *external* mode (still supported) and adds a *managed*
mode where DinoPanel runs the container itself.

| `PHP_FPM_SOCKET_PATH` env value | Mode | What happens |
| --- | --- | --- |
| (empty) | **managed** | First PHP-site creation triggers `docker run php:8.3-fpm` named `dinopanel-php-fpm` listening on TCP `127.0.0.1:9000`, with a 1:1 bind-mount of `<WEBSITES_ROOT>/sites/` so the entrypoint sees the same paths nginx resolves to. After the last PHP site is removed, a 10-min idle timer stops the container. |
| `/path/to/socket` or `unix:/path/to/socket` | **external** | DinoPanel writes `fastcgi_pass unix:/path/to/socket;` into the conf and never touches the operator's container. |
| `tcp://host:port` | **external** | DinoPanel writes `fastcgi_pass host:port;` directly. |

Status surfaces at `GET /api/websites/php-fpm/status` (also visible
under Settings → PHP-FPM card):

```json
{
  "mode": "managed",
  "upstream": "127.0.0.1:9000",
  "containerRunning": true,
  "containerName": "dinopanel-php-fpm"
}
```

`POST /api/websites/php-fpm/restart` restarts the managed container
(no-op in external mode).

### ACME_EMAIL — env-first + settings fallback

v0.3 made `ACME_EMAIL` env-only. v0.4 resolves the email per
issuance attempt with this precedence:

1. `process.env.ACME_EMAIL` — env wins, always.
2. `settings['acme.email']` — written by the new email input
   under Settings → SSL providers.
3. Neither set → `IssueOrchestrator.getEmail()` throws
   `ACME_EMAIL_MISSING` with a clear "configure your email" hint.

The settings input is **disabled in the UI** when env is set,
showing a "Locked by ACME_EMAIL env: value@host" hint. Cleared
settings value (empty string / null) falls back to env.
