# Backlog — Files: compress / extract UI

**Status:** draft (backlog)
**Target:** any version, no urgency

## Context

The backend already exposes `POST /api/files/compress` and the
download endpoint streams archives — but the frontend `routes/files.tsx`
never wires those operations to UI controls. The asymmetry has been
in the technical-debt list since v0.1.

## Scope

- Selection model in the file table (multi-select with checkboxes
  or shift-click).
- "Compress selected" button → dialog: format (zip / tar.gz / tgz /
  tar) + destination filename → call `POST /api/files/compress`.
- "Extract" action on archive rows → dialog: destination dir → call
  the corresponding backend endpoint (verify it exists).
- Loading / progress UI for both — compression of large directories
  can take many seconds.
- i18n for the new strings (en + zh-TW).

## Size

Half a day of focused work. Done when the right-click menu and the
toolbar both expose the operations and they round-trip a real
archive end-to-end.

## Why deferred

Not blocking anything; the v0.1.1 tech-debt push had to draw a line
somewhere and the UI gap was below it. Pick this up between bigger
versions or as a warm-up task.
