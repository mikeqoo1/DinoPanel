#!/usr/bin/env bash
# DinoPanel installation script
# Usage:  sudo bash install.sh                            (interactive)
#         sudo ADMIN_USERNAME=x ADMIN_PASSWORD=y bash install.sh   (non-interactive)
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/usr/local/dinopanel}"
DATA_DIR="${DATA_DIR:-/var/lib/dinopanel}"
LOG_DIR="${LOG_DIR:-/var/log/dinopanel}"
PORT="${PORT:-9999}"
HOST="${HOST:-127.0.0.1}"
SERVICE_NAME="dinopanel"

err()  { printf "\033[31m[ERROR]\033[0m %s\n" "$*" >&2; exit 1; }
info() { printf "\033[36m[*]\033[0m %s\n" "$*"; }
ok()   { printf "\033[32m[OK]\033[0m %s\n" "$*"; }
ask()  {
  local prompt="$1" default="${2:-}" var
  if [ -n "$default" ]; then
    read -r -p "$prompt [$default]: " var
    echo "${var:-$default}"
  else
    read -r -p "$prompt: " var
    echo "$var"
  fi
}

# ── relabel_path: idempotent SELinux fcontext + restorecon ──────────────────
# v0.4: same helper backs (1) install-time relabel of /opt/dinopanel/sites
# and /opt/dinopanel/databases roots, and (2) runtime per-instance relabel
# called by DatabasesService (Phase 2) via the `relabel-path` subcommand.
# No-op on non-SELinux hosts (no `semanage` available).
relabel_path() {
  local path="$1" label="$2"
  if ! command -v semanage >/dev/null 2>&1; then
    info "semanage not installed — SELinux relabel skipped for $path"
    return 0
  fi
  local output
  if ! output=$(semanage fcontext -a -t "$label" "$path(/.*)?" 2>&1); then
    # `-a` returns non-zero with "already defined" / "sameLabelException"
    # when the mapping is already in place — that's the steady state.
    if ! echo "$output" | grep -qE "already defined|sameLabelException"; then
      err "semanage fcontext failed for $path: $output"
    fi
  fi
  if ! restorecon -R "$path" 2>/dev/null; then
    err "restorecon failed for $path"
  fi
  ok "SELinux relabel: $path → $label"
}

# Subcommand dispatch — runtime DinoPanel shells out via
# `bash install.sh relabel-path <path> <label>` for per-instance
# data-dir labelling (Phase 2). Must come BEFORE the global root check
# so the helper can be invoked directly without re-running install flow.
if [ "${1:-}" = "relabel-path" ]; then
  [ "$#" -eq 3 ] || err "Usage: install.sh relabel-path <path> <label>"
  [ "$(id -u)" -eq 0 ] || err "relabel-path requires root"
  relabel_path "$2" "$3"
  exit 0
fi

[ "$(id -u)" -eq 0 ] || err "此腳本必須以 root 身份執行（請使用：sudo bash $0）"

# Detect platform
case "$(uname -s)" in
  Linux) ;;
  *) err "Only Linux is supported" ;;
esac
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64)  ARCH_NORM="x64"  ;;
  aarch64|arm64) ARCH_NORM="arm64" ;;
  *) err "Unsupported architecture: $ARCH" ;;
esac

# ── node-pty Native Module Dependency Check ──────────────────────────────────
# node-pty is a C++ native module. The release tarball may optionally ship
# precompiled binaries under prebuilds/linux-<arch>/. If prebuilds are present
# the target machine does NOT need build-essential/python3.
# If prebuilds are absent, the system must have a build toolchain.
SRC_EARLY="$(cd "$(dirname "$0")" && pwd)"
PREBUILD_NODE="${SRC_EARLY}/server/node_modules/node-pty/prebuilds/linux-${ARCH_NORM}/pty.node"

