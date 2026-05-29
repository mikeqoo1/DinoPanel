#!/usr/bin/env bash
# v0.5 database-backups smoke — run ON the panel host (e.g. Rocky 234).
#
# Drives the live backups API to validate the Phase 6 smoke checklist.
# The non-destructive checks (manual backup, on-disk gzip, retention
# prune, scheduled backup) run automatically; the DESTRUCTIVE restore
# round-trip is printed as guided manual steps at the end (it drops the
# target DB, so it is intentionally not auto-run).
#
# Usage:
#   # with username/password (logs in for a token):
#   DP_USER=admin DP_PASS=secret bash scripts/smoke-backups-234.sh
#
#   # or pass an existing bearer token + a non-default instance:
#   TOKEN=eyJ... INSTANCE=shop BASE_URL=http://127.0.0.1:9999 \
#     bash scripts/smoke-backups-234.sh
#
# Requires: bash, curl, jq. Runs from ANY host (e.g. your workstation):
# backup contents are fetched through the download API, so no on-host
# disk access or sudo is needed.

set -euo pipefail

BASE_URL="${BASE_URL:-http://192.168.199.234:9999}"
INSTANCE="${INSTANCE:-shop}"      # target DB instance NAME (checklist uses the `shop` PostgreSQL)
TOKEN="${TOKEN:-}"

pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAILED=1; }
info() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
api()  { curl -fsS -H "Authorization: Bearer $TOKEN" "$@"; }
FAILED=0

command -v jq  >/dev/null || { echo "jq is required"; exit 2; }
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

# --- resolve instance -------------------------------------------------
info "Resolving instance '$INSTANCE'"
INSTANCE_JSON="$(api "$BASE_URL/api/databases" | jq -c --arg n "$INSTANCE" '.[] | select(.name==$n)')"
[[ -n "$INSTANCE_JSON" ]] || { echo "instance '$INSTANCE' not found"; exit 1; }
IID="$(jq -r '.id' <<<"$INSTANCE_JSON")"
ENGINE="$(jq -r '.engine' <<<"$INSTANCE_JSON")"
echo "  id=$IID engine=$ENGINE"

# --- S1: manual backup + file retrievable via the download API --------
info "S1 — manual backup of $INSTANCE"
B="$(api -X POST "$BASE_URL/api/databases/$IID/backups" -H 'Content-Type: application/json' -d '{}')"
BID="$(jq -r '.id' <<<"$B")"; FILE="$(jq -r '.filePath' <<<"$B")"
STATUS="$(jq -r '.status' <<<"$B")"; SIZE="$(jq -r '.byteSize' <<<"$B")"
[[ "$STATUS" == "success" ]] && pass "backup #$BID status=success size=${SIZE}B" || fail "status=$STATUS"
# Pull the bytes back through the API — works from any host, no sudo.
TMPGZ="$(mktemp)"
if api "$BASE_URL/api/backups/$BID/download" -o "$TMPGZ" && [[ -s "$TMPGZ" ]]; then
  pass "download ok: $(wc -c <"$TMPGZ") bytes (server path: $FILE)"
else
  fail "download failed for backup #$BID (server path: $FILE)"
fi

# --- S2: gzip preamble (PostgreSQL/MySQL = SQL text) ------------------
info "S2 — gunzip preamble (from the downloaded file)"
HEAD="$(gunzip -c "$TMPGZ" 2>/dev/null | head -c 400 || true)"
case "$ENGINE" in
  postgresql|mysql|mariadb) grep -qiE 'PostgreSQL database dump|MySQL dump|CREATE|DROP|--' <<<"$HEAD" \
      && pass "valid SQL preamble" || fail "no SQL preamble in: $(head -c 80 <<<"$HEAD")" ;;
  *) [[ -n "$HEAD" ]] && pass "decompressed non-empty ($ENGINE: binary dump)" || fail "empty after gunzip" ;;
esac
rm -f "$TMPGZ"

# --- S3: retention prune (8 created, keepLastN=7 → 7 remain) ----------
info "S3 — retention prune (group=smoke-prune, keepLastN=7, create 8)"
for i in $(seq 1 8); do
  api -X POST "$BASE_URL/api/databases/$IID/backups" -H 'Content-Type: application/json' \
    -d '{"retentionGroup":"smoke-prune","keepLastN":7}' >/dev/null
done
REMAIN="$(api "$BASE_URL/api/databases/$IID/backups" | jq '[.items[] | select(.retentionGroup=="smoke-prune")] | length')"
[[ "$REMAIN" == "7" ]] && pass "7 remain after pruning 8" || fail "expected 7, got $REMAIN"

# --- S4: scheduled backup via temp '* * * * *' cron -------------------
info "S4 — scheduled db_backup (group=smoke-sched, ~75s wait)"
TASK="$(api -X POST "$BASE_URL/api/scheduler/tasks" -H 'Content-Type: application/json' \
  -d "$(jq -n --argjson id "$IID" '{name:"smoke-sched",type:"db_backup",cron:"* * * * *",enabled:true,
        payload:{instanceId:$id,retentionGroup:"smoke-sched",keepLastN:3}}')")"
TID="$(jq -r '.id' <<<"$TASK")"
echo "  task #$TID created; waiting 75s for the minute tick..."
sleep 75
SCHED="$(api "$BASE_URL/api/databases/$IID/backups" | jq '[.items[] | select(.source=="scheduled" and .retentionGroup=="smoke-sched")] | length')"
[[ "$SCHED" -ge 1 ]] && pass "$SCHED scheduled backup(s) produced" || fail "no scheduled backup fired"
api -X DELETE "$BASE_URL/api/scheduler/tasks/$TID" >/dev/null && echo "  task #$TID deleted"

# --- S5: restore round-trip (DESTRUCTIVE — manual) --------------------
info "S5 — restore round-trip (DESTRUCTIVE — run by hand)"
cat <<EOF
  Restore drops + recreates '$INSTANCE' IN PLACE. Verify manually:
    1. Write a marker row, e.g. (postgresql):
         docker exec dinopanel-$ENGINE-$INSTANCE psql -U <user> -d postgres \\
           -c "CREATE TABLE smoke_marker(v text); INSERT INTO smoke_marker VALUES('present');"
    2. Take a backup:   curl -X POST .../api/databases/$IID/backups -d '{}'   (note its id)
    3. Drop the marker: docker exec ... psql ... -c "DROP TABLE smoke_marker;"
    4. Restore:         curl -X POST .../api/backups/<id>/restore -d '{"confirm":"$INSTANCE"}'
    5. Confirm back:    docker exec ... psql ... -c "SELECT * FROM smoke_marker;"  → 'present'
  (redis restore briefly stops/starts the container — expected.)

  Cleanup the smoke backups this script created:
    curl -H 'Authorization: Bearer \$TOKEN' "$BASE_URL/api/databases/$IID/backups" \\
      | jq -r '.items[] | select(.retentionGroup|test("^smoke-")) | .id' \\
      | xargs -I{} curl -X DELETE -H 'Authorization: Bearer \$TOKEN' "$BASE_URL/api/backups/{}"
EOF

echo
[[ "$FAILED" == 0 ]] && echo -e "\033[32mAutomated checks S1-S4 PASSED\033[0m (S5 manual)" \
                     || { echo -e "\033[31mSome checks FAILED\033[0m"; exit 1; }
