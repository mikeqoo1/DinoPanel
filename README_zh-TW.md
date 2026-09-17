# DinoPanel

[English](./README.md)

> 現代化 Linux 主機管理面板，以 TypeScript + React + NestJS 打造。

DinoPanel 是自架的單機 Linux 主機控制台，透過簡潔的網頁介面集中管理檔案、終端機、容器、自動申請 SSL 的網站、防火牆、排程任務與日誌中心等。整個專案為獨立的 clean-room reimplementation，靈感取自業界一流的管理面板，但範圍刻意修剪到一個維護者能持續產出的程度。

> **狀態：** Pre-1.0，持續開發中。截至 **v0.6.2** 已涵蓋容器、網站 + ACME SSL、**資料庫（MySQL / MariaDB / PostgreSQL / Redis / MongoDB）+ PMM PromQL 摘要卡**、**資料庫備份 + 還原（隨需或排程、keep-last-N 保留、原地還原）**、防火牆、排程、日誌中心、**主機工具箱（NTP / 時間同步、Fail2Ban、磁碟用量 + 策展型清理、systemd 服務管理）**，以及**遠端節點唯讀監控（agentless SSH — CPU / 記憶體 / 磁碟 / uptime + Docker 容器清單/狀態；不對遠端執行寫入操作）**。已在 Rocky Linux 9.4 production-class 機器（Xeon Gold 5218、600+ 天 uptime）完成端到端 smoke 驗證；v0.5.0 備份也在同台機器 smoke 過。下一站 v0.7（帳號安全）。

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

### 工具箱（v0.6）

- **NTP / 時間同步** — 讀取同步狀態（`timedatectl` + 選配 `chronyc`）、開關 NTP 服務、改系統時區（對主機自身的時區清單做 allowlist 驗證）
- **Fail2Ban** — 唯讀 jail 清單（即時計數器 + 已封 IP）、手動封鎖、逐 IP 解封（原地擴充 firewall 模組）
- **磁碟** — `df` 檔案系統用量 + 對封閉 root allowlist 的 `du` 逐目錄分解，加上策展型 tool-owned 清理（journald vacuum / 套件快取 clean / docker prune — 無任意路徑刪除）
- 主機 binary 缺席時各工具優雅降級（503 / availability 旗標）；寫入型操作走單一 `sudo -n` NOPASSWD 合約，且原始 host stderr 在 production 不會回到前端。詳見 [`docs/toolbox.md`](./docs/toolbox.md)

### 遠端節點監控（v0.6.2）