if [ -f "$PREBUILD_NODE" ]; then
  info "偵測到 node-pty 預編譯二進位（linux-${ARCH_NORM}），跳過編譯工具預檢"
  # 驗證預編譯二進位可被目前 Node.js 載入
  if ! node -e "require('node-pty')" 2>/dev/null; then
    # 預編譯檔存在但無法從全域載入是正常的（node_modules 路徑尚未建立）
    # 只確認 .node 檔案為有效 ELF/binary
    if ! file "$PREBUILD_NODE" 2>/dev/null | grep -qiE "(ELF|shared object|dynamic)"; then
      err "預編譯二進位疑似損毀：$PREBUILD_NODE\n請改用不含 prebuilds 的 tarball，或重新下載。"
    fi
    ok "預編譯二進位格式正常（ELF）"
  else
    ok "預編譯二進位可載入"
  fi
else
  info "未偵測到 node-pty 預編譯二進位，檢查編譯工具鏈 ..."
  MISSING_TOOLS=()
  command -v python3 >/dev/null || MISSING_TOOLS+=("python3")
  command -v gcc     >/dev/null || MISSING_TOOLS+=("gcc")
  command -v make    >/dev/null || MISSING_TOOLS+=("make")

  if [ ${#MISSING_TOOLS[@]} -gt 0 ]; then
    printf "\033[31m[ERROR]\033[0m node-pty 是原生模組，編譯需要：%s\n" "${MISSING_TOOLS[*]}" >&2
    printf "\033[31m[ERROR]\033[0m 請先安裝後再重新執行：\n" >&2

    # 偵測 OS 類型並給出對應安裝指令
    if [ -f /etc/os-release ]; then
      # shellcheck source=/dev/null
      . /etc/os-release
      OS_ID="${ID:-unknown}"
      OS_ID_LIKE="${ID_LIKE:-}"
    else
      OS_ID="unknown"
      OS_ID_LIKE=""
    fi

    case "$OS_ID" in
      ubuntu|debian|linuxmint|pop|elementary|kali)
        printf "\033[33m  sudo apt update && sudo apt install -y build-essential python3\033[0m\n" >&2
        ;;
      rhel|centos|rocky|almalinux|fedora|ol)
        printf "\033[33m  sudo dnf install -y gcc-c++ make python3\033[0m\n" >&2
        ;;
      arch|manjaro|endeavouros)
        printf "\033[33m  sudo pacman -S --needed base-devel python\033[0m\n" >&2
        ;;
      *)
        # 依 ID_LIKE 二次判斷
        case "$OS_ID_LIKE" in
          *debian*|*ubuntu*)
            printf "\033[33m  sudo apt update && sudo apt install -y build-essential python3\033[0m\n" >&2
            ;;
          *rhel*|*fedora*)
            printf "\033[33m  sudo dnf install -y gcc-c++ make python3\033[0m\n" >&2
            ;;
          *arch*)
            printf "\033[33m  sudo pacman -S --needed base-devel python\033[0m\n" >&2
            ;;
          *)
            printf "\033[33m  請依您的 Linux 發行版安裝：build-essential（或等效套件）與 python3\033[0m\n" >&2
            ;;
        esac
        ;;
    esac

    printf "\n\033[36m[*]\033[0m 小提示：若要使用免編譯的 prebuild tarball，請於發布頁下載含有「-prebuild」字樣的版本。\n" >&2
    exit 1
  fi
  ok "編譯工具鏈完整（python3 / gcc / make）"
fi
# ─────────────────────────────────────────────────────────────────────────────

# Node check (need 22.12+)
command -v node >/dev/null || err "Node.js >= 22.12 is required (try: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -)"
NODE_VER=$(node -p "process.versions.node")
NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 22 ]; then
  err "Node.js $NODE_VER detected; require 22.12 or later"
fi
ok "Node.js $NODE_VER"

# Source location: script directory must contain server/ and web/
SRC="$(cd "$(dirname "$0")" && pwd)"
[ -d "$SRC/server" ] || err "Bundle missing: server/ not found in $SRC"
[ -d "$SRC/web" ]    || err "Bundle missing: web/ not found in $SRC"

# ── Upgrade vs fresh-install detection ──────────────────────────────────────
# If INSTALL_DIR/.env exists we treat this as an upgrade:
#   - preserve the existing .env (keeps JWT_SECRET, PORT, HOST, etc.)
#   - skip admin credential prompts (existing user is preserved by the
#     idempotent seed step further down)
#   - stop the systemd service before swapping code so we don't blow up
#     a running process
UPGRADE=0
if [ -f "$INSTALL_DIR/.env" ]; then
  UPGRADE=1
  info "Existing install detected at $INSTALL_DIR — upgrade mode"
  # Stop the service to release file handles before we swap code
  if systemctl list-unit-files | grep -q "^${SERVICE_NAME}.service"; then
    info "Stopping $SERVICE_NAME service"
    systemctl stop "$SERVICE_NAME" 2>/dev/null || true
  fi
