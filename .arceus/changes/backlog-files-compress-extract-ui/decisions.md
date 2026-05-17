# Decisions — backlog-files-compress-extract-ui

## 1. The original proposal misread backend state

The proposal claimed "backend endpoints already exist" — this is
**wrong**. What exists:

- `POST /api/files/archive-download` — streams a freshly-built
  archive *back to the browser* (no on-disk artifact).
- `compressSchema` and `extractSchema` are exported from
  `@dinopanel/shared`, but no controller / service method binds to
  either schema for a write-to-disk compress or for extract.

This change therefore adds two new endpoints + two new
`FilesService` methods + dependencies. The estimate was bumped from
the README's stated 0.5d to the realistic ~0.7–1d.

## 2. Library choice — `tar` + `unzipper`, not `decompress`

**Decision:** Use the `tar` package for `.tar` / `.tar.gz` / `.tgz`,
and `unzipper` for `.zip`. Two narrow deps instead of one
multi-format wrapper.

**Why:**
- `decompress` (multi-format wrapper) is unmaintained and pulls in
  many transitive deps for formats we don't need (7z, bz2, etc.).
- `tar` is maintained by the npm authors, extremely battle-tested,
  has `strict: true` to reject suspicious entries by default, and
  handles gzip natively.
- `unzipper` is pure JS, small surface, but **does not prevent
  zip slip by default** — we add an explicit guard at the entry
  iteration layer.

## 3. Zip-slip mitigation is explicit and pre-write

**Decision:** For `.zip` archives, iterate entries via
`unzipper.Parse()`, compute `resolve(destPath, entry.path)`, and
reject the whole extraction if any entry's resolved path does not
either equal `destPath` or start with `destPath + path.sep`. The
rejection happens before any file is written, so a malicious
archive cannot partially extract.

**Why:** Letting an attacker write `../../etc/cron.daily/payload`
via a hand-crafted zip is a classic privilege escalation
when DinoPanel runs as root. `tar`'s `strict: true` already
handles this for tar archives, so we only need the manual guard
for zip.

**Trade-off:** Two streaming passes would be safer (validate every
entry first, then extract). We accept the single-pass with
"reject before any write commits to that entry" because we await
each `pipeline(entry, sink)` sequentially, so the early-reject
keyword stops the loop before subsequent entries land.

## 4. UI: multi-select via checkbox column, not shift-click

**Decision:** Add a checkbox column. No shift-click range selection
in this pass.

**Why:** Checkbox is more discoverable, works on mobile, and is the
cheapest implementation. Shift-click can land later if asked. The
proposal listed both as alternatives — picking the simpler one.

## 5. Compress UI lives in the toolbar; Extract in the row action menu

**Decision:** Compress is a toolbar action (operates on N selected
rows). Extract is a per-row action (operates on the row's own
archive). Symmetric semantics to the existing "selected vs row"
split in the page.

**Why:** Matches user mental model — you select multiple files to
compress them into one archive; you click on a specific archive
to extract it. Showing Extract as a toolbar button would require
deciding "extract which selected archive?" with multiple selected.

## 6. No e2e tests for this change

**Decision:** Backend unit tests (4) + manual smoke. Skip
Playwright additions.

**Why:** The UI surface is large but mechanical (checkbox state,
two dialogs); the security-critical logic is on the backend and
testable in isolation. Adding e2e would require fixture files and
significantly slow the CI pipeline for low marginal coverage.
Consistent with the v0.2.1 / discovered-stack-readonly decisions.

## 7. Returning 204 vs 200 from compress/extract

**Decision:** Both endpoints return `204 No Content` on success.

**Why:** Consistent with the existing write-oriented file
endpoints (`/write`, `/mkdir`, `/rename`, `/copy`, `DELETE`,
`/chmod`, `/chown`), all of which already return 204. The frontend
refreshes the file list on success rather than relying on a body.
