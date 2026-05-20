# Databases (v0.4 + v0.4.2 / v0.4.3 PMM follow-ups)

The Databases module manages MySQL / MariaDB / PostgreSQL / Redis /
MongoDB instances running as Docker containers. Sits behind
`/api/databases/*`. The frontend lives at `/databases`.

> v0.4 ships in six phases:
> Phase 1 = foundation (schema, driver skeletons, Sheet primitive),
> Phase 2 = engine drivers + DbInstancesService lifecycle,
> Phase 3 = PMM PromQL client + summary cards,
> Phase 4 = v0.3 carry-over (external-conf, PHP-FPM, ACME_EMAIL),
> Phase 5 = `/databases` route + `/websites` Sheet refactor,
> Phase 6 = docs + Rocky smoke + release.

## Decisions snapshot

The five open questions resolved at activation are recorded in
`.arceus/changes/v0.4-databases/decisions.md`. The short version:

- **Q1 — Install path**: all five engines run as Docker containers.
  No native systemd path. One codepath, no Rocky-vs-Ubuntu distro
  divergence on package names.
- **Q2 — Data dir**: bind-mount `/opt/dinopanel/databases/<engine>/<instance>/`.
  Operator can `ls`, `tar`, `du` straight into the data dir — no
  named-volume ceremony.
- **Q3 — Credentials**: plaintext in the connection card. DinoPanel
  runs as root and stores its sqlite on the same host; encrypting
  the DB password at rest while leaving the same disk readable to
  the same root user moves complexity without moving the threat
  boundary. **Operators who can't accept this should not run
  DinoPanel on a host that exposes its data directory.**
- **Q4 — SecretsService**: deferred to v0.5 alongside audit-log
  integration. ACME account key + Cloudflare API token remain
  plaintext for v0.4.
- **Q5 — PMM integration**: PromQL summary cards (option C) +
  `Open in PMM` link card. DinoPanel positions itself as a PMM
  integrator, not a metrics reimplementer.

## Engines table

| Engine     | Default image       | Default port | Bind-mount target (container) | Default user |
| ---------- | ------------------- | ------------ | ----------------------------- | ------------ |
| mysql      | `mysql:8.4`         | 3306         | `/var/lib/mysql`              | `root`       |
| mariadb    | `mariadb:11.4`      | 3306         | `/var/lib/mysql`              | `root`       |
| postgresql | `postgres:18`       | 5432         | `/var/lib/postgresql`†        | `postgres`   |
| redis      | `redis:7.4-alpine`  | 6379         | `/data`                       | `default`‡   |
| mongodb    | `mongo:7.0`         | 27017        | `/data/db`                    | `root`       |

> **†** Postgres `PGDATA` actually points at `<bind>/pgdata`. Two
> reasons. (1) The entrypoint refuses to initialise when `PGDATA`
> is a directory containing pre-existing entries (ext4 `lost+found`,
> dotfiles) — the subdir lets it own + `chown` cleanly. (2) The
> bind target deliberately mirrors the postgres:18+ image's `VOLUME`
> declaration of `/var/lib/postgresql` (was `/var/lib/postgresql/data`
> in 16/17); pointing the bind one level higher + writing the
> explicit `PGDATA` env keeps the layout identical across major
> upgrades. v0.4 driver handles this automatically.
>
> **‡** Redis has no user concept — `default` is a UI placeholder.
> Auth is purely `requirepass`.

Operator override at create time: `imageTag` and `port` are both
optional in `POST /api/databases`. Custom `username` + `password`
are also optional (server generates a 32-char base64url password
otherwise).

## Filesystem layout

All DinoPanel-managed database state lives under
`DATABASES_ROOT` (default `/opt/dinopanel/databases`):

```
/opt/dinopanel/databases/
├── mysql/
│   ├── shop/                    # bind-mounted to /var/lib/mysql
│   └── analytics/
├── mariadb/
├── postgresql/
│   └── app/
│       └── pgdata/              # PGDATA points here
├── redis/
└── mongodb/
```

Each per-instance dir is created by `DbInstancesService.create` with
0755 permissions; the image entrypoint owns the inner permissions
(mysql=999:999, postgres=999:999 but different inode owner inside
the container, etc.). DinoPanel never `chown`s the data dir from
the host — image entrypoints are the source of truth.

