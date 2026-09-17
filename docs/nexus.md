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

Error codes: `NEXUS_AUTH_FAILED` (401/403 from Nexus — missing `nexus:metrics:read`),
`NEXUS_UNREACHABLE` (transport failure or 10 s timeout), `NEXUS_COMMAND_FAILED` (other
non-2xx or a malformed body), `NEXUS_PASSWORD_UNREADABLE`, `NEXUS_DUPLICATE`,
`NEXUS_NOT_FOUND`.

## Storage

- Config: `settings` row `nexus.list` (no migration).
- Samples: `nexus_samples` table (migration `0006_grey_dracula.sql`), indexed on
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
