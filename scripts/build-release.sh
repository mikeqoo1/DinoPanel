#!/usr/bin/env bash
# Build a deployable tarball: server/dist + web/dist + drizzle migrations + deploy files
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)
VERSION=$(node -p "require('./package.json').version")
STAGE="release/dinopanel-${VERSION}"
TARBALL="release/dinopanel-${VERSION}.tar.gz"

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

echo "==> Generating release tarball"
( cd release && tar -czf "../$TARBALL" "dinopanel-${VERSION}" )

du -sh "$TARBALL"
echo "==> Release ready at $TARBALL"
