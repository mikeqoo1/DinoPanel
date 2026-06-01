# DinoPanel

[English](./README.md)

> 現代化 Linux 主機管理面板，以 TypeScript + React + NestJS 打造。

DinoPanel 是自架的單機 Linux 主機控制台，透過簡潔的網頁介面集中管理檔案、終端機、容器、自動申請 SSL 的網站、防火牆、排程任務與日誌中心等。整個專案為獨立的 clean-room reimplementation，靈感取自業界一流的管理面板，但範圍刻意修剪到一個維護者能持續產出的程度。

> **狀態：** Pre-1.0，持續開發中。截至 **v0.5** 已涵蓋容器、網站 + ACME SSL、**資料庫（MySQL / MariaDB / PostgreSQL / Redis / MongoDB）+ PMM PromQL 摘要卡**、**資料庫備份 + 還原（隨需或排程、keep-last-N 保留、原地還原）**、防火牆、排程、日誌中心。已在 Rocky Linux 9.4 production-class 機器（Xeon Gold 5218、600+ 天 uptime）完成端到端 smoke 驗證；v0.5.0 備份也在同台機器 smoke 過。下一站 v0.6（工具箱）。

## 功能

### 核心（v0.1）

- **儀錶板** — CPU / 記憶體 / 磁碟 / 網路即時指標（1 Hz 更新）
- **網頁 SSH 終端機** — 多分頁、完整 xterm.js shell（WebSocket 傳輸）
- **檔案管理** — 瀏覽、編輯（Monaco）、上傳、下載、壓縮、權限調整
- **認證** — JWT + Refresh Token 輪轉、bcrypt 密碼雜湊
- **設定** — 語言（繁中 / 英）、佈景主題（淺 / 深 / 系統）、帳號管理

### 容器（v0.2）

- Docker 容器 CRUD（啟動 / 停止 / 重啟 / 移除 / 詳情）
- 映像管理（pull、tag、清理）
- 網路 + Volume 管理
- Docker Compose stack 編輯器（Monaco YAML 語法高亮）
- PMM 整合（連結 Percona Monitoring 的卡片）

### 網站 + ACME（v0.3，v0.4 擴充）

- 三種站點類型：靜態網站 / 反向代理 / PHP-FPM
- Host 端 nginx 整合：atomic conf 寫入 + `nginx -t` 失敗自動 rollback
- 對帳 / 孤兒偵測 — 衝突時磁碟內容優先
- **v0.4 — 外部 conf 匯入**：對帳會掃 `/etc/nginx/conf.d/*.conf`，把 operator 自管的 conf 以 `External` 唯讀列呈現
- **v0.4 — PHP-FPM 自動供裝**：`PHP_FPM_SOCKET_PATH` 留空即進 managed 模式，DinoPanel 自己跑 `php:8.3-fpm`，最後一個 PHP 站移除後自動停
- Let's Encrypt 憑證申請：HTTP-01 + Cloudflare DNS-01
- **v0.4 — `ACME_EMAIL` 設定 UI**（env 優先、settings fallback）
- 每 12 小時自動續憑（透過 v0.5 scheduler），有效期 ≤ 30 天時觸發
- 全部 DinoPanel 管的檔案都在 `/opt/dinopanel/` 一棵樹下（好備份、好移除）

### 資料庫（v0.4）

- 五種引擎、全容器化：MySQL 8 / MariaDB 11 / PostgreSQL 16 / Redis 7 / MongoDB 7
- 資料目錄 bind-mount 在 `/opt/dinopanel/databases/<engine>/<instance>/` — 直接 `ls`/`tar`/`du`，免 named volume
- 連線卡顯示明文帳密 + 複製 / 輪換（decisions.md Q3：別把 DinoPanel 跑在會曝露資料目錄的主機上）
- 6 步原子建立 + rollback（驗證 → mkdir → SELinux relabel → dockerode 建立 → 啟動 → DB 寫入）
- Drawer 內嵌 PMM PromQL 摘要卡：QPS / 連線數 / uptime / 複寫延遲，server 端 fan-out 快取 30 秒；未設定時退回 v0.2.1 的「Open in PMM」連結卡
- `Sheet` drawer primitive（也回頭套用到 `/websites`）

### 資料庫備份（v0.5）

- 邏輯式（dump）逐引擎備份：`mysqldump` / `pg_dumpall` / `mongodump` / Redis `BGSAVE`+RDB — 串流匯出、host 端 gzip
- DB drawer 的 **Backups** 分頁隨需備份，或用 `db_backup` cron 任務排程（複用 v0.5 scheduler）
- keep-last-N 保留，以 `(instance, group)` 為單位；手動備份豁免
- 原地還原 + 打字確認防呆（drop + 在同一容器內重建）；Redis 還原會短暫重啟容器
- 本機儲存於 `/opt/dinopanel/backups/<engine>/<instance>/`（0700 樹、0600 檔）；`/backups` 走認證 blob 下載
- 詳見 [`docs/backups.md`](./docs/backups.md)

### 系統營運（v0.5）

- **防火牆** — ufw + firewalld 自動偵測，每筆規則改動有 30 秒 rollback 保險（沒按確認就自動回滾）
- **排程任務** — cron 驅動的 runner：shell、檔案備份、日誌清理、服務重啟、HTTP 請求、**資料庫備份（v0.5.0 `db_backup`）**，內建 audit log purge
- **日誌中心** — 系統 / SSH / 操作 / 登入 / 任務 / 網站日誌瀏覽，cursor 分頁 + WebSocket 即時尾追
- **稽核 interceptor** — 每個寫入型 API 呼叫都會寫一筆 `operation_log`，敏感欄位 redacted，可配置保留天數