## SELinux notes (Rocky / RHEL / Alma)

The bind-mount data dir needs the `container_file_t` label so the
engine container can read/write it under SELinux enforcing.
`install.sh` handles this two ways:

1. **At install time**: `install.sh` calls `relabel_path()` on the
   root tree (`/opt/dinopanel/databases` and `/opt/dinopanel/sites`)
   so future runtime mkdirs land under a labelled tree.
2. **At runtime per instance**: `DatabasesService.onApplicationBootstrap`
   also runs the label on the root, AND `DbInstancesService.create`
   applies the label to the per-instance subdir as step 4 of the
   atomic-create sequence.

Both paths no-op cleanly on non-SELinux hosts (Ubuntu/Debian) —
`semanage` is the gate, missing → skip with a log line.

To manually verify (Rocky):

```bash
ls -lZ /opt/dinopanel/databases/mysql/shop
# … system_u:object_r:container_file_t:s0 …
```

If you see `unlabeled_t` or similar, run:

```bash
sudo bash /usr/local/dinopanel/scripts/install.sh \
  relabel-path /opt/dinopanel/databases/mysql/shop container_file_t
```

The same subcommand is what the runtime service uses internally.

## PMM PromQL bundles

When `monitoring.pmm_url` is configured (set under Settings → SSL
providers in the panel, or via the existing v0.2.1 monitoring
endpoint), the drawer surfaces four summary cards per instance.
Each card runs one PromQL query against PMM's embedded Prometheus
at `<pmm_url>/prometheus/api/v1/query`.

| Engine     | QPS                                                                     | Connections                                                          | Uptime                                                          | Replication lag                                                                |
| ---------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| mysql      | `rate(mysql_global_status_questions{service_name="<s>"}[5m])`           | `mysql_global_status_threads_connected{service_name="<s>"}`          | `mysql_global_status_uptime{service_name="<s>"}`                | `mysql_slave_lag_seconds{service_name="<s>"}`                                  |
| mariadb    | (same as mysql; uses mysqld_exporter)                                   | (same)                                                               | (same)                                                          | (same)                                                                         |
| postgresql | `rate(pg_stat_database_xact_commit{service_name="<s>"}[5m])`            | `pg_stat_database_numbackends{service_name="<s>"}`                   | `time() - pg_postmaster_start_time_seconds{service_name="<s>"}` | `pg_replication_lag{service_name="<s>"}`                                       |
| redis      | `rate(redis_commands_processed_total{service_name="<s>"}[5m])`          | `redis_connected_clients{service_name="<s>"}`                        | `redis_uptime_in_seconds{service_name="<s>"}`                   | `redis_connected_slave_lag_seconds{service_name="<s>"}`                        |
| mongodb    | `rate(mongodb_op_counters_total{service_name="<s>"}[5m])`               | `mongodb_connections{service_name="<s>",state="current"}`            | `mongodb_instance_uptime_seconds{service_name="<s>"}`           | `mongodb_mongod_replset_member_replication_lag{service_name="<s>"}`            |

`<s>` is the DinoPanel container name (`dinopanel-<engine>-<name>`)
— this is also the canonical PMM `service_name`. When you register
an instance manually in PMM, use this name as the service so the
queries above match.

Empty vector responses (e.g. `redis_connected_slave_lag_seconds`
on a standalone instance with no replica) are mapped to `null` on
the wire and shown as `—` in the UI.

The PromQL response is cached server-side for 30 s. Operators who
need a faster snapshot can hit `GET /api/databases/:id/metrics?refresh=1`
to bypass the cache — that's also what the drawer's manual refresh
button (TBD in a future polish round) would call.

## Drawer PMM cards conditional rendering (v0.4.2)

When PMM is configured globally but the specific instance returns
no data, the drawer distinguishes two cases via `instance.pmmRegistered`:

| `pmmConfigured` | metrics | `pmmRegistered` | UI state            |
| --------------- | ------- | --------------- | ------------------- |
| `false`         | —       | —               | "PMM URL not configured" |
| `true`          | all null| `false`         | "未在 PMM 中註冊"        |
| `true`          | all null| `true`          | "exporter 異常"      |
| `true`          | any value | —             | normal 4-card grid  |

