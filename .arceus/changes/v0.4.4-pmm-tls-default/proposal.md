# v0.4.4 — Align PMM clients with v0.2.1 monitoring TLS posture

**Status:** completed (2026-05-21)
**Target:** v0.4.4
**Depends on:** v0.4.3-pmm-inventory-readonly
**Origin:** Rocky 234 deploy of v0.4.3 — operator-visible TLS behaviour split

## What broke on Rocky 234

After deploying v0.4.3 to `https://192.168.199.234:9999`:

- `/monitoring` page rendered "PMM 連線正常, URL https://192.168.199.234:18443,
  latency 10 ms" — the v0.2.1 health-ping is happy.
- `/databases` page → external PMM section showed the amber error
  banner "PMM 無法連線，請確認 URL 及網路狀態。"
  (`error.reason='unreachable'`).
- Drawer PMM summary cards also broken (silently — same PromQL
  client, same root cause).

Operator's reasonable question: "Is this PMM monitoring under
databases not yet done?" — but the feature IS shipped in v0.4.3.

## Root cause

The v0.2.1 `MonitoringService.probe()` **hardcodes**
`rejectUnauthorized: false`. The decision is documented in
`apps/server/src/modules/monitoring/monitoring.service.ts:69-74`:

> HTTPS certs are NOT verified — see decisions.md §2: the URL is
> set by a panel admin (privileged actor), PMM ships with
> self-signed certs, and a stricter posture would require either
> pinned fingerprints or upstream Let's Encrypt issuance, neither
> of which fits the link-card scope.

But the v0.4 PMM clients (`PmmPromqlClient`, then `PmmInventoryClient`
in v0.4.3) honor a separate `monitoring.pmm_tls_skip_verify` setting
that **defaults to `false`** (env var default `'false'`).

So: same PMM URL, same operator, same self-signed cert →
`/monitoring` works (always-skip), `/databases` fails (verify-on by
default). Two clients, two different postures, one operator
mental model.

## Fix

- `env.schema.ts`: flip default `'false'` → `'true'` for
  `MONITORING_PMM_TLS_SKIP_VERIFY`.
- `pmm-promql.client.ts` `resolveConfig()`: rewrite the OR
  expression as a settings-then-env cascade so a setting
  explicitly set to `'false'` still wins over the new default
  (the OR pattern collapses both inputs into a single boolean
  and would silently lose the explicit "no, please verify" intent
  once the default flips).

After this change, the v0.4 PMM clients match the v0.2.1
monitoring probe by default. Operators with a properly issued
cert can flip back via:

- Setting key: `monitoring.pmm_tls_skip_verify=false` (per-instance)
- Env var: `MONITORING_PMM_TLS_SKIP_VERIFY=false` (per-deployment)

## What v0.4.4 is, what v0.4.4 isn't

**Is:** a two-line semantic alignment fix (env default + a
cascade rewrite). Existing setting key + env override remain
operator-tunable. No UI change. No new failure modes.

**Isn't:** a security regression. The v0.2.1 framing already
established that PMM clients are admin-configured and operate
against self-signed certs as the norm. The verify-on default
that v0.4 introduced was inconsistent with that framing, not a
deliberate hardening.

## Verification

- typecheck pass, lint pass, test pass (276/276 — existing tests
  pass `tlsSkipVerify` explicitly so the default flip doesn't
  affect them), build pass.
- Post-deploy on Rocky 234: external PMM section should populate
  (or show empty/auth banner — the auth banner is the next likely
  failure mode if `monitoring.pmm_api_token` isn't set and PMM
  requires one for `/v1/inventory/Services/List`).

## Follow-up if "auth" banner shows next

If the external panel switches from "unreachable" to "PMM API
驗證失敗，請於設定頁確認 token" after this fix, that's PMM's
Inventory API requiring a bearer token. Operator action:

1. Generate a PMM service account token in PMM Admin → Service Accounts
2. Set it via panel `/settings` (`monitoring.pmm_api_token` key,
   or whichever UI path exposes it) OR
3. Set `MONITORING_PMM_API_TOKEN=<token>` in `.env` + restart
   the systemd service.

That's not a v0.4.4 code change — just the operator-side config
the v0.4 docs already mention.
