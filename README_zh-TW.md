# DinoPanel

> 現代化 Linux 主機管理面板，以 TypeScript + React + NestJS 打造。

DinoPanel 是自架的單機 Linux 主機控制台，透過簡潔的網頁介面集中管理檔案、終端機、容器、網站、資料庫與系統監控等。整個專案為獨立的 clean-room reimplementation，靈感取自業界一流的管理面板。

> **狀態：** Pre-alpha，MVP 開發中。

## 功能（MVP）

- **儀錶板** — CPU / 記憶體 / 磁碟 / 網路即時指標（1 Hz 更新）
- **網頁 SSH 終端機** — 多分頁、完整 xterm.js shell 體驗
- **檔案管理** — 瀏覽、編輯（Monaco）、上傳、下載、壓縮、權限調整
- **設定** — 語言、佈景主題、帳號管理
- **認證** — JWT + Refresh Token 輪轉、bcrypt 密碼雜湊

## 路線圖

- v0.2 — Docker 容器管理
- v0.3 — 網站管理（Nginx 反向代理 + ACME SSL 自動申請）
- v0.4 — 資料庫管理(MySQL / PostgreSQL / Redis)
- v0.5 — 防火牆、計畫任務、日誌中心
- v0.6 — 工具箱（Fail2Ban、Supervisor 等）、MFA、Passkey
- v1.0 — 穩定版

## 技術選型

| 層級     | 採用                                              |
| -------- | ------------------------------------------------- |
| 前端     | React 19 + Vite 6 + TypeScript                    |
| UI       | Tailwind CSS 4 + shadcn/ui + Radix                |
| 後端     | NestJS 11 + Fastify + TypeScript                  |
| 資料庫   | SQLite（better-sqlite3）+ Drizzle ORM             |
| 即時通訊 | 原生 WebSocket（不使用 Socket.IO）                |
| 終端機   | @xterm/xterm + node-pty                           |
| 編輯器   | Monaco Editor                                     |

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

# 建置 production bundle
pnpm build
```

## 專案結構

```
apps/
  web/        # React + Vite 前端（SPA）
  server/     # NestJS 後端（REST + WebSocket）
packages/
  shared/     # 共用的 Zod schema、WS 通訊協定型別、錯誤碼
scripts/      # install.sh、build-release.sh
deploy/       # systemd unit、nginx 範例
docs/         # 架構、API 參考、部署指南
```

## 授權

[Apache License 2.0](./LICENSE)
