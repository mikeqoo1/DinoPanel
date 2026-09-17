#!/usr/bin/env bash
# v0.6.6 smoke — for every registered node, hit GET /api/nodes/:id/containers and
# report whether a container engine (docker OR podman) answered and how many
# containers came back. Read-only; registers/deletes nothing.
#
# Usage:
#   DP_USER=admin DP_PASS=secret bash scripts/smoke-podman-nodes-234.sh
#   TOKEN=eyJ... BASE_URL=http://127.0.0.1:9999 bash scripts/smoke-podman-nodes-234.sh
#
# Requires: bash, curl, jq.
set -euo pipefail
BASE_URL="${BASE_URL:-http://192.168.199.234:9999}"
TOKEN="${TOKEN:-}"
command -v jq >/dev/null || { echo "jq is required"; exit 2; }

if [[ -z "$TOKEN" ]]; then
  : "${DP_USER:?set DP_USER + DP_PASS, or pass TOKEN}"
  : "${DP_PASS:?set DP_USER + DP_PASS, or pass TOKEN}"
  TOKEN="$(curl -fsS -X POST "$BASE_URL/api/auth/login" -H 'Content-Type: application/json' \
    -d "$(jq -n --arg u "$DP_USER" --arg p "$DP_PASS" '{username:$u,password:$p}')" | jq -r '.accessToken')"
  [[ -n "$TOKEN" && "$TOKEN" != "null" ]] || { echo "login failed"; exit 1; }
fi

printf '%-24s %-17s %-12s %-6s %-8s %s\n' NAME HOST USER HTTP ENGINE CONTAINERS
echo "local engine: $(curl -fsS -H "Authorization: Bearer $TOKEN" "$BASE_URL/api/containers/engine" | jq -r '"\(.engine) \(.version)"' 2>/dev/null || echo '(n/a — pre-0.6.7 server?)')" 
curl -fsS -H "Authorization: Bearer $TOKEN" "$BASE_URL/api/nodes" \
  | jq -r '.[] | [.id, .name, .host, .user] | @tsv' \
  | while IFS=$'\t' read -r id name host user; do
      body="$(curl -sS -w '\n%{http_code}' -H "Authorization: Bearer $TOKEN" "$BASE_URL/api/nodes/$id/containers" || true)"
      code="${body##*$'\n'}"; json="${body%$'\n'*}"
      if [[ "$code" == "200" ]]; then
        avail="$(jq -r '.dockerAvailable' <<<"$json")"
        count="$(jq -r '.containers | length' <<<"$json")"
        states="$(jq -r '[.containers[].state] | group_by(.) | map("\(.[0])=\(length)") | join(",")' <<<"$json")"
        # v0.6.8: engines[] (engine/owner/ok/permissionDenied) + sudoFailed; rows carry engine+owner
        engine="$(jq -r '[.engines[] | select(.ok) | .engine] | unique | join("+") | if . == "" then (if .dockerAvailable then "-" else "none" end) else . end' <<<"$json")"
        denied="$(jq -r '[.engines[] | select(.permissionDenied) | "\(.engine)/\(.owner) DENIED"] | join(",") | if . == "" then "" else " " + . end' <<<"$json")"
        sudo="$(jq -r 'if .sudoFailed == true then " SUDO_FAILED" else "" end' <<<"$json")"
        owners="$(jq -r '[.containers[] | "\(.engine)/\(.owner)"] | group_by(.) | map("\(.[0])=\(length)") | join(",")' <<<"$json")"
        printf '%-24s %-17s %-12s %-6s %-8s %s %s %s%s%s\n' "$name" "$host" "$user" "$code" "$engine" "$count" "$states" "$owners" "$denied" "$sudo"
      else
        printf '%-24s %-17s %-12s %-6s %-8s %s\n' "$name" "$host" "$user" "$code" "-" "$(jq -r '.code // .message // empty' <<<"$json" 2>/dev/null | head -1)"
      fi
    done
