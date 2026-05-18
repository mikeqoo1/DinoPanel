# Decisions — backlog-pmm-integration (Option A)

## 1. Ship A first, defer C to v0.4

**Decision:** Implement the link-card + health-ping flavour now;
hold off on the API-summary-cards version.

**Why:** A is cheap (~0.25d), gives the user a one-click route from
DinoPanel to their PMM, and establishes the sidebar entry. C is the
right end-state but only pays its full cost when there's a database
module right next to it — without v0.4 the cards have no
contextual home. Doing C now would mean either replicating PMM
charts in a vacuum or wiring a sidebar entry that says "monitoring"
with nothing useful inside it.

## 2. Trust the admin-configured PMM URL's self-signed cert

**Decision:** The backend `getPmmStatus()` fetch uses an HTTPS
agent with `rejectUnauthorized: false`. We do NOT require the user
to paste a certificate fingerprint.

**Why:** PMM ships with a self-signed cert by default. The URL is
set by the panel admin (i.e. someone who already has write access
to the panel's config), not by an untrusted user. The threat model
"attacker MitMs between DinoPanel and PMM on an internal network"
is dominated by "attacker already has admin access to the panel".

**Trade-off:** A more paranoid posture would store a pinned
fingerprint. We accept the simpler approach for v0.x and will
revisit if multi-tenant deployments materialize.

**Scope:** This relaxation applies ONLY to the monitoring module's
PMM fetch. Other outbound HTTPS calls (e.g. future ACME directory
requests) continue to verify certs.

## 3. No credentials stored

**Decision:** DinoPanel stores ONLY the PMM URL. Authentication
to PMM happens in PMM's own login form when the user clicks "Open
in PMM" in a new tab.

**Why:** Storing PMM admin credentials in DinoPanel's SQLite would
multiply the blast radius of a panel compromise: leak of the panel
DB would also leak PMM admin access. Keeping auth out-of-band
means PMM compromise still requires compromising PMM directly.

**Trade-off:** Less convenient than SSO. Acceptable for the
link-card flavour. If C lands later it will need an API token (NOT
admin password) stored encrypted at rest.

## 4. Reuse the existing `settings` key-value table

**Decision:** Store the PMM URL under key `'monitoring.pmm_url'`
in the existing `settings(key, value, updated_at)` table.

**Why (revised from initial plan):** The original spec had a new
`monitoring_config` table with a single-row CHECK constraint.
While auditing the schema for this change I noticed the existing
`settings` table was declared from day one but never actually
used by any module — it was reserved for exactly this kind of
panel-config-with-low-cardinality. Reusing it saves a migration,
keeps the surface area smaller, and matches the obvious intent
of the table that already exists.

If future configs grow complex enough to outgrow key-value (e.g.
multi-backend monitoring with per-backend secrets), we'll
introduce a dedicated table then.

## 5. 30-second status auto-refresh, not WebSocket

**Decision:** The frontend uses react-query with a 30 s
`refetchInterval`. No WS for this view.

**Why:** "Is PMM reachable?" doesn't need real-time. 30 s is good
enough; one WS connection per status-dot is overkill and would
expand the WS upgrade surface area. If PMM goes down the user
will see the red dot within at most 30 s of opening the page,
which is the longest tolerable lag for "is it up?".

**Trade-off:** A brief delay between PMM going down and the dot
turning red. Acceptable for this surface.