fi

# Interactive admin credentials (skipped on upgrade)
if [ "$UPGRADE" = "0" ]; then
  if [ -z "${ADMIN_USERNAME:-}" ]; then
    ADMIN_USERNAME=$(ask "Admin username" "admin")
  fi
  if [ -z "${ADMIN_PASSWORD:-}" ]; then
    while true; do
      read -r -s -p "Admin password (≥10 chars, letters + digits): " ADMIN_PASSWORD; echo
      if [ ${#ADMIN_PASSWORD} -lt 10 ] || ! echo "$ADMIN_PASSWORD" | grep -q '[A-Za-z]' || ! echo "$ADMIN_PASSWORD" | grep -q '[0-9]'; then
        echo "  → too weak, try again"
        continue
      fi
      read -r -s -p "Confirm password: " ADMIN_PASSWORD2; echo
      if [ "$ADMIN_PASSWORD" = "$ADMIN_PASSWORD2" ]; then break; fi
      echo "  → passwords do not match"
    done
  fi

  PORT=$(ask "HTTP port" "$PORT")
  HOST=$(ask "Bind address (use 0.0.0.0 to expose publicly)" "$HOST")
fi

info "Installing into $INSTALL_DIR ($([ "$UPGRADE" = "1" ] && echo upgrade || echo fresh))"
mkdir -p "$INSTALL_DIR" "$DATA_DIR" "$LOG_DIR"

# `cp -r SRC DEST` copies INTO DEST when DEST already exists, producing
# DEST/SRC instead of overwriting. Remove first so cp creates DEST anew.
# This is the upgrade-clobber bug fix: without the rm step a re-install
# would leave the old code at INSTALL_DIR/server/dist/ and nest the new
# code at INSTALL_DIR/server/server/dist/ — systemd keeps serving the
# old build.
rm -rf "$INSTALL_DIR/server" "$INSTALL_DIR/web" "$INSTALL_DIR/shared" "$INSTALL_DIR/deploy"
cp -r "$SRC/server"  "$INSTALL_DIR/server"
cp -r "$SRC/web"     "$INSTALL_DIR/web"
cp -r "$SRC/shared"  "$INSTALL_DIR/shared" 2>/dev/null || true
cp -r "$SRC/deploy"  "$INSTALL_DIR/deploy" 2>/dev/null || true
cp    "$SRC/LICENSE" "$INSTALL_DIR/"      2>/dev/null || true

# Write .env only on fresh install. On upgrade the existing .env is
# preserved so JWT_SECRET / operator-tuned vars (PORT, HOST, ACME_*,
# WEBSITES_*, PHP_FPM_SOCKET_PATH, etc.) stay intact and existing
# sessions don't get invalidated.
if [ "$UPGRADE" = "0" ]; then
  JWT_SECRET=$(node -e 'process.stdout.write(require("crypto").randomBytes(48).toString("hex"))')
  cat > "$INSTALL_DIR/.env" <<EOF
NODE_ENV=production
PORT=$PORT
HOST=$HOST
JWT_SECRET=$JWT_SECRET
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d
DATA_DIR=$DATA_DIR
WEB_DIST=$INSTALL_DIR/web
LOG_LEVEL=info
CORS_ORIGINS=
EOF
  chmod 600 "$INSTALL_DIR/.env"
else
  info "Preserved existing $INSTALL_DIR/.env"
fi

info "Installing shared package runtime dependencies"
# shared/dist/*.js imports `zod` directly; Node's ESM resolver walks
# upward from shared/, not into ../server/node_modules. Without
# shared/node_modules/zod the server crash-loops at boot.
( cd "$INSTALL_DIR/shared" && npm install --omit=dev --no-package-lock --silent ) || err "shared npm install failed"

info "Installing server runtime dependencies"
( cd "$INSTALL_DIR/server" && npm install --omit=dev --no-package-lock --silent ) || err "npm install failed"

info "Running database migrations"
( cd "$INSTALL_DIR/server" \
  && set -a && . "$INSTALL_DIR/.env" && set +a \
  && node -e "
require('dotenv').config({ path: process.env.HOME + '/dinopanel.env', override: false });
const Database = require('better-sqlite3');
const { drizzle } = require('drizzle-orm/better-sqlite3');
const { migrate } = require('drizzle-orm/better-sqlite3/migrator');
const { mkdirSync } = require('fs');
const path = require('path');
const dataDir = process.env.DATA_DIR;
mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'dinopanel.db'));
db.pragma('journal_mode = WAL');
migrate(drizzle(db), { migrationsFolder: path.join(__dirname, 'drizzle') });
db.close();
console.log('migrations applied');
" )

info "Seeding admin user"
( cd "$INSTALL_DIR/server" \
  && set -a && . "$INSTALL_DIR/.env" && set +a \
  && ADMIN_USERNAME="$ADMIN_USERNAME" ADMIN_PASSWORD="$ADMIN_PASSWORD" \
     node -e "
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { mkdirSync } = require('fs');
const path = require('path');
const dataDir = process.env.DATA_DIR;
mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'dinopanel.db'));
db.pragma('journal_mode = WAL');
const existing = db.prepare('SELECT id FROM users LIMIT 1').get();
if (existing) { console.log('user already exists, skipping'); process.exit(0); }
const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 12);
db.prepare('INSERT INTO users (username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)')
  .run(process.env.ADMIN_USERNAME, hash, Date.now(), Date.now());