## 路線圖

| 版本 | 範圍 | 狀態 |
| ---- | ---- | ---- |
| v0.1 | MVP — 儀錶板 / 終端 / 檔案 / 認證 | ✅ 已 ship |
| v0.2 | 容器（Docker + Compose） | ✅ 已 ship |
| v0.5 | 防火牆 + 排程 + 日誌中心 | ✅ 已 ship |
| v0.3 | 網站 + ACME SSL | ✅ 已 ship（Rocky 9.4 smoke S1/S2/S3/S7 過） |
| v0.4 | 資料庫（5 引擎全容器）+ PMM 摘要卡 + v0.3 收尾（Sheet drawer、auto-provision PHP-FPM、ACME_EMAIL UI、外部 conf 對帳） | ✅ 已 ship |
| v0.4.1–4.8 | smoke 修補 + PMM 系列迭代（PMM 3.x API、TLS 預設、deep-link、Settings UI、版本 badge 位置） | ✅ 已 ship |
| v0.5.0 | 資料庫備份 + 還原 — 邏輯 dump（5 引擎）、本機儲存、隨需 + 排程（`db_backup`）、keep-last-N 保留、原地還原 | ✅ 已 ship（Rocky 234 smoke S1–S4 過） |
| v0.6 | 工具箱（Fail2Ban / Supervisor / Swap / NTP）+ MFA + Passkey | 規劃中 |
| v1.0 | 穩定版 + 完整 i18n | 規劃中 |

App Store / 模板式一鍵安裝在 v0.2 時永久移除 — 每個模組改成自己負責安裝路徑。

## 技術選型

| 層級     | 採用                                              |
| -------- | ------------------------------------------------- |
| 前端     | React 19 + Vite 6 + TypeScript 5                  |
| UI       | Tailwind CSS 4 + shadcn/ui + Radix                |
| 後端     | NestJS 11 + Fastify 5 + TypeScript 5              |
| 資料庫   | SQLite（better-sqlite3）+ Drizzle ORM 0.36        |
| 即時通訊 | 原生 WebSocket（不使用 Socket.IO）                |
| 終端機   | @xterm/xterm + node-pty                           |
| 編輯器   | Monaco Editor                                     |
| 排程     | node-cron + cron-parser                           |
| ACME     | acme-client（純 Node，不依賴 Python / Go）        |

## 開發

```sh
# 需求：Node 22 LTS、pnpm 9
corepack enable

# 安裝依賴
pnpm install

# 啟動開發伺服器（後端 + 前端同時跑）
pnpm dev

# 型別檢查與 lint
pnpm typecheck
pnpm lint

# 跑單元測試（server 313 + web 26 + shared）
pnpm test

# 建置 production bundle
pnpm build
```

## 部署

```sh
# 打 release tarball（含 node-pty 的 x64 預編譯，目標機免裝 build-essential / python3）
bash scripts/build-release.sh --prebuild=x64

# 把 tarball 丟到目標機，然後在目標機上：
tar -xzf dinopanel-0.5.0-prebuild-x64.tar.gz
cd dinopanel-0.5.0-prebuild-x64
sudo bash install.sh
```

`install.sh` 已升級成 upgrade-safe（自 `70a8d48` 起）：

- 在現有 install 上重跑會保留 `.env`（JWT_SECRET 不會被重生、operator 自訂的環境變數不會被清掉）
- 升級時跳過 admin 帳密 prompt
- 在覆寫程式碼前先停 systemd 服務、atomic 清空目標目錄，避免 `cp -r` 巢狀塞入的問題

網站模組要動起來，目標機需要安裝 nginx（systemd 啟動）並且 80 / 443 port 沒被佔。SELinux / AppArmor relabel 細節與選用的 sudoers 設定請看 [`docs/websites.md`](./docs/websites.md)。

## 專案結構

```
apps/
  web/                # React + Vite 前端（SPA）
  server/             # NestJS 後端（REST + WebSocket）
packages/
  shared/             # 共用 Zod schema、WS 通訊協定型別、錯誤碼
scripts/              # install.sh（upgrade-safe）、build-release.sh
deploy/               # systemd unit、nginx 範例
docs/                 # 架構、網站、ACME、防火牆、排程、日誌等文件
.arceus/changes/      # 每個版本的 change proposal + decisions + tasks
release/              # 打好的 tarball（內容 gitignored）
```

## 文件

- [架構](./docs/architecture.md) — 模組邊界、request 生命週期
- [網站](./docs/websites.md) — Site CRUD、nginx 整合、sudoers、SELinux
- [ACME](./docs/acme.md) — 申請流程、Cloudflare DNS-01 設定、自動續憑
- [資料庫](./docs/databases.md) — 5 引擎容器化 DB、PMM 卡、帳密
- [備份](./docs/backups.md) — 邏輯 dump、保留、排程 + 原地還原
- [防火牆](./docs/firewall.md) — ufw / firewalld driver、rollback 保險
- [排程](./docs/scheduler.md) — cron 任務、runner、內建 purge dogfood
- [日誌](./docs/logs.md) — 五個日誌來源、保留策略、audit interceptor
- [部署](./docs/deployment.md) — 生產環境安裝 + 升級流程

## 授權

[Apache License 2.0](./LICENSE)
