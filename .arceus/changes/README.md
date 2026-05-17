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
| `backlog-files-compress-extract-ui` | completed | any | Files: new compress-to-disk + extract endpoints + multi-select UI (zip-slip guarded) |
| `backlog-compose-discovered-stack-readonly` | completed | any | Compose detail: read-only handling for discovered stacks (409 COMPOSE_FILE_UNAVAILABLE + banner) |

## Backlog notes

- v0.3 has five open questions (see its proposal.md / meta.json). Resolve
  them per-item in `decisions.md` before flipping status to `active`.
- The Files compress/extract scope was bigger than the original draft
  implied — the README's "backend already exists" claim was wrong, only
  the streaming archive-download did. The completed change adds two new
  endpoints + UI. See its `decisions.md` §1.

## Next session — pick up here

Last working session ended 2026-05-17 with three patches landed in a
row: v0.2.1 visual smoke closed, discovered-stack read-only handling,
and Files compress / extract (backend endpoints + multi-select UI +
zip-slip guard, 90/90 tests). Clean tree. Single pickup option:

1. **Activate v0.3-websites-acme** *(major)* — see
   `v0.3-websites-acme/`. First action is the per-item discussion
   over the five open questions (nginx-where, config-storage, ACME
   library, site-dir layout, TLS-renewal cadence). Same gating
   dance v0.2 went through. After all five answers are appended to
   its `decisions.md`, flip `meta.json.status` to `active` and
   start Phase 1.

(The two small backlog drafts are both done; only v0.3 remains.)
