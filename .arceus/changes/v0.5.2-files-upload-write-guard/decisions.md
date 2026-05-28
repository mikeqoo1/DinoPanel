# Decisions — v0.5.2 files-upload write guard

## D1: Keep the deny-list approach (do not switch to allow-list)

`assertWritable()` already uses a deny-list of critical prefixes
(`/`, `/bin`, `/sbin`, `/usr`, `/etc`, `/root`, `/var`, `/proc`,
`/sys`, `/boot`, `/dev`). Switching to an allow-list (e.g. only
`/home`, `/opt/dinopanel/...`, `/var/log` allow-writes) would
break legitimate operator workflows (writing to arbitrary user
directories, `/srv`, `/data`, mounted volumes, etc.).

The deny-list is the established posture; this change extends it
to the one method that was missing it. A future change can revisit
the allow-list direction if a broader hardening pass is undertaken.

## D2: Reject before `fs.mkdir`, not after

The fix places `assertWritable()` between `resolvePath()` and
`fs.mkdir(dir, { recursive: true })`. The alternative — checking
after `mkdir` — would leave an empty directory behind when the
guard rejects. Reject early, leave no trace.

## D3: Do not also enumerate every other mutating method as a "regression"

`copyTo`, `rename`, `remove`, `write`, `mkdir`, `chmod`, `chown`
already call `assertWritable()` correctly (verified during this
fix). A defensive comment block above the `FilesService` class
documents the invariant so future contributors do not re-introduce
the gap. No code change for the other methods.

## D4: HTTP status code for forbidden upload — 403, not 400

`assertWritable` throws `ForbiddenException` (HTTP 403), not
`BadRequestException` (HTTP 400). The user *could* have written
to a non-system path; the request shape is valid — it is the
*resolved target* that is policy-forbidden. 403 communicates
"server understood, refuses to act" correctly.
