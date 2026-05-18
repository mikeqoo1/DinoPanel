# backlog-pmm-integration

## Context

User runs an existing **PMM (Percona Monitoring and Management)**
instance on their internal network on a custom HTTPS port. PMM is
Percona's open-source MySQL / PostgreSQL / MongoDB / ProxySQL
observability suite, built on Grafana + Prometheus + Percona
exporters. The dashboards already exist and work — DinoPanel does
not need to re-implement charts.

The integration question is therefore *not* "how do we monitor
databases?" but "how deeply does DinoPanel surface an existing
external monitoring service?" Answering that question early matters
because it shapes how the v0.4 database module relates to monitoring.

Security note: the user provided live admin credentials in chat.
**No credentials are stored anywhere in this repo or in claude's
memory.** When the integration lands, it must use a PMM API token /
service account, not the admin password. The proposal below assumes
that.

## Three integration options

### A. External link card (~0.25d)

DinoPanel sidebar adds a "資料庫監控 / Database Monitoring" entry.
The page is a single card showing:

- The configured PMM URL.
- A health indicator (last successful `GET /v1/readyz` against PMM).
- A button that opens PMM in a new browser tab.

Settings page gains a PMM URL field. No credentials handled —
authentication happens in PMM's own login form when the new tab
opens. If the user has a session cookie they jump straight in.

| Pro | Con |
|---|---|
| Ships in a quarter day, zero new failure modes | Glorified bookmark — no real "integration" feel |
| No credential storage, no CORS, no self-signed-cert headaches | The user still has two systems to switch between |
| Establishes the menu entry; future C upgrades drop in | n/a |

### B. iframe embed with shared / SSO auth (~1d)

The sidebar "Database Monitoring" entry renders PMM inside an
iframe. To make this usable:

1. PMM's bundled Grafana needs `allow_embedding = true`
   (`GF_SECURITY_ALLOW_EMBEDDING=true` env on the PMM container).
2. Either:
   - DinoPanel reverse-proxies PMM under its own origin so cookies
     are shared (DinoPanel backend has to handle the self-signed
     cert PMM ships with), or
   - The user logs into PMM once in another tab and the embed
     piggybacks on that session.
3. Self-signed cert: DinoPanel's reverse-proxy must explicitly
   allow the PMM cert fingerprint, or the user pre-imports it.

| Pro | Con |
|---|---|
| Looks like a unified product | Auth seam is awkward (proxy-with-self-signed, or double login) |
| No PMM API work | iframe sizing / theming clash with DinoPanel UI |
| Done quickly if PMM allows embedding | Mid-step: most teams that ship B end up wanting to upgrade to C anyway |

### C. API summary cards + deep links (~2–3d)

DinoPanel backend talks to PMM's HTTP API
(`/v1/inventory/Services` to enumerate monitored instances,
`/graph/api/datasources/proxy/<id>/api/v1/query` for ad-hoc PromQL,
PMM's `/v0/qan/*` for query analytics) and renders a small set of
**native DinoPanel cards** per DB instance:

- QPS / connection count / disk IO
- Top 5 slowest queries (last 1h)
- Replica lag (if applicable)
- "Open full chart in PMM" deep link per card

| Pro | Con |
|---|---|
| Real integration — looks like DinoPanel owns the experience | More code: API client, token auth, error mapping, cert trust |
| Sets up v0.4 nicely: the per-database page just inlines the right card | Adds a credential storage requirement (PMM API token in SQLite) |
| Allows alert-style summaries on the dashboard | We re-skin a few charts PMM already does well — partial overlap |

## Recommendation

**Ship A first; defer C to v0.4 when the database module lands.**

Reasoning:

- A is cheap insurance: the menu entry exists, the user gets one
  click to monitoring, future work upgrades the page contents
  without renaming or moving anything.
- B is the worst of the three because it produces an outcome (an
  embedded panel) that most teams end up replacing with C anyway —
  it's a half-step that pays its full cost.
- C is the right end-state, but it pays best when there's a
  database module to live next to. Standalone C would render charts
  with no obvious home; alongside v0.4 it makes the per-instance
  page complete in one screen.

If the user later disagrees and wants C standalone, it's a clean
upgrade from A — same menu entry, same settings field, just the
page guts get re-implemented.

## Scope if we ship A

- New sidebar entry "資料庫監控 / Database Monitoring".
- New page at `/monitoring` (or `/database-monitoring`).
- Settings: PMM URL field (validated as an HTTPS URL), stored in
  the existing settings table or a new `external_monitoring`
  table — tiny.
- Backend health endpoint: `GET /api/monitoring/pmm/status`
  performs `fetch('<url>/v1/readyz', { agent: <ignore-self-signed> })`
  and returns `{ ok: boolean, latencyMs: number, lastChecked: ISO }`.
- Frontend: card with status dot + URL + "Open PMM" button.
- i18n keys zh-TW + en for the page + settings entry.

## Out of scope (for the A version)

- Any credential storage. The user authenticates against PMM in
  the new tab themselves.
- Any PMM API consumption beyond `/v1/readyz`.
- Iframe embedding.
- Multi-instance support — one configured PMM at a time.

## Open questions (before activating)

1. Where does the entry live in the sidebar? Top-level
   "資料庫監控", or nested under a future "監控" section that
   anticipates non-DB monitoring?
2. How does the health check handle PMM's self-signed cert? Two
   options: (a) DinoPanel skips cert verification for this single
   target (small attack surface — the URL is admin-configured),
   (b) require the user to paste the cert fingerprint into the
   settings.
3. If the user later upgrades to C, do we keep this A page as a
   "configure" sub-page, or rip-and-replace?
