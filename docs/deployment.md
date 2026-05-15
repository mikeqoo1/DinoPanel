# Deployment

DinoPanel is a single-binary-style deployment: one Node process serves the API, WebSockets, and the React SPA on the same port.

## Requirements

- Linux (x86_64 or aarch64)
- Node.js **22.12 LTS or later** (uses `require(esm)` stable feature)
- Run as root (the panel manages the whole machine: files, services, containers, …)

## 為何需要 root

DinoPanel 需要以 root 身份執行，原因與其管理的功能直接相關：

| 功能 | 所需權限 |
|---|---|
| 檔案管理（全磁碟瀏覽、讀寫任意路徑） | 讀取 root-owned 或 mode 600/700 的檔案 |
| systemd service 管理（start / stop / enable） | `CAP_SYS_ADMIN` 或 root |
| 防火牆（iptables / nftables / ufw） | root |
| 容器（Docker daemon socket `/var/run/docker.sock`） | root 或 docker group（建議 root）|

業界同類方案（1Panel、Cockpit、Webmin）皆以 root 執行。DinoPanel 採相同策略，確保功能完整性與一致性。

**開發環境（非 root）**：以非 root 帳號執行 `pnpm dev` 是允許的。伺服器啟動時會印出 warning，並列出受限功能，但不會崩潰。前端 Files 頁面的預設路徑會自動顯示目前使用者的 home 目錄。

## 依賴需求（Native Module）

DinoPanel 使用 **node-pty**（C++ native module）提供 Web SSH 終端機功能。

### 標準 tarball（不含 prebuild）

target 機器需要安裝編譯工具鏈，否則 `npm install` 時 node-pty 會無法編譯並中止：

| 發行版 | 安裝指令 |
|---|---|
| Ubuntu / Debian | `sudo apt update && sudo apt install -y build-essential python3` |
| RHEL / Rocky / AlmaLinux | `sudo dnf install -y gcc-c++ make python3` |
| Arch Linux | `sudo pacman -S --needed base-devel python` |

`install.sh` 在執行 `npm install` **之前**會自動預檢 `python3`、`gcc`、`make` 是否存在，若缺少會印出對應安裝指令並中止，避免在 minimal 系統上安裝到一半失敗。

### Prebuild tarball（免編譯）

若使用含有 `-prebuild-x64` 或 `-prebuild-arm64` 後綴的 tarball，node-pty 的
precompiled binary 已打包進去。`install.sh` 偵測到 `prebuilds/linux-<arch>/pty.node`
後會**跳過編譯工具鏈預檢**，target 機器不需要 build-essential / python3。

## Prebuild 使用方式

### 打包含 prebuild 的 tarball

在有 build-essential 的 build 機器上執行：

```sh
# 打包 linux-x64 prebuild
bash scripts/build-release.sh --prebuild=x64
# → release/dinopanel-0.1.0-prebuild-x64.tar.gz

# 打包 linux-arm64 prebuild（須在 arm64 機器執行）
bash scripts/build-release.sh --prebuild=arm64
# → release/dinopanel-0.1.0-prebuild-arm64.tar.gz

# 兩個 arch 同時打包（各自在對應機器上執行後手動合併，或透過 CI）
bash scripts/build-release.sh --prebuild=x64 --prebuild=arm64
```

> **Cross-arch 說明**：`--prebuild=arm64` 必須在 arm64 機器上執行（或透過 QEMU/docker buildx）。在 x64 機器指定 `--prebuild=arm64` 時，build-release.sh 會印出 warning 並跳過該 arch。

### 安裝端使用 prebuild tarball

```sh
# 下載含 prebuild 的版本（以 x64 為例）
curl -fsSL https://your-host/dinopanel-0.1.0-prebuild-x64.tar.gz | tar -xz
cd dinopanel-0.1.0-prebuild-x64

# 安裝（無需 build-essential）
sudo bash install.sh
```

### 未來可加 CI Prebuild

目前 GitHub Actions release workflow 尚未建立。未來可加 build matrix 自動化 prebuild：

```yaml
# 參考設計（尚未實作）
jobs:
  build:
    strategy:
      matrix:
        runner: [ubuntu-22.04, ubuntu-22.04-arm]
    runs-on: ${{ matrix.runner }}
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install --frozen-lockfile
      - run: bash scripts/build-release.sh --prebuild=x64   # x64 runner
      #      bash scripts/build-release.sh --prebuild=arm64  # arm64 runner
      - uses: actions/upload-artifact@v4
        with:
          path: release/*.tar.gz
```

