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

[ "$(id -u)" -eq 0 ] || err "Must run as root (try: sudo bash $0)"

# Detect platform
case "$(uname -s)" in
  Linux) ;;
  *) err "Only Linux is supported" ;;
esac
case "$(uname -m)" in
  x86_64|amd64|aarch64|arm64) ;;
  *) err "Unsupported architecture: $(uname -m)" ;;
esac

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

# Interactive admin credentials
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

info "Installing into $INSTALL_DIR"
mkdir -p "$INSTALL_DIR" "$DATA_DIR" "$LOG_DIR"
cp -r "$SRC/server"  "$INSTALL_DIR/server"
cp -r "$SRC/web"     "$INSTALL_DIR/web"
cp -r "$SRC/shared"  "$INSTALL_DIR/shared" 2>/dev/null || true
cp -r "$SRC/deploy"  "$INSTALL_DIR/deploy" 2>/dev/null || true
cp    "$SRC/LICENSE" "$INSTALL_DIR/"      2>/dev/null || true

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
