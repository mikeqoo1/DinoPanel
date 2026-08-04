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
# 原生套件宣告為 range（better-sqlite3 ^12.0.0 / node-pty ^1.0.0），而這裡用
# --no-package-lock，所以 npm 會在安裝當下解析到最新的相容版本 — 可能不是這份
# tarball 建置與測試時的版本，也就與隨附的預編譯 .node 不符。若 tarball 帶了
# prebuilds 的 .version，就把這兩個套件釘到相同版本：預編譯檔直接可用（免網路、
# 免編譯），且生產跑的是實際測過的版本。缺 .version（未帶 prebuild 的 tarball）
# 時 NATIVE_PINS 為空，行為與過去完全相同。
NATIVE_PINS=""
for _spec in "better-sqlite3:better_sqlite3" "node-pty:pty"; do
  _p="${_spec%%:*}"
  _b="${_spec##*:}"
  _vf="$SRC/server/node_modules/${_p}/prebuilds/linux-${ARCH_NORM}/${_b}.version"
  if [ -f "$_vf" ]; then
    NATIVE_PINS="$NATIVE_PINS ${_p}@$(cat "$_vf")"
  fi
done
[ -n "$NATIVE_PINS" ] && info "釘住原生套件版本以配合隨附預編譯檔：${NATIVE_PINS# }"
# shellcheck disable=SC2086 # NATIVE_PINS 需要 word-splitting 成多個套件參數
( cd "$INSTALL_DIR/server" && npm install --omit=dev --no-package-lock --no-save --silent $NATIVE_PINS ) \
  || err "npm install failed"

# ── 原生模組預檢與修復 ────────────────────────────────────────────────────────
# npm >= 12 預設不執行套件的 install script（除非列入 allowScripts），所以上面
# 的 npm install 會「成功」但 better-sqlite3 / node-pty 完全沒編譯。沒有這一段
# 的話，失敗會延後到下面的 migration 步驟才以看不懂的
# `Could not locate the bindings file` 爆出來，而且服務已經被停掉 —
# 2026-08-04 v0.6.2 部署 Rocky 234 就是這樣停擺的。
#
# 修復來源是 $SRC（解開後的 tarball），npm 不會動它。只有在預編譯檔的版本與
# 實際安裝的版本相符時才敢複製 — install.sh 用 --no-package-lock，npm 會解析
# 到最新的 semver 相容版本，硬塞不同版本的 .node 可能載入後才在呼叫時炸掉。
#
# ponytail: 不自動跑 node-gyp 編譯 — 走到那一步表示 tarball 預編譯檔與
# prebuild-install 都失敗了，那需要人看一眼；這裡改為印出兩條修復指令。
# better-sqlite3 的 binding 是延遲載入的：require() 會過，只有真的 new Database()
# 時才會拋 `Could not locate the bindings file` — v0.6.2 部署就是這樣讓 install.sh
# 一路走到 migration 才爆掉。所以這裡必須實際建一個 :memory: 連線才算驗過。
# node-pty 相反，require() 就會立刻載入 .node，一般檢查即可。
native_ok() {
  case "$1" in
    better-sqlite3)
      ( cd "$INSTALL_DIR/server" \
          && node -e "new (require('better-sqlite3'))(':memory:').close()" >/dev/null 2>&1 ) ;;
    *)
      ( cd "$INSTALL_DIR/server" && node -e "require('$1')" >/dev/null 2>&1 ) ;;
  esac
}

installed_pkg_version() {
  node -e "try{process.stdout.write(require('$INSTALL_DIR/server/node_modules/$1/package.json').version)}catch(e){}" 2>/dev/null
}

repair_from_tarball() {
  local pkg="$1" bin="$2"
  local src_dir="$SRC/server/node_modules/$pkg/prebuilds/linux-${ARCH_NORM}"
  [ -f "$src_dir/$bin" ] || return 1
  local vfile="$src_dir/${bin%.node}.version"
  if [ -f "$vfile" ]; then
    local shipped want
    shipped="$(cat "$vfile")"
    want="$(installed_pkg_version "$pkg")"
    if [ -n "$want" ] && [ "$shipped" != "$want" ]; then
      info "$pkg：tarball 預編譯檔為 $shipped，實際安裝 $want — 版本不符，不使用"
      return 1
    fi
  fi
  mkdir -p "$INSTALL_DIR/server/node_modules/$pkg/build/Release"
  cp -f "$src_dir/$bin" "$INSTALL_DIR/server/node_modules/$pkg/build/Release/$bin" || return 1
  if [ -f "$src_dir/spawn-helper" ]; then
    cp -f "$src_dir/spawn-helper" "$INSTALL_DIR/server/node_modules/$pkg/build/Release/spawn-helper" || true
  fi
  return 0
}

