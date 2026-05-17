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
| `v0.3-websites-acme`            | draft       | v0.3    | Static / reverse proxy / PHP sites + ACME (HTTP-01 + Cloudflare) |
| `backlog-files-compress-extract-ui` | draft   | any     | Wire existing backend compress / extract to the Files frontend   |
| `backlog-compose-discovered-stack-readonly` | completed | any | Compose detail: read-only handling for discovered stacks (409 COMPOSE_FILE_UNAVAILABLE + banner) |

## Backlog notes

- v0.3 has five open questions (see its proposal.md / meta.json). Resolve
  them per-item in `decisions.md` before flipping status to `active`.
- The Files compress/extract entry is a backlog draft — small, low
  urgency, good as a warm-up between bigger versions.

## Next session — pick up here

Last working session ended 2026-05-17 with two patches landed: v0.2.1
manual smoke closed, and the discovered-stack read-only handling
implemented (backend 409 + frontend banner, 82/82 tests). Clean tree.
Two pickup options:

1. **Pick up `backlog-files-compress-extract-ui`** *(~0.5d)* — the
   remaining small backlog draft. Backend endpoints already exist;
   React UI never got wired. Good warm-up.

2. **Activate v0.3-websites-acme** *(major)* — see
   `v0.3-websites-acme/`. First action is the per-item discussion
   over the five open questions (nginx-where, config-storage, ACME
   library, site-dir layout, TLS-renewal cadence). Same gating
   dance v0.2 went through. After all five answers are appended to
   its `decisions.md`, flip `meta.json.status` to `active` and
   start Phase 1.

If you want a warm-up before v0.3, do (1); otherwise go straight to
(2) and run the five-question round.
