# DinoPanel

[English](./README.md)

> 現代化 Linux 主機管理面板，以 TypeScript + React + NestJS 打造。

DinoPanel 是自架的單機 Linux 主機控制台，透過簡潔的網頁介面集中管理檔案、終端機、容器、自動申請 SSL 的網站、防火牆、排程任務與日誌中心等。整個專案為獨立的 clean-room reimplementation，靈感取自業界一流的管理面板，但範圍刻意修剪到一個維護者能持續產出的程度。

> **狀態：** Pre-1.0，持續開發中。截至 v0.3 已涵蓋容器、網站 + ACME SSL、防火牆、排程、日誌中心。已在 Rocky Linux 9.4 production-class 機器（Xeon Gold 5218、600+ 天 uptime）完成端到端 smoke 驗證。下一站 v0.4（資料庫）。

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

### 網站 + ACME（v0.3）

- 三種站點類型：靜態網站 / 反向代理 / PHP-FPM
- Host 端 nginx 整合：atomic conf 寫入 + `nginx -t` 失敗自動 rollback
- 對帳 / 孤兒偵測 — 衝突時磁碟內容優先
- Let's Encrypt 憑證申請：HTTP-01 + Cloudflare DNS-01
- 每 12 小時自動續憑（透過 v0.5 scheduler），有效期 ≤ 30 天時觸發
- 全部 DinoPanel 管的檔案都在 `/opt/dinopanel/` 一棵樹下（好備份、好移除）

### 系統營運（v0.5）

- **防火牆** — ufw + firewalld 自動偵測，每筆規則改動有 30 秒 rollback 保險（沒按確認就自動回滾）
- **排程任務** — cron 驅動的 runner：shell、檔案備份、日誌清理、服務重啟、HTTP 請求，內建 audit log purge
- **日誌中心** — 系統 / SSH / 操作 / 登入 / 任務 / 網站日誌瀏覽，cursor 分頁 + WebSocket 即時尾追
- **稽核 interceptor** — 每個寫入型 API 呼叫都會寫一筆 `operation_log`，敏感欄位 redacted，可配置保留天數

## 路線圖

| 版本 | 範圍 | 狀態 |
| ---- | ---- | ---- |
| v0.1 | MVP — 儀錶板 / 終端 / 檔案 / 認證 | ✅ 已 ship |
| v0.2 | 容器（Docker + Compose） | ✅ 已 ship |
| v0.5 | 防火牆 + 排程 + 日誌中心 | ✅ 已 ship |
| v0.3 | 網站 + ACME SSL | ✅ 已 ship（Rocky 9.4 smoke S1/S2/S3/S7 過） |
| v0.4 | 資料庫（MySQL / MariaDB / PostgreSQL / Redis / MongoDB）+ v0.3 收尾（SecretsService、Drawer primitive、auto-provision PHP-FPM） | 📋 草稿 |
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

# 跑單元測試（目前 169 passing）
pnpm test

# 建置 production bundle
pnpm build
```

## 部署

```sh
# 打 release tarball（含 node-pty 的 x64 預編譯，目標機免裝 build-essential / python3）
bash scripts/build-release.sh --prebuild=x64

# 把 tarball 丟到目標機，然後在目標機上：
tar -xzf dinopanel-0.3.0-prebuild-x64.tar.gz
cd dinopanel-0.3.0-prebuild-x64
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
- [防火牆](./docs/firewall.md) — ufw / firewalld driver、rollback 保險
- [排程](./docs/scheduler.md) — cron 任務、runner、內建 purge dogfood
- [日誌](./docs/logs.md) — 五個日誌來源、保留策略、audit interceptor
- [部署](./docs/deployment.md) — 生產環境安裝 + 升級流程

## 授權

[Apache License 2.0](./LICENSE)
