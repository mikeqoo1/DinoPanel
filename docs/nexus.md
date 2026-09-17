# Nexus Traffic (v0.6.9)

Read-only traffic monitoring for [Sonatype Nexus Repository](https://www.sonatype.com/)
instances. The panel scrapes each instance's Prometheus endpoint every 60 seconds, stores
the cumulative counters, and charts per-second rates derived from consecutive samples.

Nothing is ever written to Nexus: the module only issues `GET` requests to two endpoints.

## Adding an instance

**Nexus → Settings → Security → Users** — any account with the `nexus:metrics:read`
privilege works (`admin` has it). Then in the panel: **Nexus → 新增實例 / Add instance**.

| Field | Example | Notes |
|---|---|---|
| Name | `ConeX-dev1` | display only |
| URL | `http://192.168.198.121:18081` | scheme + host + optional port, **no path** |
| Username / Password | `admin` / … | needs `nexus:metrics:read` |

The password is encrypted with AES-256-GCM (key derived from `JWT_SECRET` via HKDF, see
`common/secrets/secrets.ts`) and stored in the `nexus.list` settings row. `GET /nexus`
returns only `hasPassword`. Rotating `JWT_SECRET` makes stored passwords undecryptable
(`NEXUS_PASSWORD_UNREADABLE`): remove and re-add the instance. There is no edit endpoint —
to change credentials, remove and re-add.

## What is collected

`GET /service/rest/metrics/prometheus` (authenticated), of which the module keeps:

| Counter | Charted as |
|---|---|
| `org_eclipse_jetty_ee10_webapp_WebAppContext_requests_count` | requests/s |
| `..._4xx_responses_total` + `..._5xx_responses_total` | errors/s |
| `bytes_downloaded_by_format_<format>` (summed) | download B/s |
| `bytes_uploaded_by_format_<format>` (summed) | upload B/s |
| `..._2xx_/3xx_responses_total` | stored, shown in totals |

Per-format byte counters are also kept verbatim (only formats with traffic) and shown as
badges under the charts, so an npm-only instance says so.

`GET /service/rest/v1/repositories` is **anonymous** on a default Nexus and provides the
repository table (name / format / type / size).

## Community-edition usage quota

Sonatype's community edition enforces a quota and returns
`403 PAYMENT REQUIRED: At current usage levels…` on writes once you are over it — which
shows up as a failed `docker push` or npm publish in CI, not as anything wrong with the
client. The panel reads the counter Nexus judges you by from
`GET /service/rest/internal/ui/usage-metrics` (authenticated, internal UI endpoint):

| Field | Shown as |
|---|---|
| `requests_per_last_24h` | Requests (24 h), with a bar against the configured limit |
| `component_total_count` | Components, with a bar against the configured limit |
| `unique_users_last_30d` | Unique users (30 d) |
| `request_rates.peak_requests_per_day_30d` | Peak per day (30 d) |
| `request_rates.peak_requests_per_minute_1d` | Peak per minute (24 h) |

**The limits themselves are not exposed by any Nexus API.** `usage-metrics`,
`status-check`, `monthly-metrics`, `system/license` and the UI bundle were all checked —
the bundle carries only `SOFT_THRESHOLD` / `HARD_THRESHOLD` strings and a 75 % warning
ratio, no numbers. So the panel stores the limit as per-instance configuration:
`PATCH /nexus/:id/limits`, or the **Set limits** button on the card. Defaults are the
documented CE figures (200,000 requests/day, 100,000 components); use whatever your Nexus
Usage Center shows. The bar turns amber at 75 % (matching Nexus's own ratio) and red at
100 %.

Two things worth knowing about the counter:

- `requests_per_last_24h` is a **rolling 24-hour window**, not a midnight reset, so it
  falls back below the limit on its own as old requests age out.
- It moves on **Nexus's aggregation schedule, not in real time** — it was observed
  unchanged for over 15 minutes while the panel polled every 60 s. The quota chart is
  therefore a step function, which is the data being coarse, not the panel being stuck.

An account that cannot read the internal endpoint simply gets no usage section; the
traffic charts are unaffected (the sample is still written, with the usage columns null).

## Rates, buckets and restarts

Counters are cumulative, so a bucket's rate is exactly `(last - first) / seconds` over the
samples inside it — no averaging or interpolation. Bucket width follows the range so a
chart gets 60–168 points:

| Range | Bucket | Points |
|---|---|---|
| `1h` | 1 min | ~60 |
| `24h` | 10 min | ~144 |
| `7d` | 1 hour | ~168 |

If a counter goes backwards (Nexus restarted) the affected bucket is dropped rather than
charted as a negative spike. Samples older than 7 days are pruned after each poll.

## REST API

All endpoints are under `/api` and require a valid JWT.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/nexus` | instances (`hasPassword`, never the password) |
| `POST` | `/nexus` | `{ name, url, username, password }`; `409 NEXUS_DUPLICATE` on a repeated URL |
| `DELETE` | `/nexus/:id` | also deletes that instance's samples |
| `POST` | `/nexus/:id/test` | live scrape; doubles as the credential check |
| `GET` | `/nexus/:id/series?range=1h\|24h\|7d` | `{ range, points[], latest, latestTs }` |
| `GET` | `/nexus/:id/repositories` | anonymous endpoint, works without metrics rights |
| `PATCH` | `/nexus/:id/limits` | `{ requestsPerDayLimit, componentsLimit }` — panel-side quota config, no credential change |

Error codes: `NEXUS_AUTH_FAILED` (401/403 from Nexus — missing `nexus:metrics:read`),
`NEXUS_UNREACHABLE` (transport failure or 10 s timeout), `NEXUS_COMMAND_FAILED` (other
non-2xx or a malformed body), `NEXUS_PASSWORD_UNREADABLE`, `NEXUS_DUPLICATE`,
`NEXUS_NOT_FOUND`.

## Storage

- Config: `settings` row `nexus.list` (no migration).
- Samples: `nexus_samples` table (migrations `0006_grey_dracula.sql`, plus
  `0007_silent_bruce_banner.sql` for the five nullable usage columns), indexed on
  `(instance_id, ts)`. ~1440 rows per instance per day, pruned at 7 days.

## Troubleshooting

**Card says "尚未取樣 / No samples yet"** — the poller runs every 60 s and needs two
samples before it can draw a rate; wait ~2 minutes. If it persists, press 測試 / Test: it
performs a live scrape and reports the real error.

**Card says "取樣落後 / Samples stale"** — the newest sample is over 3 minutes old, so the
poller is failing. Check the panel log for `nexus.scrape_failed`, which records the error
code but never the credentials.

**Charts are flat at zero** — that is real: `bytes_downloaded_by_format_*` only moves when
someone actually pulls an artifact.

**The quota bar says over 100 % and CI cannot push** — that is the community-edition limit,
not a panel error. The 24-hour counter is rolling, so it drops on its own; watch the quota
chart to see when it passes back under. Confirm the real limit in Nexus's Usage Center and
correct it with **Set limits** if the panel's default does not match.
