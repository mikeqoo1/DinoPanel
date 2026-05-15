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
| `v0.2-docker-containers`        | draft       | v0.2    | Docker container management (dockerode + Compose, no App Store)  |
