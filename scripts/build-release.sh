#!/usr/bin/env bash
# Build a deployable tarball: server/dist + web/dist + drizzle migrations + deploy files
#
# Usage:
#   bash scripts/build-release.sh                        # standard build（target 機器需 build-essential）
#   bash scripts/build-release.sh --prebuild=x64         # 附帶 linux-x64 預編譯二進位
#   bash scripts/build-release.sh --prebuild=arm64       # 附帶 linux-arm64 預編譯二進位
#   bash scripts/build-release.sh --prebuild=x64 --prebuild=arm64  # 同時附帶兩個 arch
#
# --prebuild 選項說明：
#   在 build 機器上跑 npm rebuild node-pty 後，把 build/Release/pty.node
#   收進 tarball 的 prebuilds/linux-<arch>/ 目錄。安裝端偵測到 prebuilds 後
#   npm install 時的 prebuild.js 會自動跳過 node-gyp rebuild，
#   target 機器不需要安裝 build-essential / python3。
#
# 注意：cross-arch 預編譯（例如在 x64 機器打包 arm64 binaries）需要在對應
#   架構機器上分別執行，或透過 docker buildx + QEMU 進行。
#   未來 CI 可加 matrix: [ubuntu-22.04, ubuntu-22.04-arm] 自動化此步驟
#   （請參閱 docs/deployment.md「未來可加 CI Prebuild」章節）。
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)
VERSION=$(node -p "require('./package.json').version")

# ── 解析 --prebuild 參數 ──────────────────────────────────────────────────────
PREBUILD_ARCHS=()
for arg in "$@"; do
  case "$arg" in
    --prebuild=*)
      arch_val="${arg#--prebuild=}"
      case "$arch_val" in
        x64|arm64) PREBUILD_ARCHS+=("$arch_val") ;;
        *) echo "[ERROR] --prebuild 僅接受 x64 或 arm64，收到：$arch_val" >&2; exit 1 ;;
      esac
      ;;
    *) echo "[ERROR] 不認識的參數：$arg" >&2; exit 1 ;;
  esac
done

