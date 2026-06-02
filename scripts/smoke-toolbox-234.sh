#!/usr/bin/env bash
# v0.6 toolbox smoke — drives the live toolbox + fail2ban APIs.
#
# Validates the Phase 5 checklist:
#   S1 boot tools-present      GET /toolbox/status + /toolbox/cleaners + /firewall/status
#   S2 boot tool-absent        any unavailable feature 503s/400s with its documented code
#   S3 NTP round-trip          set-ntp + set-timezone back to the CURRENT values (idempotent)
#   S4 fail2ban list + unban   list jails, ban a TEST-NET IP in a running jail, then unban it
#   S5 journald vacuum + docker prune   OPT-IN (RUN_CLEANERS=1) — these mutate host state
#
# S1–S4 are non-destructive (S3 writes back the values it just read; S4 uses
# 192.0.2.123 from RFC-5737 TEST-NET-1, never a real host). S5 actually frees
# journal logs + prunes stopped containers / dangling images, so it is gated
# behind RUN_CLEANERS=1 and otherwise printed as guided manual steps.
#
# Usage:
#   DP_USER=admin DP_PASS=secret bash scripts/smoke-toolbox-234.sh
#   TOKEN=eyJ... BASE_URL=http://127.0.0.1:9999 bash scripts/smoke-toolbox-234.sh
#   RUN_CLEANERS=1 DP_USER=admin DP_PASS=secret bash scripts/smoke-toolbox-234.sh
#
# Requires: bash, curl, jq. Runs from any host (talks to the API over HTTP).

set -euo pipefail

BASE_URL="${BASE_URL:-http://192.168.199.234:9999}"
TOKEN="${TOKEN:-}"
RUN_CLEANERS="${RUN_CLEANERS:-0}"

pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAILED=1; }
skip() { printf '  \033[33mSKIP\033[0m %s\n' "$1"; }
info() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
api()  { curl -fsS -H "Authorization: Bearer $TOKEN" "$@"; }
# api_code: print HTTP status, swallow body — for asserting error codes/availability.
api_raw() { curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "$@"; }
FAILED=0

command -v jq   >/dev/null || { echo "jq is required"; exit 2; }
command -v curl >/dev/null || { echo "curl is required"; exit 2; }

# --- auth -------------------------------------------------------------
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

# --- S1: boot tools-present -------------------------------------------
info "S1 — boot tools-present (GET /toolbox/status, /toolbox/cleaners, /firewall/status)"
STATUS="$(api "$BASE_URL/api/toolbox/status")"
echo "  status: $(jq -c '.features' <<<"$STATUS")"
FEAT_COUNT="$(jq '.features | length' <<<"$STATUS")"
[[ "$FEAT_COUNT" -ge 2 ]] && pass "status lists $FEAT_COUNT features (ntp, disk)" \
  || fail "expected >=2 features, got $FEAT_COUNT"
# Each feature must carry a boolean availability + a reason (null when ok).
jq -e '.features | all(has("name") and has("available") and has("degraded") and has("reason"))' \
  <<<"$STATUS" >/dev/null && pass "every feature has the {name,available,degraded,reason} shape" \
  || fail "a feature is missing the status contract shape"
CLEANERS="$(api "$BASE_URL/api/toolbox/cleaners")"
echo "  cleaners: $(jq -c '.cleaners' <<<"$CLEANERS")"
jq -e '[.cleaners[].category] | sort == ["docker_prune","journald","package_cache"]' \
  <<<"$CLEANERS" >/dev/null && pass "cleaners expose the 3 curated categories" \
  || fail "cleaner category set unexpected"
FW="$(api "$BASE_URL/api/firewall/status")"
echo "  firewall: $(jq -c '.' <<<"$FW")"
jq -e 'has("fail2ban")' <<<"$FW" >/dev/null && pass "firewall status carries the fail2ban flag" \
  || fail "firewall status missing fail2ban flag"

# --- S2: boot tool-absent (contract) ----------------------------------
info "S2 — boot tool-absent contract (an absent tool degrades, never 500s)"
# Collect anything the host reports as unavailable, then prove its op returns
# the DOCUMENTED code (503 for missing binaries, 400 FAIL2BAN_NOT_AVAILABLE).
checked_absence=0
if [[ "$(jq -r '.features[] | select(.name=="ntp") | .available' <<<"$STATUS")" == "false" ]]; then
  CODE="$(api "$BASE_URL/api/toolbox/ntp" | jq -r '.code' 2>/dev/null || true)"
  HTTP="$(api_raw "$BASE_URL/api/toolbox/ntp")"
  [[ "$HTTP" == "503" ]] && pass "ntp absent -> GET /toolbox/ntp 503 (NTP_NOT_CONFIGURED)" \
    || fail "ntp absent but GET /toolbox/ntp returned $HTTP (expected 503)"
  checked_absence=1
