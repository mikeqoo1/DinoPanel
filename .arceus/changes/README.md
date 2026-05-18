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
| `backlog-pmm-integration`       | draft       | any → v0.4 | Integrate with user's existing PMM (Percona Monitoring) instance. Three options A/B/C; claude recommends A (link card) now, upgrade to C alongside v0.4 databases |

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

Last working session ended 2026-05-18 with the v0.3 discussion
paused after Q1–Q4 were drafted but never answered, and a new PMM
integration backlog opened as the detour reason. Clean tree.

Three live options, easiest first:

1. **Ship `backlog-pmm-integration` option A** *(~0.25d)* — link
   card + health ping. Get the sidebar entry on the menu, give the
   user a one-click into PMM. Zero new failure modes.

2. **Resume v0.3 discussion** — re-ask Q1 alone (nginx in Docker
   vs host systemd) with claude's lean framed as a recommendation
   the user can accept or reject. Write the answer to a new
   `decisions.md` immediately. Iterate per-question. After all
   five are confirmed, flip status to `active`.

3. **Skip ahead** to v0.4 databases planning if the user decides
   they want monitoring + DB management as one combined slice
   rather than v0.3 sites first. Would require a new
   `v0.4-databases` draft folder and a fresh question round.

If the user has not signalled, default to (1) — it's the smallest
visible win and keeps options (2) and (3) open.
