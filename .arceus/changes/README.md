# Arceus Change Proposals

This directory tracks structured change proposals for DinoPanel — both
completed work (as historical record) and draft work (as a plan to be
implemented). Each change lives in its own folder containing:

| File            | Purpose                                                  |
| --------------- | -------------------------------------------------------- |
| `proposal.md`   | Context, motivation, why this change exists              |
| `spec.md`       | Acceptance criteria — what "done" looks like             |
| `tasks.md`      | Concrete checklist used during implementation            |
| `decisions.md`  | Technical decisions and trade-offs worth remembering     |
| `meta.json`     | Status, dates, related commits, version target           |

Status values in `meta.json`:

- `draft` — being discussed, not yet approved
- `active` — approved, implementation in progress
- `completed` — implementation merged, history preserved
- `archived` — superseded or abandoned

## Current changes

| ID                              | Status      | Target  | Summary                                                          |
| ------------------------------- | ----------- | ------- | ---------------------------------------------------------------- |
| `v0.1.1-consolidation`          | completed   | v0.1.1  | Pre-v0.2 hardening: tests, bundle split, security, deploy        |
| `v0.1.2-production-posture`     | completed   | v0.1.2  | Root posture, system info endpoint, fs errno mapping             |
| `v0.2-docker-containers`        | completed   | v0.2    | Docker container management (dockerode + Compose, no App Store)  |
| `v0.2.1-compose-yaml-lint`      | completed   | v0.2.1  | Add `yaml` dep + live JS-side YAML lint in the Compose editor    |
| `v0.3-websites-acme`            | draft (paused) | v0.3 | Static / reverse proxy / PHP sites + ACME — 5-question discussion paused mid-stream 2026-05-18; claude's leans recorded in `discussion-state.md`, **none confirmed** |
| `backlog-files-compress-extract-ui` | completed | any | Files: new compress-to-disk + extract endpoints + multi-select UI (zip-slip guarded) |
| `backlog-compose-discovered-stack-readonly` | completed | any | Compose detail: read-only handling for discovered stacks (409 COMPOSE_FILE_UNAVAILABLE + banner) |
| `backlog-pmm-integration`       | completed (A) | any → v0.4 | Option A shipped 2026-05-18: link card + 30s health-ping. Option C (API summary cards) deferred to v0.4 |
| `v0.5-firewall-cron-logs`       | draft       | v0.5    | Firewall + Scheduled tasks + Log Center bundle (~3.5w). Key decision: firewall MUST implement 60s apply-with-rollback safeguard |

## Backlog notes

- **v0.3 is paused mid-discussion.** The 5 open questions were
  bundled into one `AskUserQuestion` call which the user
  interrupted. claude's lean per question is captured in
  `v0.3-websites-acme/discussion-state.md` — these are
  recommendations only, the user has not confirmed any of them.
  When resuming, re-ask Q1 alone and proceed per-question so a
  future interruption doesn't lose state again.
- **PMM integration backlog opened 2026-05-18.** User runs an
  existing PMM instance on internal network. claude recommends
  shipping option A (external link card + health ping, ~0.25d)
  immediately and saving option C (API summary cards) for when
  the v0.4 database module gives those cards a natural home.
- The Files compress/extract scope was bigger than the original
  draft implied — the README's "backend already exists" claim was
  wrong, only the streaming archive-download did. The completed
  change adds two new endpoints + UI. See its `decisions.md` §1.

## Next session — pick up here

Last working session ended 2026-05-18 with PMM A shipped (link
card + 30s health ping, live-smoked against the user's real PMM
instance) and `v0.5-firewall-cron-logs/` drafted with proposal +
meta (3.5w bundle, firewall 60s-rollback safeguard called out as
non-negotiable). v0.3-websites-acme still paused mid-discussion.

Recommended path going forward (user agreed 2026-05-18):
`PMM A done` → **v0.5** → v0.4 + PMM C → v0.3 → ~~multi-node~~.

Two live pickup options:

1. **Activate v0.5-firewall-cron-logs** *(major, ~3.5w)* — see
   `v0.5-firewall-cron-logs/`. Four open questions (audit log
   retention, cron UX, log menu placement, firewall rule
   storage). Resolve per-item into `decisions.md`, then write
   `spec.md` and `tasks.md`, then start Phase 1 (firewall with
   60s rollback first — the safety story has to land before the
   feature is useful).

2. **Resume v0.3 discussion** — only if priorities shift back to
   websites before v0.5. Re-ask Q1 alone, per-question, write
   `decisions.md` incrementally.

Multi-node management was discussed and explicitly **rejected** as
v0.x scope on 2026-05-18 (~8w+ work, security blast radius too
big, premature for current install base). Revisit post-v1.0 only.
