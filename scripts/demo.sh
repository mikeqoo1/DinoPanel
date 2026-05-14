#!/usr/bin/env bash
# Demo runner — single-process Node server that hosts API + WS + SPA on one port.
# Usage:
#   scripts/demo.sh start    Start server in background
#   scripts/demo.sh stop     Kill background server
#   scripts/demo.sh restart  Stop, then start
#   scripts/demo.sh status   Print pid + uptime, exit 1 if not running
#   scripts/demo.sh logs     Tail server log
#   scripts/demo.sh fg       Run in foreground (Ctrl+C to stop)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEMO_DIR="$ROOT/runtime"
PID_FILE="$DEMO_DIR/dinopanel.pid"
LOG_FILE="$DEMO_DIR/dinopanel.log"
PORT="${PORT:-9999}"
HOST="${HOST:-127.0.0.1}"

mkdir -p "$DEMO_DIR"

err() { printf "\033[31m✗\033[0m %s\n" "$*" >&2; }
ok()  { printf "\033[32m✓\033[0m %s\n" "$*"; }
info(){ printf "\033[36m·\033[0m %s\n" "$*"; }

require_build() {
  if [ ! -f "$ROOT/apps/server/dist/main.js" ] \
     || [ ! -f "$ROOT/apps/web/dist/index.html" ] \
     || [ ! -f "$ROOT/packages/shared/dist/index.js" ]; then
    err "Build artefacts missing. Run: pnpm build"
    exit 1
  fi
}

is_running() {
  [ -f "$PID_FILE" ] && ps -p "$(cat "$PID_FILE")" >/dev/null 2>&1
}

cmd_start() {
  if is_running; then
    info "Already running (pid=$(cat "$PID_FILE")). http://$HOST:$PORT"
    return 0
  fi
  rm -f "$PID_FILE"
  require_build

  info "Starting DinoPanel on http://$HOST:$PORT …"
  cd "$ROOT/apps/server"
  WEB_DIST="$ROOT/apps/web/dist" \
  HOST="$HOST" \
  PORT="$PORT" \
    nohup node dist/main.js >"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
  disown || true

  # Wait up to 5s for the health endpoint to respond.
  for _ in $(seq 1 25); do
    if curl -fsS -o /dev/null "http://$HOST:$PORT/api/health" 2>/dev/null; then
      ok "Server ready (pid=$(cat "$PID_FILE"))"
      echo
      echo "    URL:    http://$HOST:$PORT"
      echo "    Login:  admin / DinoTest1234   (dev seed)"
      echo
      echo "    Logs:   pnpm demo:logs"
      echo "    Stop:   pnpm demo:stop"
      return 0
    fi
    sleep 0.2
  done

  err "Server failed to become healthy. Last log lines:"
  tail -n 20 "$LOG_FILE" >&2
  rm -f "$PID_FILE"
  return 1
}

cmd_stop() {
  if ! is_running; then
    info "Not running."
    rm -f "$PID_FILE"
    return 0
  fi
  local pid
  pid=$(cat "$PID_FILE")
  kill "$pid" 2>/dev/null || true
  # Wait up to 3s for graceful exit.
  for _ in $(seq 1 15); do
    if ! ps -p "$pid" >/dev/null 2>&1; then break; fi
    sleep 0.2
  done
  if ps -p "$pid" >/dev/null 2>&1; then
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
  ok "Stopped (pid=$pid)"
}

cmd_status() {
  if is_running; then
    local pid
    pid=$(cat "$PID_FILE")
    ok "Running on http://$HOST:$PORT (pid=$pid)"
    ps -p "$pid" -o pid,etime,%cpu,rss,cmd | sed -n '1p;2p'
    return 0
  fi
  info "Not running."
  return 1
}

cmd_logs() {
  [ -f "$LOG_FILE" ] || { err "No log file yet."; exit 1; }
  tail -F "$LOG_FILE"
}

cmd_fg() {
  if is_running; then
    err "Already running in background (pid=$(cat "$PID_FILE")). Run 'demo:stop' first."
    exit 1
  fi
  require_build
  cd "$ROOT/apps/server"
  exec env \
    WEB_DIST="$ROOT/apps/web/dist" \
    HOST="$HOST" \
    PORT="$PORT" \
    node dist/main.js
}

case "${1:-start}" in
  start)   cmd_start ;;
  stop)    cmd_stop ;;
  restart) cmd_stop; sleep 0.5; cmd_start ;;
  status)  cmd_status ;;
  logs)    cmd_logs ;;
  fg|foreground) cmd_fg ;;
  *)
    cat >&2 <<EOF
Usage: $0 {start|stop|restart|status|logs|fg}

  start    Background daemon (default)
  stop     Kill the daemon
  restart  Stop, then start
  status   Show pid + uptime
  logs     Tail logs
  fg       Run in foreground (Ctrl+C to stop)

Env overrides:
  PORT (default 9999)   HOST (default 127.0.0.1)
EOF
    exit 1
    ;;
esac