搭配 `actions/release-artifacts` 即可在 release 頁面同時提供標準版與 prebuild 版下載。

## Quick install

```sh
# 1. download a release tarball (built by scripts/build-release.sh)
curl -fsSL https://your-host/dinopanel-0.1.0.tar.gz | tar -xz
cd dinopanel-0.1.0

# 2. interactive install
sudo bash install.sh
```

The installer:

- Validates Node version
- Prompts for admin username, password, port (default 9999), bind address (default `127.0.0.1`)
- Generates a 96-character JWT secret with `openssl rand`
- Copies files to `/usr/local/dinopanel/`
- Stores SQLite + WAL in `/var/lib/dinopanel/`
- Writes logs to `/var/log/dinopanel/`
- Installs and starts a systemd unit `dinopanel.service`

## Non-interactive install

```sh
sudo ADMIN_USERNAME=admin ADMIN_PASSWORD='Tr0ub4dor!42' PORT=9999 HOST=0.0.0.0 \
  bash install.sh
```

## Exposing to the network

By default, DinoPanel binds to `127.0.0.1` only. To expose it:

1. **Re-run with `HOST=0.0.0.0`** (the panel listens on all interfaces directly), **or**
2. **Use nginx as a TLS-terminating reverse proxy** — see `deploy/nginx/dinopanel.conf.example`.

The nginx route is recommended in production because it gives you HTTPS via Let's Encrypt and an extra layer of access control.

## Operations

| Action | Command |
|---|---|
| Tail logs | `journalctl -u dinopanel -f` |
| Restart | `sudo systemctl restart dinopanel` |
| Stop | `sudo systemctl stop dinopanel` |
| Status | `sudo systemctl status dinopanel` |
| Uninstall | `sudo bash uninstall.sh` |

## File layout after install

```
/usr/local/dinopanel/        # binaries, web bundle, runtime deps
├── .env                     # generated config (chmod 600)
├── server/dist/             # NestJS compiled output
├── server/node_modules/     # runtime deps installed via npm
├── server/drizzle/          # SQL migrations
├── web/                     # built React SPA
├── shared/dist/             # shared schemas (ESM)
└── deploy/                  # systemd unit + nginx example

/var/lib/dinopanel/          # persistent data
└── dinopanel.db             # SQLite (users, sessions, settings)

/var/log/dinopanel/          # appended logs
└── server.log
```

## Upgrading

1. Stop the service: `sudo systemctl stop dinopanel`
2. Extract the new tarball over the install dir (preserves `.env` if you skip `.env`)
3. Run migrations from the new release: `cd /usr/local/dinopanel/server && pnpm db:migrate`
4. Restart: `sudo systemctl start dinopanel`

## Building a release locally

```sh
pnpm install
pnpm build
bash scripts/build-release.sh
# → release/dinopanel-0.1.0.tar.gz
```

The tarball is self-contained (web + server + migrations + install script).

## Security checklist before going live

- [ ] Use a strong admin password (≥10 chars, mixed)
- [ ] Bind to `127.0.0.1` and front with nginx + TLS for public access
- [ ] Configure `CORS_ORIGINS` in `.env` if exposing the API to external origins
- [ ] Place behind a firewall (`ufw`, `firewalld`) — only expose 443
- [ ] Schedule regular SQLite backups (`/var/lib/dinopanel/dinopanel.db`)
- [ ] Subscribe to security advisories for upstream deps (NestJS, fastify, node-pty)
- [ ] Run `node --version` periodically; bump to latest LTS

## Troubleshooting

**Service fails to start with `EADDRINUSE`** — another process is using port 9999.
Find it: `sudo ss -tlnp | grep 9999`.

**`node-pty` fails to load** — the prebuild was incompatible with your Node version.
Rebuild: `cd /usr/local/dinopanel/server && npm rebuild node-pty`.

**Web SPA shows 404 on refresh** — make sure your reverse proxy forwards all paths to upstream, not just `/api`.

**WebSocket disconnects under nginx** — nginx default `proxy_read_timeout` of 60s closes idle WS. Set `proxy_read_timeout 86400s;` and ensure `proxy_set_header Upgrade $http_upgrade;`.