Resolution lives in `apps/web/src/routes/databases/pmm-card-state.ts`
(pure 5-state helper, 8 unit tests). The `pmmRegistered` flag was
already on the schema since v0.4 — v0.4.2 just started using it.
No PMM Management API client was added; flipping the flag to `true`
will be Option B of `archived-v0.X-multihost-pmm-inventory` if
operators eventually want it (see the change folder's D3).

## External PMM section (v0.4.3)

The `/databases` page renders two stacked sections:

1. **DinoPanel-managed** — the existing table of instances DinoPanel
   created.
2. **PMM-monitored (external)** — a read-only panel listing services
   PMM knows about that are NOT in `db_instances`. Surfaces from
   `GET /api/databases/external-pmm`.

The external section only renders when `monitoring.pmm_url` is set;
otherwise it disappears entirely (no error banner, no empty card —
the page reads as if the feature didn't exist).

### Endpoint contract

```bash
# Default (30 s cache hit if available)
curl -H 'Authorization: Bearer <jwt>' \
  http://127.0.0.1:9999/api/databases/external-pmm

# Force re-query (bypasses the 30 s cache)
curl -H 'Authorization: Bearer <jwt>' \
  'http://127.0.0.1:9999/api/databases/external-pmm?refresh=1'
```

Response shape (always 200; failures are tagged in `error`):

```json
{
  "services": [
    {
      "serviceId": "<uuid>",
      "serviceName": "shop-mysql",
      "engine": "mysql",
      "nodeId": "<uuid>",
      "address": "10.0.0.5",
      "port": 3306
    }
  ],
  "error": null,
  "fetchedAt": 1716200000000
}
```

`error` is one of:

| Reason            | When                                                              |
| ----------------- | ----------------------------------------------------------------- |
| `not_configured`  | `monitoring.pmm_url` unset (section collapses on UI side)         |
| `auth`            | PMM returned 401 / 403 — check the API token in Settings          |
| `unreachable`     | DNS / connect / TLS / timeout failure                             |
| `bad_response`    | 200 OK but body doesn't look like a PMM inventory response        |

Failure responses are not cached — the next call re-probes PMM.

### Server-side dedup

Services whose `service_name` matches **any** `db_instances.container_name`
are filtered out before the response is shaped. DinoPanel's container
naming convention (`dinopanel-<engine>-<name>`) is also the canonical
PMM `service_name` per the v0.4 decisions doc, so this is a direct
string match.

### Engine normalization

PMM 2.x doesn't have a first-class Redis service type — operators
typically register `redis_exporter` as an `external` service. The
client maps `external` services with names matching `/redis/i` to
engine `redis`, everything else under `external` to `unknown`. Other
buckets pass through (`mysql` → `mysql`, etc.). The `unknown` engine
renders without an engine badge but is still listed.

### Why no per-row metric cards

The proposal originally suggested four metric cards per external
row (mirroring the drawer's QPS / connections / uptime / replication
lag layout). The Phase 3 implementation drops them — see the change
folder's `decisions.md` D7. Briefly:

- Per-row metrics = 4 PromQL queries × N rows per refresh.
- Empty all-`—` cards visually collide with v0.4.2's
  "not registered" / "exporter unhealthy" hints — operators would
  ask "is this exporter broken?" when the answer is just "we didn't
  fetch metrics here".
- Option B's design framing is "DinoPanel surfaces what PMM knows,
  PMM owns the live data". The Open-in-PMM deep link
  (`{pmm_url}/graph/inventory/services/<serviceId>`) drops the
  operator onto PMM's real metrics page in one click.

If operators ask for inline metrics later, a per-`serviceId` metrics
endpoint can be added (~1 day, gated on real feedback).

## Lifecycle cheat-sheet

```bash
# List
curl -H 'Authorization: Bearer <jwt>' \
  http://127.0.0.1:9999/api/databases

# Create (server generates strong default credentials)
curl -X POST -H 'Authorization: Bearer <jwt>' -H 'Content-Type: application/json' \
  -d '{"name":"shop","engine":"mysql","port":3306}' \
  http://127.0.0.1:9999/api/databases

# Rotate password (brief downtime)
curl -X POST -H 'Authorization: Bearer <jwt>' \
  http://127.0.0.1:9999/api/databases/1/rotate-password

# Stop / start / restart
curl -X POST -H 'Authorization: Bearer <jwt>' \
  http://127.0.0.1:9999/api/databases/1/stop

# Delete (keep data dir)
curl -X DELETE -H 'Authorization: Bearer <jwt>' -H 'Content-Type: application/json' \
  -d '{"dropData":false}' \
  http://127.0.0.1:9999/api/databases/1

# Delete (also rm -rf the data dir — irreversible)
curl -X DELETE -H 'Authorization: Bearer <jwt>' -H 'Content-Type: application/json' \
  -d '{"dropData":true}' \
  http://127.0.0.1:9999/api/databases/1

# Reconcile (re-sync DB state with what docker actually has)
curl -X POST -H 'Authorization: Bearer <jwt>' \
  http://127.0.0.1:9999/api/databases/reconcile

# PMM metrics for a single instance (cached 30 s; ?refresh=1 to bust)
curl -H 'Authorization: Bearer <jwt>' \
  'http://127.0.0.1:9999/api/databases/1/metrics?refresh=1'
```

## Troubleshooting

**`DB_PORT_CONFLICT` at create**: a previous DinoPanel instance OR
something else on the host is already bound to that port. The
service does both a sqlite-uniq check and a `net.createServer().listen()`
probe; either failing surfaces this error. Pick another port or
free the existing one.

**Container creates successfully but `status` flips to `error` on
the next reconcile**: usually means the image entrypoint failed
during init. Inspect via `docker logs dinopanel-<engine>-<name>` —
common causes: wrong `MYSQL_ROOT_PASSWORD` charset, postgres
`PGDATA` collision (shouldn't happen with the dataSubdir, but
double-check `/opt/dinopanel/databases/postgresql/<name>/` is
empty for the first init), mongo init script syntax errors.

**Reconcile reports `orphanContainer > 0`**: there's a container
under our naming convention (`dinopanel-<engine>-<*>`) that has
no DB row. DinoPanel won't auto-adopt it — credentials aren't
recoverable. Either:
- `docker rm -f dinopanel-<engine>-<orphan>` to clean up, or
- Restore from a sqlite backup that knew about it.

The opposite case (DB row whose container is gone) flips that row
to `status: 'error'` with `lastError: 'container_missing'`. The
operator can either re-create the container manually (matching the
existing name + bind-mount) OR delete the row via the drawer.

**SELinux denials on Rocky despite the install.sh relabel**: run
`ausearch -m AVC -ts recent` to confirm. Common cause is the relabel
having been applied AFTER a container already wrote into the dir
with the wrong context; `sudo restorecon -R /opt/dinopanel/databases`
fixes that.

**PMM cards always show `—`**: check `monitoring.pmm_url` is set
(Settings → SSL providers), then check the network reachability
from the DinoPanel host to PMM (TLS verification on by default;
flip `monitoring.pmm_tls_skip_verify` or set
`MONITORING_PMM_TLS_SKIP_VERIFY=true` for self-signed PMM).
Service names must match — DinoPanel uses
`dinopanel-<engine>-<name>` as the `service_name` filter; if you
registered the instance in PMM under a different name the queries
return empty.

## Backup / restore (escape hatch)

v0.4 doesn't ship a backup module. The v0.5 scheduler's
`backup_files` runner can `tar` the bind-mount path directly:

```cron
# /etc/cron.d/dinopanel-mysql-shop (or via the scheduler UI)
0 3 * * *  tar -czf /backups/mysql-shop-$(date +%F).tar.gz /opt/dinopanel/databases/mysql/shop
```

For SQL-level dumps, shell out to the container's native client:

```bash
docker exec dinopanel-mysql-shop \
  mysqldump --single-transaction -uroot -p"$(cat /opt/dinopanel/databases/mysql/shop/.dinopanel-password)" \
  --all-databases > /backups/shop.sql
```

Restoring is the same in reverse — `docker stop` the instance,
`tar -xzf` the backup, `docker start`.

## Related files

- `apps/server/src/modules/databases/` — module
- `apps/server/src/modules/databases/engines/` — per-engine drivers
- `apps/server/src/modules/monitoring/pmm-promql.client.ts` — PMM client
- `apps/web/src/routes/databases/` — UI
- `scripts/install.sh` — `relabel-path` subcommand
- `.arceus/changes/v0.4-databases/` — proposal, spec, decisions