repair_with_prebuild_install() {
  local pkg="$1"
  local bindir="$INSTALL_DIR/server/node_modules/.bin"
  [ -x "$bindir/prebuild-install" ] || return 1
  ( cd "$INSTALL_DIR/server/node_modules/$pkg" \
      && PATH="$bindir:$PATH" prebuild-install >/dev/null 2>&1 ) || return 1
  return 0
}

info "Verifying native modules (better-sqlite3 / node-pty)"
for _spec in "better-sqlite3:better_sqlite3.node" "node-pty:pty.node"; do
  _pkg="${_spec%%:*}"
  _bin="${_spec##*:}"

  if native_ok "$_pkg"; then
    ok "$_pkg 原生模組可載入"
    continue
  fi

  info "$_pkg 原生模組缺失或不可載入 — 嘗試修復（npm >= 12 預設不執行 install script）"

  if repair_from_tarball "$_pkg" "$_bin" && native_ok "$_pkg"; then
    ok "$_pkg 已由 tarball 預編譯檔修復"
    continue
  fi

  if repair_with_prebuild_install "$_pkg" && native_ok "$_pkg"; then
    ok "$_pkg 已由 prebuild-install 取得官方預編譯檔"
    continue
  fi

  err "$_pkg 原生模組無法載入，安裝在 migration 與 systemctl restart 之前中止。
（$INSTALL_DIR 的檔案已被替換，但服務尚未重啟 — 既有的執行中實例仍以舊程式服務，
  不會像沒有這道預檢時那樣被留在停止狀態。）

npm >= 12 預設封鎖套件 install script，因此 better-sqlite3 / node-pty 不會自動編譯。
請在 $INSTALL_DIR/server 手動修復其中一種：

  # 取官方預編譯檔（需連得到 GitHub）
  cd $INSTALL_DIR/server/node_modules/$_pkg
  PATH=$INSTALL_DIR/server/node_modules/.bin:\$PATH prebuild-install

  # 或從原始碼編譯（需 gcc / g++ / make / python3）
  cd $INSTALL_DIR/server/node_modules/$_pkg && npx node-gyp rebuild --release

完成後以 'cd $INSTALL_DIR/server && node -e \"require(\\\"$_pkg\\\")\"' 驗證，再重跑 install.sh。"
done

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

# Seed admin only on fresh installs. On upgrade the admin already
# exists (seed step would skip anyway, but `set -u` blows up earlier
# on the unbound ADMIN_USERNAME/PASSWORD env vars we deliberately
# never collected in upgrade mode).
if [ "$UPGRADE" = "0" ]; then
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
else
  info "Skipping admin seed (upgrade mode — admin preserved)"
fi

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
  # On upgrade we never collected ADMIN_USERNAME — fall back to a
  # placeholder so `set -u` doesn't blow up at the very last line.
  ok "Admin user: ${ADMIN_USERNAME:-(preserved from prior install)}"
  echo
  echo "  Logs:   journalctl -u $SERVICE_NAME -f"
  echo "  Stop:   sudo systemctl stop $SERVICE_NAME"
  echo "  Start:  sudo systemctl start $SERVICE_NAME"
  echo
  echo "  Sudoers (host tools run as an unprivileged user via sudo -n):"
  echo "    • Websites : /etc/sudoers.d/dinopanel          — see docs/websites.md"
  echo "    • Toolbox  : /etc/sudoers.d/dinopanel-toolbox  — see docs/toolbox.md"
  echo "      (NTP / fail2ban / journald+package+docker cleaners; one Cmnd_Alias)"
  echo "      Validate with: sudo visudo -cf /etc/sudoers.d/dinopanel-toolbox"
else
  err "Service failed to start. Check: journalctl -u $SERVICE_NAME -n 50"
fi