db.close();
console.log('admin user created');
" )

# ── DinoPanel filesystem tree under /opt/dinopanel ──────────────────────────
# Both websites (v0.3) and databases (v0.4) share `/opt/dinopanel/` as their
# managed root (decisions.md Q2/Q4). install.sh ensures the directories
# exist + applies the correct SELinux label so future runtime mkdirs land
# under a labelled tree on Rocky / RHEL.
DINOPANEL_TREE_ROOT="${DINOPANEL_TREE_ROOT:-/opt/dinopanel}"
DATABASES_ROOT="${DATABASES_ROOT:-${DINOPANEL_TREE_ROOT}/databases}"
WEBSITES_SITES_ROOT="${WEBSITES_SITES_ROOT:-${DINOPANEL_TREE_ROOT}/sites}"

mkdir -p "$DATABASES_ROOT"
relabel_path "$DATABASES_ROOT" "container_file_t"

# v0.3 backfill — /opt/dinopanel/sites was historically relabeled by hand
# on Rocky 234. Apply the same label here so future installs are
# reproducible. Only run when the dir exists (don't pre-create — Websites
# bootstrap mkdir runs at runtime under WEBSITES_ROOT which is operator-
# configurable).
if [ -d "$WEBSITES_SITES_ROOT" ]; then
  relabel_path "$WEBSITES_SITES_ROOT" "httpd_sys_content_t"
fi

info "Installing systemd service"
cp "$INSTALL_DIR/deploy/systemd/dinopanel.service" "/etc/systemd/system/${SERVICE_NAME}.service" 2>/dev/null \
  || cp "$SRC/deploy/systemd/dinopanel.service" "/etc/systemd/system/${SERVICE_NAME}.service"
sed -i "s|/usr/local/dinopanel|$INSTALL_DIR|g" "/etc/systemd/system/${SERVICE_NAME}.service"
sed -i "s|/var/log/dinopanel|$LOG_DIR|g" "/etc/systemd/system/${SERVICE_NAME}.service"
systemctl daemon-reload
systemctl enable "$SERVICE_NAME" >/dev/null
systemctl restart "$SERVICE_NAME"

sleep 2
if systemctl is-active --quiet "$SERVICE_NAME"; then
  ok "DinoPanel is running on http://$HOST:$PORT/"
  ok "Admin user: $ADMIN_USERNAME"
  echo
  echo "  Logs:   journalctl -u $SERVICE_NAME -f"
  echo "  Stop:   sudo systemctl stop $SERVICE_NAME"
  echo "  Start:  sudo systemctl start $SERVICE_NAME"
else
  err "Service failed to start. Check: journalctl -u $SERVICE_NAME -n 50"
fi