fi
if [[ "$(jq -r '.features[] | select(.name=="disk") | .available' <<<"$STATUS")" == "false" ]]; then
  HTTP="$(api_raw "$BASE_URL/api/toolbox/disk")"
  [[ "$HTTP" == "503" ]] && pass "disk absent -> GET /toolbox/disk 503 (DISK_NOT_CONFIGURED)" \
    || fail "disk absent but GET /toolbox/disk returned $HTTP (expected 503)"
  checked_absence=1
fi
if [[ "$(jq -r '.fail2ban' <<<"$FW")" == "false" ]]; then
  HTTP="$(api_raw "$BASE_URL/api/firewall/fail2ban/jails")"
  # requireFail2ban() throws 400 FAIL2BAN_NOT_AVAILABLE (feature toggle, not a missing binary)
  [[ "$HTTP" == "400" ]] && pass "fail2ban absent -> /firewall/fail2ban/jails 400 (FAIL2BAN_NOT_AVAILABLE)" \
    || fail "fail2ban absent but jails returned $HTTP (expected 400)"
  checked_absence=1
fi
for c in journald package_cache; do
  AVAIL="$(jq -r --arg c "$c" '.cleaners[] | select(.category==$c) | .available' <<<"$CLEANERS")"
  if [[ "$AVAIL" == "false" ]]; then
    HTTP="$(api_raw -X POST "$BASE_URL/api/toolbox/clean" -H 'Content-Type: application/json' -d "{\"category\":\"$c\"}")"
    [[ "$HTTP" == "503" ]] && pass "$c absent -> POST /toolbox/clean 503" \
      || fail "$c absent but clean returned $HTTP (expected 503)"
    checked_absence=1
  fi
done
[[ "$checked_absence" == 0 ]] && skip "every tool present on this host — absence path covered by unit tests (Unavailable* drivers, cleaner 503 branches)"

# --- S3: NTP round-trip (idempotent — writes back what it read) -------
info "S3 — NTP round-trip (set-ntp + set-timezone back to current values)"
NTP="$(api "$BASE_URL/api/toolbox/ntp")"
TZ0="$(jq -r '.timezone' <<<"$NTP")"; NTP0="$(jq -r '.ntpEnabled' <<<"$NTP")"
echo "  current: timezone=$TZ0 ntpEnabled=$NTP0"
if [[ "$(jq -r '.features[] | select(.name=="ntp") | .available' <<<"$STATUS")" != "true" ]]; then
  skip "ntp not available on this host — round-trip not applicable"
else
  R="$(api -X POST "$BASE_URL/api/toolbox/ntp/set" -H 'Content-Type: application/json' \
        -d "{\"enabled\":$NTP0}" 2>/dev/null || true)"
  if [[ "$(jq -r '.ntpEnabled' <<<"$R" 2>/dev/null)" == "$NTP0" ]]; then
    pass "set-ntp($NTP0) round-trips, ntpEnabled still $NTP0"
  else
    fail "set-ntp failed or changed state (check the sudoers entry; got: $(jq -c '.' <<<"$R" 2>/dev/null))"
  fi
  R="$(api -X POST "$BASE_URL/api/toolbox/ntp/timezone" -H 'Content-Type: application/json' \
        -d "$(jq -n --arg t "$TZ0" '{timezone:$t}')" 2>/dev/null || true)"
  if [[ "$(jq -r '.timezone' <<<"$R" 2>/dev/null)" == "$TZ0" ]]; then
    pass "set-timezone($TZ0) round-trips, timezone unchanged"
  else
    fail "set-timezone failed or changed tz (check sudoers; got: $(jq -c '.' <<<"$R" 2>/dev/null))"
  fi
fi

# --- S4: fail2ban list + ban/unban round-trip -------------------------
info "S4 — fail2ban list + ban/unban round-trip (TEST-NET 192.0.2.123)"
if [[ "$(jq -r '.fail2ban' <<<"$FW")" != "true" ]]; then
  skip "fail2ban not available on this host"
else
  JAILS="$(api "$BASE_URL/api/firewall/fail2ban/jails")"
  echo "  jails: $(jq -c '[.[].name]' <<<"$JAILS")"
  JAIL="$(jq -r '.[0].name // empty' <<<"$JAILS")"
  if [[ -z "$JAIL" ]]; then
    skip "no running jails to ban into (fail2ban present but no jail active)"
  else
    TEST_IP="192.0.2.123"
    api -X POST "$BASE_URL/api/firewall/fail2ban/ban" -H 'Content-Type: application/json' \
      -d "$(jq -n --arg j "$JAIL" --arg ip "$TEST_IP" '{jail:$j,ip:$ip}')" >/dev/null \
      && pass "banned $TEST_IP in jail '$JAIL'" || fail "ban call failed"
    BANNED="$(api "$BASE_URL/api/firewall/fail2ban/banned" | jq -r --arg ip "$TEST_IP" '[.[]|select(.ip==$ip)]|length')"
    [[ "$BANNED" -ge 1 ]] && pass "$TEST_IP shows in the banned list" || fail "banned IP not listed"
    api -X POST "$BASE_URL/api/firewall/fail2ban/unban" -H 'Content-Type: application/json' \
      -d "$(jq -n --arg j "$JAIL" --arg ip "$TEST_IP" '{jail:$j,ip:$ip}')" >/dev/null \
      && pass "unbanned $TEST_IP" || fail "unban call failed"
    GONE="$(api "$BASE_URL/api/firewall/fail2ban/banned" | jq -r --arg ip "$TEST_IP" '[.[]|select(.ip==$ip)]|length')"
    [[ "$GONE" == "0" ]] && pass "$TEST_IP cleared from the banned list" || fail "IP still banned after unban"
  fi
