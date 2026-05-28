# Decisions — v0.5.2 nginx directive injection guard

## D1: Regex charset `[a-zA-Z0-9._-]` not `[a-zA-Z0-9.]+`

Allowed:
- Letters, digits (`a-zA-Z0-9`) — needed for `index.html`,
  `default.html`, `Default.aspx`, etc.
- `.` — needed for the extension separator and for files like
  `index.welcome.html`.
- `_` and `-` — needed for filenames like `home_v2.html`,
  `welcome-page.html`.

Excluded:
- Whitespace — any space allows breaking out of the directive.
- `;` — the directive separator.
- `/` — would allow `../../etc/passwd` path traversal.
- `{`, `}` — could open / close nginx blocks.
- `'`, `"` — quote characters; could escape interpolation context.
- `$` — nginx variable prefix; rarely needed in filename position.

The charset is the standard "safe filename" pattern used by many
file-handling libraries. It is intentionally narrow.

## D2: Length cap at 64 chars per item

No legitimate filename in a website index list exceeds 64
characters in practice. The cap defends against pathological
payload sizes and lazy regex catastrophic-backtracking concerns
(though our regex is not backtracking-vulnerable).

## D3: Array bounds — min 1, max 8

- min 1: an empty index array makes the nginx config render
  `index ;` which is a syntax error. Forcing at least one entry
  surfaces the configuration mistake at the API boundary instead
  of at `nginx -t` time.
- max 8: nobody legitimately needs more than 8 index file
  candidates. Bounds the payload size; prevents DoS via massive
  arrays.

## D4: Do **not** quote-escape user values at interpolation time
as the primary fix

An alternative considered: leave the schema loose, but make the
renderer escape every interpolation. Rejected because:
- Nginx has no canonical "escape sequence" for filenames in
  `index` directive context. Quoting (`index "x";`) works
  syntactically, but the schema fix is simpler, equally complete,
  and provides defence-in-depth.
- The schema fix produces clear API-time errors visible to the
  operator. Escape-at-render-time would silently accept malicious
  values and emit weird-looking confs.
- The renderer's existing safety comment promises schema-level
  validation; the right fix is to deliver on that promise.

## D5: Conf renderer audit of all other interpolations

Per the L2D reviewer, also enumerate every `${...}` in
`conf-renderer.ts`. Findings to be filled during implementation:

| Field | Current schema | Verdict |
|---|---|---|
| `payload.indexFiles` | unconstrained → tightened in this change | fixed |
| `payload.documentIndex` | unconstrained → tightened in this change | fixed |
| `payload.upstream` | `z.string().url()` | ACCEPTED (operator can legitimately proxy to any URL; the SSRF concern is documented in PMM proposal, similar treatment applies here) |
| `site.serverName` / `domain` | (verify during impl) | TBD |
| `payload.rootDir` / `documentRoot` | (verify during impl) | TBD |
| `payload.fastcgiPass` (php upstream) | (verify during impl) | TBD |

If any TBD row resolves to "needs tightening," it becomes a
follow-up change unless the fix is a one-liner that can be
folded into this change.

## D6: Threat model — malicious / compromised operator

DinoPanel is single-operator; the attacker model for this issue
is a malicious or compromised operator account. The fix still
matters because:

1. Defence in depth — a compromised JWT (see auth review's BLOCK
   findings) should not chain into a `chroot`-equivalent of the
   host nginx config.
2. The conf renderer's stated invariant is that schemas validate
   inputs; restoring that invariant is correct on principle even
   if no current attack chains here today.
