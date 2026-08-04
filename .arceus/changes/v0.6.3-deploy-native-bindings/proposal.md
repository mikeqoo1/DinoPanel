# v0.6.3 — 部署強化：原生模組預檢 + 隨附 better-sqlite3 預編譯檔

## 為什麼 (Why)

2026-08-04 部署 v0.6.2 到 Rocky 234 時，`install.sh` 走到 migration 步驟才以
`Could not locate the bindings file` 崩掉，**面板被留在停止狀態**。

根因不在 v0.6.2 的程式碼：234 的 npm 已是 **12.0.1**，而 **npm 12 起預設不執行套件的
install script**。於是 `install.sh` 的 `npm install --omit=dev --no-package-lock --silent`
**回報成功，但 better-sqlite3 與 node-pty 完全沒被編譯**。同一台機器 2026-06-03 裝
v0.6.1 還是好的 — 環境變了。

這會擋掉**未來每一次部署**，且失敗方式最糟：沉默地成功、在無關的步驟爆出看不懂的錯誤、
服務停擺。

## 目標

1. `install.sh` 在動到 migration 與 `systemctl restart` **之前**就發現原生模組不可用，
   能自動修復就修復，不能就大聲中止並印出手動指令 — 絕不把服務留在停止狀態。
2. 帶 prebuild 的 tarball 可**完全離線**安裝（原本 `--prebuild` 只收 node-pty，
   better-sqlite3 仍需目標機連網或編譯）。
3. `docs/deployment.md` 記錄 npm ≥ 12 的行為與處置。

## 範圍 (Scope)

- **In scope**:
  - `install.sh`：原生模組預檢（實際建 `:memory:` 連線 + `require('node-pty')`）、
    版本相符時從解開的 tarball 離線修復、退回 `prebuild-install`、皆失敗則 `err` 中止。
  - `install.sh`：`npm install` 時把兩個原生套件釘到隨附預編譯檔的版本。
  - `build-release.sh`：`--prebuild` 一併收 `better_sqlite3.node`，並為兩者寫入 `.version`。
  - `docs/deployment.md`：npm ≥ 12 專節。
- **Out of scope**:
  - **不用** `npm install-scripts approve` — 那對整批套件開放腳本執行，範圍遠超需要。
  - 不自動跑 node-gyp 編譯（慢、需工具鏈；走到那步該讓人看一眼）。
  - 不改 `apps/server/package.json` 的依賴 range，也不引入 npm lockfile。
  - 不動應用程式碼，因此**不 bump 版本**（純部署工具變更）。

## Stakeholders

- 維運（部署 234 的人）：這是他們踩到的坑。
- 未來每一次 release：沒修的話每次都會中招。
