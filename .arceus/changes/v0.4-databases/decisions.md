# v0.4 — Decisions

Written incrementally as each open question is confirmed. Resume
protocol mirrors v0.3: per-question persist so an interrupted
conversation doesn't lose state.

## Q1 — Install path per engine? → **All-container, uniform**

- **Confirmed:** 2026-05-19
- **Decision:** All five engines (MySQL, MariaDB, PostgreSQL,
  Redis, MongoDB) ship as Docker containers managed via the v0.2
  dockerode service. No native systemd path in v0.4.
- **Why:**
  - One codepath, one mental model. Operators learn DinoPanel's DB
    surface once and it behaves the same for every engine.
  - Reuses the dockerode plumbing already exercised in v0.2 — no
    new "host package manager + systemd unit detection" subsystem
    to write, test, or document.
  - Sidesteps Rocky-vs-Ubuntu distro divergence on package names,
    repo setup (PGDG, MySQL community), and systemd unit naming.
  - 1Panel's native-mode databases is one of its most-platform-
    specific surfaces; we explicitly diverge.
- **Implications:**
  - `proposal.md` description of "two parallel installation
    strategies per engine (native vs Docker)" is superseded —
    Docker-only.
  - Engine "drivers" become thin dockerode wrappers around
    `image + env + bind-mounts + healthcheck` — not systemd unit
    abstractions.
  - Operators who insist on native install can still run the engine
    themselves outside DinoPanel; DinoPanel won't manage it. Mirror
    the v0.3 "external conf" reconcile pattern if/when demand
    materializes.

## Q2 — Data directory layout? → **Bind-mount `/opt/dinopanel/databases/<engine>/<instance>/`**

- **Confirmed:** 2026-05-19
- **Decision:** Each DB instance gets a bind-mounted data directory
  at `/opt/dinopanel/databases/<engine>/<instance>/`. Docker named
  volumes are not used.
- **Why:**
  - Continues the v0.3 single-namespace property
    (`/opt/dinopanel/sites/`, `/opt/dinopanel/nginx/`,
    `/opt/dinopanel/acme/`, now `/opt/dinopanel/databases/`).
  - Operator can `ls`, `tar`, `du` straight into the data dir
    without `docker run --rm -v … busybox tar` ceremony.
  - v0.5 `backup_files` scheduled job can dump a DB to disk and
    then snapshot the bind-mount as a normal file path — no
    volume-aware backup logic to build.
  - "Uninstall DinoPanel" stays trivially scoped to one tree.
- **Implications:**
  - SELinux on Rocky must allow the engine container to access the
    bind-mount path. **`scripts/install.sh` currently has zero
    SELinux logic** — v0.3's `/opt/dinopanel/sites/` was relabeled
    by hand on Rocky 234, not by install. v0.4 adds a `relabel()`
    helper to install.sh that applies `container_file_t` (or `:z`
    on the bind-mount) per engine, and backfills the v0.3 `sites/`
    `httpd_sys_content_t` relabel into the same helper so future
    installs are reproducible.
  - Per-engine UID/GID inside containers all happen to be 999 but
    represent different intents (mysql, postgres, redis, mongodb
    each have their own "user 999"). Rely on the image's entrypoint
    to fix data-dir permissions on first start; install.sh only
    `mkdir -p` + SELinux label, no `chown`. spec.md will table the
    image → uid:gid → entrypoint-fixup behaviour per engine.
  - Sub-question (bind vs named volume) resolved → bind. Sub-sub
    (one-instance-per-engine vs multi)? Multi: `<instance>` is the
    user-chosen name, default `default`.

## Q3 — Credential surfacing? → **Plaintext in connection card, always visible**

- **Confirmed:** 2026-05-19
- **Decision:** The DB instance connection card shows username +
  password in plain text, with Copy + Rotate buttons. No
  "reveal-once" flow, no masking, no per-secret encryption.
- **Why:**
  - DinoPanel runs as root and stores its sqlite on the same host.
    Encrypting the DB password at rest while leaving the same disk
    readable to the same root user moves complexity without moving
    the threat boundary.
  - Operator UX wins decisively: rotating creds in PMM, in app
    configs, in `mysql -u root -p` — all benefit from a card you
    can just look at.
  - Q4 follows directly: SecretsService isn't load-bearing for v0.4
    if no v0.4 surface stores encrypted data.