# 若要打包 prebuilds，決定 tarball 名稱後綴
if [ ${#PREBUILD_ARCHS[@]} -gt 0 ]; then
  ARCH_SUFFIX="-prebuild-$(IFS='-'; echo "${PREBUILD_ARCHS[*]}")"
  STAGE="release/dinopanel-${VERSION}${ARCH_SUFFIX}"
  TARBALL="release/dinopanel-${VERSION}${ARCH_SUFFIX}.tar.gz"
else
  STAGE="release/dinopanel-${VERSION}"
  TARBALL="release/dinopanel-${VERSION}.tar.gz"
fi

echo "==> Cleaning previous release output"
rm -rf release
mkdir -p "$STAGE"

echo "==> Installing production-ready dependencies + building all packages"
pnpm install --frozen-lockfile
pnpm build

echo "==> Staging server"
mkdir -p "$STAGE/server"
cp -r apps/server/dist                "$STAGE/server/dist"
cp -r apps/server/drizzle             "$STAGE/server/drizzle"
cp    apps/server/package.json        "$STAGE/server/"
cp    apps/server/drizzle.config.ts   "$STAGE/server/"

echo "==> Staging web build output"
mkdir -p "$STAGE/web"
cp -r apps/web/dist/*                 "$STAGE/web/"

echo "==> Staging shared package (ESM dist)"
mkdir -p "$STAGE/shared"
cp -r packages/shared/dist            "$STAGE/shared/dist"
cp    packages/shared/package.json    "$STAGE/shared/"

echo "==> Copying deploy artefacts"
cp -r deploy                          "$STAGE/deploy"
cp    scripts/install.sh              "$STAGE/install.sh"
cp    scripts/uninstall.sh            "$STAGE/uninstall.sh" 2>/dev/null || true
cp    LICENSE README.md               "$STAGE/"
cp    apps/server/.env.example        "$STAGE/.env.example"

# ── Prebuild 二進位收集 ────────────────────────────────────────────────────────
if [ ${#PREBUILD_ARCHS[@]} -gt 0 ]; then
  # 先在 server package 下建立完整 node_modules（若尚不存在）
  # pnpm install --frozen-lockfile 已在上方執行，node-pty 的 build/Release 應已存在
  NODE_PTY_DIR="$(find node_modules/.pnpm -maxdepth 3 -name "node-pty" -type d 2>/dev/null | grep "node_modules/node-pty$" | head -1)"

  if [ -z "$NODE_PTY_DIR" ]; then
    echo "[ERROR] 找不到 node-pty 的 node_modules 路徑，請先執行 pnpm install" >&2
    exit 1
  fi

  CURRENT_MACHINE_ARCH="$(uname -m)"
  case "$CURRENT_MACHINE_ARCH" in
    x86_64|amd64)  CURRENT_NORM="x64"  ;;
    aarch64|arm64) CURRENT_NORM="arm64" ;;
    *) CURRENT_NORM="unknown" ;;
  esac

  for target_arch in "${PREBUILD_ARCHS[@]}"; do
    echo "==> 收集 node-pty prebuild for linux-${target_arch}"

    if [ "$target_arch" != "$CURRENT_NORM" ]; then
      echo "    [WARNING] 目前機器 arch（${CURRENT_NORM}）與目標 arch（${target_arch}）不同"
      echo "    [WARNING] cross-arch prebuild 需在對應架構機器上執行，此 arch 將跳過"
      continue
    fi

    PTY_NODE="${NODE_PTY_DIR}/build/Release/pty.node"
    SPAWN_HELPER="${NODE_PTY_DIR}/build/Release/spawn-helper"

    if [ ! -f "$PTY_NODE" ]; then
      echo "    pty.node 不存在，嘗試重新編譯 ..."
      ( cd "$NODE_PTY_DIR" && node-gyp rebuild 2>&1 ) || {
        echo "[ERROR] node-pty rebuild 失敗，請確認 build-essential / python3 已安裝" >&2
        exit 1
      }
    fi

    DEST_DIR="${STAGE}/server/node_modules/node-pty/prebuilds/linux-${target_arch}"
    mkdir -p "$DEST_DIR"
    cp "$PTY_NODE" "${DEST_DIR}/pty.node"
    [ -f "$SPAWN_HELPER" ] && cp "$SPAWN_HELPER" "${DEST_DIR}/spawn-helper" || true

    echo "    ✓ linux-${target_arch}/pty.node → $(du -sh "${DEST_DIR}/pty.node" | cut -f1)"
  done

  # 確保 node_modules/node-pty 其餘 JS 檔案也一起進 tarball
  # 使用 npm pack 後解壓或直接複製 node-pty 套件到 staging server/node_modules
  # （install.sh 的 npm install 會在 INSTALL_DIR/server 重新 install；
  #   這裡的 prebuilds 只是確保 npm install 時不觸發 rebuild）
  SERVER_PTY_STAGE="${STAGE}/server/node_modules/node-pty"
  if [ ! -d "$SERVER_PTY_STAGE/lib" ]; then
    echo "==> 複製 node-pty 套件到 staging（供 prebuild 路徑生效）"
    mkdir -p "${SERVER_PTY_STAGE}"
    # 複製所有 JS/type 檔案，保留 prebuilds 目錄
    rsync -a --exclude='build/' --exclude='src/' \
      "${NODE_PTY_DIR}/" "${SERVER_PTY_STAGE}/" 2>/dev/null \
      || cp -r "${NODE_PTY_DIR}/." "${SERVER_PTY_STAGE}/"
    # 移除舊的 build/Release（只保留 prebuilds）
    rm -rf "${SERVER_PTY_STAGE}/build" || true
  fi

  echo "==> Prebuild 完成：附帶 arch：${PREBUILD_ARCHS[*]}"
  echo "    使用此 tarball 安裝時，target 機器不需要 build-essential / python3"
fi
# ─────────────────────────────────────────────────────────────────────────────

echo "==> Generating release tarball"
STAGE_DIRNAME="$(basename "$STAGE")"
( cd release && tar -czf "../$TARBALL" "$STAGE_DIRNAME" )

du -sh "$TARBALL"
echo "==> Release ready at $TARBALL"
if [ ${#PREBUILD_ARCHS[@]} -gt 0 ]; then
  echo "    （含 prebuild：安裝端免 build-essential）"
fi