- 透過 agentless SSH（金鑰驗證，遠端主機不需安裝 agent）註冊遠端主機
- 唯讀主機指標：CPU / 記憶體 / 磁碟 / uptime — 隨需查詢
- 遠端主機的 Docker 或 Podman 容器清單 + 狀態（不對遠端執行寫入操作；沒有 `docker` 時退到 `podman ps` — v0.6.6）
- 詳見 [`docs/nodes.md`](./docs/nodes.md)

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
| v0.6.0 | 工具箱 — NTP / 時間同步、Fail2Ban（原地擴充 firewall 模組）、磁碟用量 + 策展型清理（journald / 套件快取 / docker prune；tmp-sweep 因不安全已砍）。Swap 寫入 + Supervisor 走 v0.6.x patch | ✅ 已 ship（Rocky 234 smoke S1–S3 過；該機未裝 fail2ban → S4 略） |
| v0.6.1 | Supervisor = systemd `.service` 管理（服務分頁：列出/狀態 + start/stop/restart/enable/disable，分級保護清單，停不掉面板自己/sshd/firewalld）+ 磁碟表去噪（`df -T` fstype 過濾，docker overlay/pseudo 預設隱藏 + toggle） | ✅ 已 ship（Rocky 234 smoke S1–S3 + 服務護欄活驗過） |
| v0.6.2 | 遠端節點唯讀監控 — 透過 agentless SSH 註冊遠端主機，唯讀主機指標（CPU / 記憶體 / 磁碟 / uptime）與 Docker 容器清單/狀態；不對遠端執行寫入操作。詳見 [`docs/nodes.md`](./docs/nodes.md) | ✅ 已 ship |
| v0.6.6 | Podman 支援 — 遠端節點沒 `docker` 時退到 `podman ps`；本機 containers 模組自動偵測 `/run/podman/podman.sock`（rootful / rootless）與 `podman compose`。API / schema 不變 | ✅ 已 ship（本機 podman 6.1.1 smoke：ps fallback、dockerode API、compose label 探索） |
| v0.6.7 | 引擎標示 — 遠端節點容器卡與本機容器管理頁標示 Docker / Podman（`GET /containers/engine`、遠端 `__DINO_ENGINE__` marker）；引擎有裝但 socket 無權限改為 200 `permissionDenied` 狀態 + 說明卡，不再 500；點選節點後清單自動收合 | ✅ 已 ship |
| v0.6.8 | 遠端節點 **同時列出 docker 與 podman**，每行標引擎與擁有者；以 root 執行時（原生 root 或選填的節點 **sudo 密碼** — AES-GCM 加密、只經 stdin 送出、API 不回傳）另掃 `/run/user/*` 列出**所有使用者的 rootless Podman 容器**。socket 無權限與 sudo 密碼錯都是 200 狀態並有說明。仍為唯讀（只跑 `ps`） | ✅ 已 ship |
| v0.6.9 | Nexus Repository 流量監控 — 每 60 秒抓一次實例的 Prometheus 端點、保留 7 天樣本，畫出請求／錯誤／下載／上傳速率（1 小時／24 小時／7 天），另有依格式的位元組統計與倉庫清單。帳密 AES-GCM 加密且不回傳；純唯讀（只有兩個 `GET`）。詳見 [`docs/nexus.md`](./docs/nexus.md) | ✅ 已 ship |
| v0.6.10 | Nexus 社群版用量配額 — 讀取 Sonatype 實際據以判斷的計數（24 小時請求數、元件數、不重複使用者、尖峰）並與流量樣本一起存，對每台可設定的上限畫進度條（75% 轉黃、100% 轉紅），另有 24 小時請求數走勢圖，看得出被擋的 `docker push` 何時會通。上限由面板保存，因為 Nexus 任何 API 都不提供 | ✅ 已 ship |
| v0.7.0 | 帳號安全 — TOTP MFA + recovery codes、登入 session 管理、IP 白名單、SSH 設定管理（sshd port / root 登入 / 金鑰）。導入 `SecretsService`（順便加密 v0.4 明文 DB 密碼）。Passkey / WebAuthn 視 TLS 部署而定 | 規劃中 |
| v0.8.0 | 告警與通知 — 監控閾值（CPU / RAM / 磁碟）、通知管道（Email / Webhook）、告警記錄（複用既有 scheduler） | 規劃中 |
| v0.9.0 | 遠端備份 + 面板快照 — S3 / MinIO 相容備份目標、面板整體快照 backup / restore（設定 + DB + 站台 conf） | 規劃中 |
| v1.0 | 穩定化 — 完整 i18n（en / zh-TW）、文件、bundle / 效能調校、安全 audit、全模組 Rocky smoke | 規劃中 |

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

# 跑單元測試（共 551 — server + web + shared）
pnpm test

# 建置 production bundle
pnpm build
```

## 部署

```sh
# 打 release tarball（含 node-pty 的 x64 預編譯，目標機免裝 build-essential / python3）
bash scripts/build-release.sh --prebuild=x64

# 把 tarball 丟到目標機，然後在目標機上：
tar -xzf dinopanel-0.6.0-prebuild-x64.tar.gz
cd dinopanel-0.6.0-prebuild-x64
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
docs/                 # 架構、網站、ACME、防火牆、排程、日誌、工具箱等文件
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
- [工具箱](./docs/toolbox.md) — NTP、Fail2Ban、磁碟用量 + 清理、sudoers
- [遠端節點](./docs/nodes.md) — 節點註冊、agentless SSH、唯讀指標 + 容器
- [排程](./docs/scheduler.md) — cron 任務、runner、內建 purge dogfood
- [日誌](./docs/logs.md) — 五個日誌來源、保留策略、audit interceptor
- [部署](./docs/deployment.md) — 生產環境安裝 + 升級流程

## 授權

[Apache License 2.0](./LICENSE)