fi

# --- S5: journald vacuum + docker prune (DESTRUCTIVE — opt-in) --------
info "S5 — journald vacuum + docker prune"
if [[ "$RUN_CLEANERS" == "1" ]]; then
  for cat in journald docker_prune; do
    AVAIL="$(jq -r --arg c "$cat" '.cleaners[] | select(.category==$c) | .available' <<<"$CLEANERS")"
    if [[ "$AVAIL" != "true" ]]; then skip "$cat unavailable on this host"; continue; fi
    R="$(api -X POST "$BASE_URL/api/toolbox/clean" -H 'Content-Type: application/json' -d "{\"category\":\"$cat\"}" || true)"
    if [[ "$(jq -r '.category' <<<"$R" 2>/dev/null)" == "$cat" ]]; then
      pass "$cat ran (freedBytes=$(jq -r '.freedBytes' <<<"$R"), detail=$(jq -r '.detail' <<<"$R" | head -c 80))"
    else
      fail "$cat clean failed: $(jq -c '.' <<<"$R" 2>/dev/null)"
    fi
  done
else
  skip "cleaners NOT run (set RUN_CLEANERS=1 to actually vacuum journald + prune docker)"
  cat <<EOF
  Manual / opt-in (these mutate host state):
    journald vacuum (frees logs beyond 500M):
      curl -X POST -H "Authorization: Bearer \$TOKEN" "$BASE_URL/api/toolbox/clean" \\
        -H 'Content-Type: application/json' -d '{"category":"journald"}'
    docker prune (removes STOPPED containers + dangling images, no volumes):
      curl -X POST -H "Authorization: Bearer \$TOKEN" "$BASE_URL/api/toolbox/clean" \\
        -H 'Content-Type: application/json' -d '{"category":"docker_prune"}'
EOF
fi

# --- S6: services (list + live protected-refusal — non-destructive) ---
info "S6 — services list + protected-units guard (v0.6.1)"
SERVICES_AVAIL="$(jq -r '.features[] | select(.name=="services") | .available' <<<"$STATUS")"
if [[ "$SERVICES_AVAIL" != "true" ]]; then
  skip "services not available on this host (systemctl missing)"
else
  SVC="$(api "$BASE_URL/api/toolbox/services")"
  COUNT="$(jq 'length' <<<"$SVC")"
  [[ "$COUNT" -ge 1 ]] && pass "listed $COUNT .service units" || fail "services list empty"
  jq -e 'all(.[]; .name | endswith(".service"))' <<<"$SVC" >/dev/null \
    && pass "every listed unit is a .service" || fail "a non-.service unit leaked into the list"
  # Protected refusal is NON-DESTRUCTIVE: the action is refused, nothing runs.
  for unit in dinopanel.service sshd.service; do
    RESP="$(curl -s -H "Authorization: Bearer $TOKEN" -X POST "$BASE_URL/api/toolbox/services/action" \
      -H 'Content-Type: application/json' -d "$(jq -n --arg u "$unit" '{unit:$u,action:"stop"}')")"
    CODE="$(jq -r '.code // empty' <<<"$RESP")"
    [[ "$CODE" == "SERVICE_PROTECTED" ]] \
      && pass "stop $unit refused (SERVICE_PROTECTED)" \
      || fail "stop $unit NOT refused (got: $(jq -c '.' <<<"$RESP" 2>/dev/null))"
  done
  # A .socket variant must also be refused (the .service-only guard).
  RESP="$(curl -s -H "Authorization: Bearer $TOKEN" -X POST "$BASE_URL/api/toolbox/services/action" \
    -H 'Content-Type: application/json' -d '{"unit":"ssh.socket","action":"stop"}')"
  [[ "$(jq -r '.code // empty' <<<"$RESP")" == "SERVICE_PROTECTED" ]] \
    && pass "stop ssh.socket refused (.service-only guard)" \
    || fail "ssh.socket stop NOT refused (got: $(jq -c '.' <<<"$RESP" 2>/dev/null))"
fi

echo
if [[ "$FAILED" == 0 ]]; then
  echo -e "\033[32mToolbox smoke S1-S4 + S6 PASSED\033[0m ($([[ "$RUN_CLEANERS" == 1 ]] && echo 'S5 ran' || echo 'S5 opt-in'))"
else
  echo -e "\033[31mSome checks FAILED\033[0m"; exit 1
fi
