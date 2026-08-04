#!/usr/bin/env bash
# v0.6.2 nodes smoke — registers a real node (235) and a dead node (TEST-NET),
# drives the API, and cleans up on exit.
#
# Validates the v0.6.2 smoke checklist:
#   S1  register 192.168.199.235 (root:22) + POST :id/test (ok:true, latencyMs>0)
#       + assert duplicate host:port → 409 NODES_DUPLICATE
#   S2  GET :id/metrics — cpu.usage 0-100, mem.total>0, uptimeSec>0, disks length>0
#   S3  GET :id/containers — dockerAvailable is boolean;
#       if true, every container state is a valid ContainerState enum value
#   S4  register 192.0.2.1 (RFC-5737 TEST-NET-1, unreachable),
#       GET metrics — expect 502 NODES_UNREACHABLE (~5s for ConnectTimeout)
#   Cleanup: DELETE both test nodes on exit (trap — runs even on failure)
#
# All steps are non-destructive (read-only remote commands; test nodes deleted
# on exit). No changes are made to 192.168.199.235.
#
# Usage:
#   DP_USER=admin DP_PASS=secret bash scripts/smoke-nodes-234.sh
#   TOKEN=eyJ... BASE_URL=http://127.0.0.1:9999 bash scripts/smoke-nodes-234.sh
#
# Requires: bash, curl, jq. Runs from any host (talks to the API over HTTP).

set -euo pipefail

BASE_URL="${BASE_URL:-http://192.168.199.234:9999}"
TOKEN="${TOKEN:-}"
NODE_ID=""   # smoke-235 (192.168.199.235) — set after S1 registration
FAKE_ID=""   # smoke-unreachable (192.0.2.1)  — set after S4 registration

pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAILED=1; }
skip() { printf '  \033[33mSKIP\033[0m %s\n' "$1"; }
info() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
api()  { curl -fsS -H "Authorization: Bearer $TOKEN" "$@"; }
api_raw() { curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "$@"; }
FAILED=0

command -v jq   >/dev/null || { echo "jq is required"; exit 2; }
command -v curl >/dev/null || { echo "curl is required"; exit 2; }

cleanup() {
  if [[ -n "$NODE_ID" ]]; then
    curl -fsS -X DELETE -H "Authorization: Bearer $TOKEN" \
      "$BASE_URL/api/nodes/$NODE_ID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$FAKE_ID" ]]; then
    curl -fsS -X DELETE -H "Authorization: Bearer $TOKEN" \
      "$BASE_URL/api/nodes/$FAKE_ID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# --- auth -----------------------------------------------------------------
if [[ -z "$TOKEN" ]]; then
  : "${DP_USER:?set DP_USER + DP_PASS, or pass TOKEN}"
  : "${DP_PASS:?set DP_USER + DP_PASS, or pass TOKEN}"
  info "Logging in as $DP_USER"
  TOKEN="$(curl -fsS -X POST "$BASE_URL/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "$(jq -n --arg u "$DP_USER" --arg p "$DP_PASS" '{username:$u,password:$p}')" \
    | jq -r '.accessToken')"
  [[ -n "$TOKEN" && "$TOKEN" != "null" ]] || { echo "login failed"; exit 1; }
fi

# Pre-cleanup: remove stale smoke nodes from an interrupted previous run.
# Prevents 409 NODES_DUPLICATE on re-run without manual intervention.
for STALE_NAME in "smoke-235" "smoke-unreachable"; do
  STALE_ID="$(api "$BASE_URL/api/nodes" \
    | jq -r --arg n "$STALE_NAME" '.[] | select(.name==$n) | .id')"
  if [[ -n "$STALE_ID" ]]; then
    api -X DELETE "$BASE_URL/api/nodes/$STALE_ID" >/dev/null
    echo "  pre-cleaned stale node '$STALE_NAME' ($STALE_ID)"
  fi
done

# --- S1: register + test + duplicate guard --------------------------------
info "S1 — register 192.168.199.235 + test connection + 409 NODES_DUPLICATE"

LIST="$(api -X POST "$BASE_URL/api/nodes" \
  -H 'Content-Type: application/json' \
  -d '{"name":"smoke-235","host":"192.168.199.235","user":"root","port":22}')"
NODE_ID="$(jq -r '.[] | select(.host=="192.168.199.235") | .id' <<<"$LIST")"
[[ -n "$NODE_ID" ]] \
  && pass "registered smoke-235, id=$NODE_ID" \
  || fail "could not extract node id from list"

TEST="$(api -X POST "$BASE_URL/api/nodes/$NODE_ID/test" \
  -H 'Content-Type: application/json' -d '{}')"
jq -e '.ok == true and (.latencyMs > 0)' <<<"$TEST" >/dev/null \
  && pass "test ok=true latencyMs=$(jq -r '.latencyMs' <<<"$TEST")ms" \
  || fail "test failed or latencyMs=0: $(jq -c '.' <<<"$TEST")"

