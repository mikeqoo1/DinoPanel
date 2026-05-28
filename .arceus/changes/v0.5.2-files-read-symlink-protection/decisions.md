# Decisions — v0.5.2 files read symlink protection

## D1: Use `fs.realpath` (full chain resolution), not `lstat` + manual walk

`fs.realpath()` follows the entire symlink chain in one call and
also handles `..` segments, returning the canonical path. A manual
walk via `lstat()` + iterative resolve is more complex, equally
costly, and offers no incremental safety. The only downside of
`realpath` is that it throws `ENOENT` for broken symlinks — we
catch that and surface it as a 404 (which is the correct
behaviour anyway: broken link = file not found).

## D2: Read deny-list is **stricter** than the write deny-list

The write deny-list (`DANGEROUS_WRITE_PATHS`) is broad: it includes
`/`, `/bin`, `/sbin`, `/usr`, `/var`, etc. — basically all of the
system that should not be casually modified. The read deny-list is
**narrower** but **deeper into sensitive subtrees**:

- `/etc` as a whole is NOT in the read deny-list — operators
  legitimately read `/etc/nginx/*`, `/etc/php/*`, `/etc/systemd/*`
  from the panel UI.
- Specific sub-paths under `/etc` (`/etc/shadow`, `/etc/sudoers`,
  `/etc/ssh`) ARE in the read deny-list — these contain credentials.

The rationale: blanket-deny `/etc` for reads would break too many
legitimate panel workflows; surgical deny on the high-value targets
preserves usability without giving up the security benefit.

## D3: Block FIFO / character devices on download, not on read

`readText()` returning a FIFO is "weird" but typically just blocks
(file would never resolve). `createDownloadStream` is more dangerous
— `/dev/random` would stream forever, `/dev/sda` would let a user
exfil the disk byte-by-byte. The stat-isFile check is applied to
download specifically (where streaming a non-file matters), not to
text read.

## D4: Surface `FILE_FORBIDDEN_READ` and `FILE_NOT_REGULAR_FILE` as
distinct error codes

`FILE_FORBIDDEN_READ` — policy-forbidden target.
`FILE_NOT_REGULAR_FILE` — not a regular file (FIFO, socket, device).
Two codes because the operator needs to distinguish "the policy
blocked me" from "the path I gave isn't a normal file." Both map
to HTTP 403 (or 400 for the latter — open question, defer).

## D5: Do not extend the deny-list to user-config files (operator
SSH keys, etc.) by default

The list focuses on system-level credentials (root, sshd, sudoers).
Operator-level files (`~/.ssh/id_*` for individual home dirs) are
covered via `/root` (the panel-server-user's home) and via the
practical reality that operators choose what to symlink. A
configurable deny-list could be a v0.6 enhancement.

## D6: Performance impact of `realpath` is acceptable

`fs.realpath` adds one syscall per read. For text reads / downloads,
this is negligible relative to the file I/O itself. For directory
listings (`list()`), this would matter — but `list()` is not
changed, it stays on `lstat`.
