#!/usr/bin/env bash
# Remove DinoPanel installation.
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/usr/local/dinopanel}"
DATA_DIR="${DATA_DIR:-/var/lib/dinopanel}"
LOG_DIR="${LOG_DIR:-/var/log/dinopanel}"
SERVICE_NAME="dinopanel"

[ "$(id -u)" -eq 0 ] || { echo "Must run as root"; exit 1; }

echo "This will remove:"
echo "  - service:     $SERVICE_NAME"
echo "  - install dir: $INSTALL_DIR"
echo "  - logs:        $LOG_DIR"
echo
read -r -p "Also delete data directory ($DATA_DIR, includes accounts)? [y/N] " del
echo

systemctl stop "$SERVICE_NAME" 2>/dev/null || true
systemctl disable "$SERVICE_NAME" 2>/dev/null || true
rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
systemctl daemon-reload

rm -rf "$INSTALL_DIR" "$LOG_DIR"
if [[ "$del" =~ ^[Yy]$ ]]; then
  rm -rf "$DATA_DIR"
  echo "Data directory removed."
else
  echo "Data directory preserved: $DATA_DIR"
fi
echo "Done."
