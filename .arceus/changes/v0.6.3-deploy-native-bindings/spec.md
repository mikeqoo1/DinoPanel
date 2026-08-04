# v0.6.3 — spec

## 需求描述

### F1 — `install.sh` 原生套件版本釘選

`npm install` 前，若 `$SRC/server/node_modules/<pkg>/prebuilds/linux-<arch>/<bin>.version`
存在，讀出版本並組成 `NATIVE_PINS`，以
`npm install --omit=dev --no-package-lock --no-save --silent $NATIVE_PINS` 安裝。

理由：`better-sqlite3: ^12.0.0`、`node-pty: ^1.0.0` 是 range，而 `--no-package-lock`
會讓 npm 在安裝當下解析到最新相容版本（234 實測解析到 12.11.1，而 tarball 帶的是
12.10.0），與隨附 `.node` 不符。缺 `.version` 時 `NATIVE_PINS` 為空，行為與過去完全相同
（向後相容不含 prebuild 的舊 tarball）。

### F2 — 原生模組預檢

`npm install` 之後、migration 與 `systemctl restart` **之前**，對
`better-sqlite3` 與 `node-pty` 各驗一次：

- `better-sqlite3`：`new (require('better-sqlite3'))(':memory:').close()` —
  **必須實際建連線**。該套件的 binding 是延遲載入的，光 `require()` 會過（實測確認），
  只有建連線才會拋 `Could not locate the bindings file`。這正是 v0.6.2 部署時 install.sh
  一路走到 migration 才爆掉的原因。
- `node-pty`：`require('node-pty')` 即可（`.node` 於 require 時即載入）。

### F3 — 修復順序

1. 已可載入 → 跳過（例如舊版 npm 自己編好了）。
2. 從 `$SRC`（解開後的 tarball，`npm install` 不會動它）複製 `prebuilds/linux-<arch>/<bin>`
   到 `$INSTALL_DIR/server/node_modules/<pkg>/build/Release/`；node-pty 另複製
   `spawn-helper`。**僅在 `.version` 與實際安裝版本相符時才複製**（避免原生／JS 版本
   不一致，載入時不報錯卻在呼叫時炸）。
3. 退回 `$INSTALL_DIR/server/node_modules/.bin/prebuild-install`（需連 GitHub）。
4. 皆失敗 → `err` 中止，印出 `prebuild-install` 與 `node-gyp rebuild` 兩條手動指令與
   驗證方式。此時安裝目錄已替換但**服務尚未重啟**，既有實例仍以舊程式服務。

每一步修復後都必須重跑 F2 的驗證才算過。

### F4 — `build-release.sh` 收 better-sqlite3 預編譯檔

`--prebuild=<arch>` 的迴圈中，除既有的 node-pty 外，另從 pnpm store 找
`better-sqlite3/build/Release/better_sqlite3.node`，複製到
`$STAGE/server/node_modules/better-sqlite3/prebuilds/linux-<arch>/`，並寫入
`better_sqlite3.version`（同時為 node-pty 寫 `pty.version`）。找不到已編譯檔時印
WARNING 但不中止（安裝端會退回 `prebuild-install`）。

### F5 — 文件

`docs/deployment.md` 新增「npm ≥ 12：install script 預設被封鎖」小節：徵狀、根因、
install.sh 的四段防護、手動修復指令、以及為何不建議 `npm install-scripts approve`。
「依賴需求」段落補上 better-sqlite3（原本只提 node-pty）。

## 驗收條件

- [x] AC1：`bash -n scripts/install.sh` 與 `bash -n scripts/build-release.sh` 皆過。
- [x] AC2：`bash scripts/build-release.sh --prebuild=x64` 成功產出 tarball，且其中含
  `server/node_modules/better-sqlite3/prebuilds/linux-x64/better_sqlite3.node`
  與 `.version`、`node-pty/prebuilds/linux-x64/pty.node` 與 `.version`。
- [x] AC3（沙箱）：以 `--ignore-scripts` 模擬 npm 12 封鎖行為安裝後，兩個套件版本恰為
  隨附預編譯檔的版本（12.10.0 / 1.1.0），且 `build/` 下無任何 `.node`。
- [x] AC4（沙箱）：預檢正確判定兩者皆 BROKEN（含 better-sqlite3 的延遲載入陷阱 —
  若只用 `require()` 會誤判為 OK）。
- [x] AC5（沙箱）：從乾淨 tarball 來源修復後，兩者皆 REPAIRED 且通過 F2 驗證，全程未使用網路。
- [x] AC6：版本不符時修復函式拒用預編譯檔（`refuse: shipped=… installed=…`）。
- [x] AC7：不含 prebuild 的 tarball（無 `.version`）時 `NATIVE_PINS` 為空，`npm install`
  參數與修改前完全相同。
- [x] AC8：不改動 `apps/server/package.json` 依賴、不 bump 版本、不動應用程式碼；
  `pnpm test` 維持 561 綠。

## 技術假設

1. 預編譯 `.node` 的 node ABI 需與目標機相符（本機 node 24.15 / 234 為 node 24.x，
   同屬 ABI 137）。ABI 不符時 F2 的驗證會失敗並自動退回 `prebuild-install`，不會靜默帶病上線。
2. `npm install` 會清掉 `node_modules` 內隨附的 `prebuilds/`（沙箱實測確認），因此修復
   來源必須是 `$SRC` 而非 `$INSTALL_DIR`。
3. cross-arch prebuild 仍需在對應架構機器上執行（沿用既有 node-pty 的限制）。
4. **本次未在真機 234 重跑 install.sh 驗證**（不願為驗證再重啟一次生產服務）。沙箱以
   `--ignore-scripts` 完整重現了封鎖情境並驗過 F1–F3。下次部署即為真實驗證。