# Duplicate registration: same host:port must return 409 NODES_DUPLICATE.
DUP_TMP="$(mktemp)"
DUP_HTTP="$(curl -sS -H "Authorization: Bearer $TOKEN" \
  -X POST "$BASE_URL/api/nodes" \
  -H 'Content-Type: application/json' \
  -d '{"name":"smoke-235-dup","host":"192.168.199.235","user":"root","port":22}' \
  -o "$DUP_TMP" -w '%{http_code}' || true)"
DUP_CODE="$(jq -r '.code // empty' "$DUP_TMP" 2>/dev/null || true)"
rm -f "$DUP_TMP"
[[ "$DUP_HTTP" == "409" && "$DUP_CODE" == "NODES_DUPLICATE" ]] \
  && pass "duplicate host:port → 409 NODES_DUPLICATE" \
  || fail "expected 409 NODES_DUPLICATE, got HTTP=$DUP_HTTP code=$DUP_CODE"

# --- S2: metrics shape ----------------------------------------------------
info "S2 — GET :id/metrics (cpu.usage, mem.total, uptimeSec, disks)"

METRICS="$(api "$BASE_URL/api/nodes/$NODE_ID/metrics")"

jq -e '.cpu.usage >= 0 and .cpu.usage <= 100' <<<"$METRICS" >/dev/null \
  && pass "cpu.usage=$(jq -r '.cpu.usage' <<<"$METRICS") (0–100)" \
  || fail "cpu.usage out of range or missing"

jq -e '.mem.total > 0' <<<"$METRICS" >/dev/null \
  && pass "mem.total=$(jq -r '.mem.total' <<<"$METRICS")" \
  || fail "mem.total missing or zero"

jq -e '.uptimeSec > 0' <<<"$METRICS" >/dev/null \
  && pass "uptimeSec=$(jq -r '.uptimeSec' <<<"$METRICS")" \
  || fail "uptimeSec missing or zero"

jq -e '(.disks | length) > 0' <<<"$METRICS" >/dev/null \
  && pass "disks=$(jq '.disks | length' <<<"$METRICS") entries" \
  || fail "disks empty or missing"

# --- S3: containers shape -------------------------------------------------
info "S3 — GET :id/containers (dockerAvailable boolean; state enum)"

CTRS="$(api "$BASE_URL/api/nodes/$NODE_ID/containers")"

jq -e '.dockerAvailable | type == "boolean"' <<<"$CTRS" >/dev/null \
  && pass "dockerAvailable=$(jq -r '.dockerAvailable' <<<"$CTRS")" \
  || fail "dockerAvailable missing or not boolean"

if [[ "$(jq -r '.dockerAvailable' <<<"$CTRS")" == "true" ]]; then
  COUNT="$(jq '.containers | length' <<<"$CTRS")"
  # Valid ContainerState values (spec F3 / packages/shared/src/schemas/containers.ts).
  BAD="$(jq '[.containers[] | select(
    .state | test("^(created|running|paused|restarting|removing|exited|dead)$") | not
  )] | length' <<<"$CTRS")"
  [[ "$BAD" == "0" ]] \
    && pass "all $COUNT container(s) have valid ContainerState" \
    || fail "$BAD container(s) with unrecognised state"
else
  skip "docker not installed on node — container state enum check N/A"
fi

# --- S4: unreachable node → 502 NODES_UNREACHABLE -------------------------
info "S4 — register 192.0.2.1 (TEST-NET, unreachable) → expect 502 NODES_UNREACHABLE"

FAKE_LIST="$(api -X POST "$BASE_URL/api/nodes" \
  -H 'Content-Type: application/json' \
  -d '{"name":"smoke-unreachable","host":"192.0.2.1","user":"root","port":22}')"
FAKE_ID="$(jq -r '.[] | select(.host=="192.0.2.1") | .id' <<<"$FAKE_LIST")"
[[ -n "$FAKE_ID" ]] \
  && echo "  registered fake node id=$FAKE_ID" \
  || fail "could not register fake node"

echo "  GET metrics for unreachable node (ConnectTimeout ~5s, expect ~6-8s total)..."
S4_TMP="$(mktemp)"
S4_HTTP="$(curl -sS -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/api/nodes/$FAKE_ID/metrics" \
  -o "$S4_TMP" -w '%{http_code}' || true)"
S4_CODE="$(jq -r '.code // empty' "$S4_TMP" 2>/dev/null || true)"
rm -f "$S4_TMP"
[[ "$S4_HTTP" == "502" && "$S4_CODE" == "NODES_UNREACHABLE" ]] \
  && pass "192.0.2.1 metrics → 502 NODES_UNREACHABLE" \
  || fail "expected 502 NODES_UNREACHABLE, got HTTP=$S4_HTTP code=$S4_CODE"

# --- summary --------------------------------------------------------------
echo
if [[ "$FAILED" == 0 ]]; then
  echo -e "\033[32mNodes smoke S1–S4 PASSED\033[0m"
else
  echo -e "\033[31mSome checks FAILED\033[0m"; exit 1
fi