- **Implications:**
  - Strong defaults still generated on create (32-char random).
    Operator can edit via Rotate (regenerates + writes new env to
    the container + restart). **Rotate causes brief downtime** —
    Drawer surfaces a confirm dialog warning that live app
    connections will drop; no zero-downtime story in v0.4.
  - v0.4 schema migration **adds a new `db_instances` table** —
    none exists today (current schema stops at v0.5 firewall /
    scheduler tables). Password column is plain `TEXT NOT NULL`;
    migration carries the comment
    `-- TODO(v0.5): encrypt via SecretsService` so the future
    backfill pass has a grep target.
  - PMM integration (Q5) reads the same plaintext column when
    configuring its exporter — no decrypt step needed.

## Q4 — SecretsService design? → **Deferred to v0.5**

- **Confirmed:** 2026-05-19
- **Decision:** SecretsService removed from v0.4 scope. ACME
  account key (`acme_accounts.key_pem`) and Cloudflare API token
  (`settings['acme.cloudflare.api_token']`) remain plaintext for
  v0.4. v0.5 will land SecretsService alongside the audit-log
  integration so encrypted-secret access becomes auditable in one
  shot.
- **Why:**
  - Q3 removed the v0.4-specific driver for SecretsService (DB
    credentials). The only remaining customers are v0.3 ACME
    secrets, already shipping in production plaintext for a sprint.
  - Designing the encryption layer in isolation, without an
    audit-log consumer, risks landing a SecretsService that v0.5
    immediately needs to refactor to emit audit events.
  - Schema-wise: encryption is a backfill migration either way.
    Doing it in v0.5 once (instead of v0.4 schema + v0.5 audit
    refactor) is cheaper.
- **Implications:**
  - v0.3 carry-over list drops from five items to four — strike
    "SecretsService" from `meta.json.carryOverFromV03` and from the
    proposal's "Secondary" section.
  - v0.5 proposal must include SecretsService scope (was implicit
    in v0.4) — flag at v0.5 kickoff so it's not lost.
  - Acceptable risk: a stolen sqlite file leaks the ACME account
    key and CF token. CF token can be scoped to a single zone with
    DNS-edit-only permission, which limits blast radius. Document
    this in the v0.4 release notes.

## Q5 — PMM integration depth? → **Option C summary cards + keep link-card**

- **Confirmed:** 2026-05-19
- **Decision:** DB instance detail page surfaces PMM API summary
  cards (QPS / connections / replication-or-equivalent / uptime)
  AND keeps the v0.2.1 "Open in PMM" deep-link entry. DinoPanel
  positions itself as a PMM integrator, not a metrics
  reimplementer.
- **Why:**
  - PMM is already production-grade for the operator and — crucially —
    can monitor native (non-Docker) engine instances DinoPanel
    won't manage in v0.4. Integrating rather than replacing keeps
    DinoPanel's surface honest about what's actually serving the
    metrics.
  - Operator gets at-a-glance health inline (no context switch for
    the 80% case) while retaining the deep dive (PMM's own
    dashboards) for the 20%.
  - Avoids building a metrics-collection layer DinoPanel can't
    realistically maintain at PMM's depth.
- **Implications:**
  - Need a PMM API client module. Auth (PMM auth header / API key),
    base URL reuses the existing `monitoring.pmm_url` setting from
    v0.2.1, TLS verification flag (PMM self-signed is common).
  - **Stay inside the `monitoring.*` settings namespace** — v0.2.1
    already shipped `monitoring.pmm_url`
    (`apps/server/src/modules/monitoring/monitoring.service.ts:8`).
    v0.4 adds `monitoring.pmm_api_token` and
    `monitoring.pmm_tls_skip_verify`. Do NOT introduce a parallel
    `pmm.*` namespace — that would force a settings migration on
    every existing install for no UX gain.
  - **PMM's "API" is actually two surfaces**: (1) management
    endpoints under `/v1/` (PMM 2.x) or `/v1/management/` for
    inventory + service registration; (2) metrics live in the
    embedded Prometheus at `/prometheus/api/v1/query` and require
    PromQL. The "QPS / connections / replication lag" summary
    cards are case 2 — spec.md must enumerate the PromQL queries
    per engine (mysql_global_status_questions rate, etc.) so the
    implementation phase doesn't discover this late.
  - Graceful degrade is mandatory: if PMM API unreachable / not
    configured, the detail page falls back to link-only — never
    blocks the rest of the UI. Reuse v0.2.1's health-check probe
    pattern (`monitoring.service.ts:59-114`).
  - When DB instance created, optionally call PMM management API to
    register the instance for monitoring (saves manual "Add MySQL"
    step inside PMM). This is the "DinoPanel integrates PMM" UX
    win — flag as Phase 6 stretch goal, not critical path.
  - Estimate adjustment: +1 week on top of the original 3 — total
    ≈4 weeks for v0.4.
