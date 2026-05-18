# Firewall

Abstraction over the host's firewall daemon, added in v0.5. Sits
behind `/api/firewall/*` and detects ufw vs firewall-cmd at module
init. Frontend lives at `/system/firewall`.

## Backend detection

`FirewallModule` runs `which ufw` and `which firewall-cmd` at boot:

- `ufw` present → `UfwDriver`
- else `firewall-cmd` present → `FirewalldDriver`
- else `UnavailableFirewallDriver` (every mutating endpoint returns
  503 `FIREWALL_NOT_CONFIGURED`)

The fallback driver is a deliberate deviation from the original
spec (which said "throws on neither"). It matches the dockerode
"lazy fail" pattern used by `ContainersModule` so the panel stays
bootable on dev machines without a firewall installed.

## Driver responsibilities

`FirewallDriver` interface (`firewall-driver.ts`):

```ts
interface FirewallDriver {
  backend: 'ufw' | 'firewalld';
  getStatus(): Promise<{ enabled: boolean }>;
  enable(): Promise<void>;
  disable(): Promise<void>;
  listRules(): Promise<RawRule[]>;
  addRule(rule: RawRule): Promise<void>;
  removeRule(rule: RawRule): Promise<void>;
}
```

`UfwDriver` parses `ufw status numbered` and skips IPv6 `(v6)`
duplicate rows + port-ranges (`RawRule.port` is a single integer).
Port-ranges added externally are therefore invisible to the panel —
a known v0.5 limitation.

`FirewalldDriver` parses both the `ports:` line and `rich rules:`
block from `firewall-cmd --list-all --permanent`. `enable` / `disable`
delegate to `systemctl start|stop firewalld` because firewall-cmd
itself has no equivalent.

## 30-second rollback safeguard

The flagship feature: any rule the user adds is **staged** for 30
seconds before being permanently kept. This protects against
self-lockout (a deny rule on SSH/the panel port).

### Confirm endpoint flow (crash-safe)

```
POST /api/firewall/rules/stage  →  inserts firewall_rule_meta row with staged_at=now
                                    runs driver.addRule
                                    schedules setTimeout(autoRevert, 30s)
                                    returns { stagedId, expiresAt }

POST /api/firewall/rules/:id/confirm  →  ① writes confirming_at=now (synchronous)
                                          ② clears in-memory timer
                                          ③ writes confirmed_at=now
                                          ④ returns 200 { ok: true }

POST /api/firewall/rules/:id/cancel   →  driver.removeRule + DELETE meta row
```

The three-step confirm flow exists because step ② would otherwise
race with a server crash: if the process dies between "user clicked
Confirm" and "row marked confirmed", the boot recovery sweep would
incorrectly revert the rule. Writing `confirming_at` first creates a
distinguishable state for the sweep to preserve.

### Boot recovery sweep

`OnApplicationBootstrap` runs `recoverySweep()`:

| Row state | Action |
|---|---|
| `confirmed_at IS NULL AND confirming_at IS NULL AND staged_at < now-60s` | Revert via driver + DELETE row (the user never confirmed in time) |
| `confirming_at IS NOT NULL AND confirmed_at IS NULL` | Promote: `confirmed_at = confirming_at` (the user *did* confirm; we crashed before recording it) |
| All other states | Leave alone |

The 60-second cutoff is `STAGE_CONFIRM_MS + 30 s grace` so brief
restarts don't snipe rules whose timers were still legitimately
active.

## Self-protect

`POST /api/firewall/rules/stage` refuses `deny` rules on these
ports unless the body carries `acknowledgeSelfLockout: true`:

- `app.env.PORT` — the panel's bind port (default 9999)
- `app.env.SSH_PORT` — SSH (default 22)

Responds 400 `FIREWALL_SELF_LOCKOUT`. The frontend Add Rule dialog
surfaces a checkbox + warning banner only when the port matches; the
submit button stays disabled until the checkbox is ticked.

## Metadata model

`firewall_rule_meta` stores comment, creator, timestamps; the
**kernel is the source of truth** for rules. `GET /api/firewall/rules`
reads the kernel via `driver.listRules()` and LEFT JOINs metadata
by `(port, proto, source, action)`. Rules added outside the panel
(e.g. via `ufw allow ...` directly) appear with `external: true`
and a badge in the UI; they have no metadata to display.

## Fail2Ban

Probed at boot via `fail2ban-client ping`. Status response carries
`fail2ban: boolean` so the UI can hide the section. When absent,
`GET /api/firewall/fail2ban/banned` and `POST /api/firewall/fail2ban/unban`
return 400 `FAIL2BAN_NOT_AVAILABLE`.

When present, banned IPs are aggregated across all jails returned
by `fail2ban-client status`. Unban is a per-(jail, ip) operation:

```
POST /api/firewall/fail2ban/unban  { ip, jail }
```

## REST contract summary

| Method | Path |
|---|---|
| `GET`  | `/api/firewall/status` → `{ backend, enabled, fail2ban }` |
| `POST` | `/api/firewall/enable` |
| `POST` | `/api/firewall/disable` |
| `GET`  | `/api/firewall/rules` |
| `POST` | `/api/firewall/rules/stage` |
| `POST` | `/api/firewall/rules/:id/confirm` |
| `POST` | `/api/firewall/rules/:id/cancel` |
| `DELETE` | `/api/firewall/rules/:id` |
| `GET`  | `/api/firewall/fail2ban/banned` |
| `POST` | `/api/firewall/fail2ban/unban` |

## Permissions

`ufw` and `firewalld` both require root (or sudo) to mutate state.
Running the panel as a non-root user means rules will fail with
`FIREWALL_PERMISSION_DENIED`. The intended deployment is via
systemd as root; see `docs/deployment.md`.
