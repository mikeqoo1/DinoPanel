# Decisions — v0.5.2 db-instance password redact

## D1: Schema split (redacted public + reveal) over "include password
only on creation" optimisation

An alternative considered: return `password` on `POST /databases`
(creation) and on `POST /:id/rotate-password`, but omit it from
all other reads. The argument for this: those are the two flows
where the operator "needs" the password.

Rejected because:
- The rotation response shape becomes operationally surprising —
  a refresh of the page that just rotated would silently stop
  showing the password.
- Frontend state management would need to capture the password
  on those responses and hold it in app memory — making the
  caching problem we are trying to solve worse, not better.
- The reveal endpoint pattern is already used elsewhere in the
  panel (Cloudflare API token, ACME private key downloads).
  Consistency is more valuable than the saved click.

## D2: Reveal endpoint requires current user password, not just JWT

A short-lived JWT alone is not sufficient — if an attacker has
stolen one (via the WS-token-in-URL issue, browser memory, etc.),
they have unrestricted reveal access. A re-auth step requires
something the attacker would have to phish separately.

This matches the `changePassword` flow, which also requires the
user's current password despite already holding a JWT.

## D3: Reveal endpoint rate limit is user-keyed, not IP-keyed

Default NestJS Throttler keys on `req.ip`. For a reveal endpoint
behind admin auth, we want to limit *per actor*, not per source
IP — a single operator behind NAT trying to brute-force their own
re-auth would otherwise share a quota with their teammates.

This requires a custom Throttler tracker (likely a separate small
follow-up if it does not exist yet; documented as a known issue
in the auth-perspective L2A finding under WARN). For v0.5.2 ship
purposes a coarse `req.ip` tracker is acceptable bridge if the
custom tracker is not ready, **but** the reveal endpoint MUST
have *some* rate limit applied — global Throttle 120/min is too
loose.

## D4: Frontend "reveal" UX uses an auto-hide window, not persistent
display

After successful reveal, the password is shown for ~30 seconds
then auto-hides (requires a fresh re-auth to see it again).
Rationale: limits the shoulder-surfing window. Operator can copy
the value to clipboard inside the window; if they need it longer,
they should put it in their password manager.

A "show / hide" toggle that persists indefinitely was rejected for
the same reason — defeats the purpose of having moved away from
on-wire-on-every-load.

## D5: At-rest encryption (`SecretsService`) deferred to a separate
proposal

The TODO in `apps/server/src/database/schema.ts:215`
(`// TODO(v0.5): encrypt via SecretsService`) is a related but
separate concern. The at-wire / at-cache leak is the more
exploitable surface today; encrypting at-rest requires a key
management story (where does the encryption key live? how do
docker env vars get the plaintext at runtime?). Tackling that
properly is a v0.6 scope.

This change is the no-key-management-required, no-data-migration
half of the fix — and addresses the higher-CVSS half.

## D6: Audit interceptor must redact `currentPassword` field

The reveal endpoint takes `{ currentPassword }` in the body. The
existing `redactSensitiveFields` list must include `currentPassword`
so it does not land in `operationLog.bodySummary`. Failure to do
this would turn the audit log into a credential cache.
