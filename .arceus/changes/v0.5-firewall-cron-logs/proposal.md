# v0.5 — Firewall + Scheduled Tasks + Log Center

**Status:** draft
**Target:** v0.5 (≈ 3.5 weeks)
**Depends on:** v0.1 (system info, file ops), v0.2 (docker for some cron task types — optional)

## Context

After v0.4 (databases) lands, the panel has compute (containers),
storage (files), and data (databases). What's missing is **operational
posture**: who got in, what changed, what runs on a schedule, and what
ports are open.

These three modules ship as one slice because they share the same
underlying concerns:

- **Firewall** + **operation log** = security posture
- **Scheduled tasks** + **task log** = automation visibility
- **System logs** + **SSH logs** = forensic trail

Splitting them would mean three rounds of "introduce a feature, plus
the audit table it needs, plus the schedule it needs, plus the UI for
each". Bundling shares scheduler + audit log + log query
infrastructure across all three.

## Goals

### 1. Firewall (~1.5 week)

- Abstraction layer over `ufw` (Debian/Ubuntu) and `firewall-cmd`
  (RHEL/Rocky/CentOS). Detect at runtime; expose a uniform REST API.
- List current rules, enable / disable, add allow / deny rule with
  port + protocol + source IP.
- **Apply-with-rollback safeguard (critical, non-negotiable)**:
  1. User clicks "Apply".
  2. Backend stages the rule (writes to ufw/firewalld), but starts a
     60-second timer simultaneously.
  3. Frontend shows a modal "Rule applied. Confirm within 30 seconds
     to keep it." with a countdown.
  4. If the user confirms in time, commit (cancel timer).
  5. If the user does NOT confirm, the backend reverts the rule.
  6. This protects against the user creating a rule that locks
     themselves out — they cannot confirm if their connection is
     gone, so it auto-reverts.
- Self-protect: refuse to add rules that would block the panel's own
  port (default 9999) or SSH (22) without an explicit "I understand"
  checkbox.
- Fail2Ban integration: read `/var/log/fail2ban.log`, surface banned
  IPs, allow unban. (Optional — gated on Fail2Ban being installed.)

### 2. Scheduled tasks (~1 week)

- 1Panel has 12 task types. We ship **5**:
  - Shell command (run a script, any custom logic goes here)
  - Backup files (paths → archive → target dir)
  - Clean logs (rotate / truncate paths older than N days)
  - Restart service (systemctl restart `<unit>`)
  - HTTP request (GET/POST a URL, optional with headers — useful for
    hitting webhook health pings)
- Trigger: cron expression (with a "build expression" helper UI for
  the common cases: every N min/hour/day, daily at HH:MM).
- In-process scheduler — same pattern recommended for v0.3's ACME
  renewal. Folds with v0.3 if both ship.
- Each run logged into the task log table (which is the "task" view
  in §3).
- On-demand "Run now" button per task.

### 3. Log Center (~1 week)

- Five log sources, each is a filtered view over a row table or a
  tail of files:
  - **System log** — `journalctl -k` and `/var/log/syslog`
    (tail with cursor pagination + grep filter, like the existing
    container log viewer)
  - **SSH log** — parse `/var/log/auth.log` (or `journalctl -u
    sshd`), list login attempts (success / fail / IP)
  - **Operation log** — DinoPanel's own audit log. Every mutating
    REST endpoint writes a row: `{ user, ts, path, body_summary,
    status }`. Stored in SQLite. This is also a security feature
    (post-incident forensics) we ought to have anyway.
  - **Login log** — DinoPanel's own login attempts (already
    captured by the auth module; just surface here).
  - **Task log** — the per-run table from §2.
- **NOT shipped in v0.5**: website log subview (nginx access /
  error). Depends on v0.3 sites module being done. Page reserves the
  tab slot but renders "available after v0.3" placeholder.

## Non-goals (deferred or rejected)

- **iptables direct manipulation** — too easy to break, no rollback
  story comparable to ufw/firewalld. Use the distro's high-level
  tool only.
- **Custom log parser DSL** — log views are tail+grep, not full text
  search. ELK / Loki integration is out of scope; if the user wants
  that they can ship logs to PMM's adjacent stack.
- **Scheduled task types tied to features we don't have**: app
  restart (no App Store), snapshot (no Snapshot module), database
  backup (deferred — v0.4 should expose its own backup mechanism
  inside the DB module).
- Multi-host firewall sync (Pro tier in 1Panel; we don't do
  multi-node).

## Resolved decisions (2026-05-18)

1. **Audit log retention** — 30 days, **single `operation_log`
   table** with index on `created_at`, pruned by a daily DELETE job
   scheduled in v0.5's own scheduler (dogfood). Daily-partition
   variant rejected: table swapping plus UNION-ALL reads add
   complexity SQLite doesn't reward. Retention day count is
   exposed in settings.
2. **Cron expression UX** — **builder by default, freeform behind
   an "Advanced" toggle**. Builder covers the common cases (every N
   min/hour/day, daily HH:MM, weekly, monthly day-of-month) and
   emits the cron string live; toggling Advanced reveals the raw
   string for editing. Builder-only and freeform-only options
   rejected — first caps expressiveness, second raises the learning
   curve.
3. **Logs menu placement** — **nested under "系統 / System"** as
   subtabs, not a new top-level entry. By symmetry, **scheduled
   tasks also go under "系統"**, so the System area becomes the
   panel's operational-posture container (overview / firewall /
   scheduled tasks / logs). The internal structure of that
   container (tab strip vs. sub-sidebar) is a spec-phase decision.
4. **Firewall rule storage** — **metadata-only SQLite mirror**.
   `firewall_rule_meta { id, port, proto, source, comment,
   created_by, created_at }`. The list view reads ufw/firewalld
   output and LEFT JOINs metadata on `(port, proto, source)`; rules
   added outside DinoPanel render with NULL metadata and an
   "external" badge. Kernel remains source of truth — no
   reapply-on-boot, no drift risk. Full-mirror variant rejected
   because sysadmins editing ufw directly would silently lose
   their changes.

## Rough sizing

| Module | Estimate |
|---|---|
| Firewall (incl. 60s rollback safeguard) | 1.5w |
| Scheduled tasks (5 types + scheduler + run log) | 1w |
| Log Center (5 sources, no website subview) | 1w |
| Total | **~3.5w** |

The 60s rollback safeguard is half a week of the firewall budget —
worth every minute because without it the firewall module is a
liability rather than a feature.
