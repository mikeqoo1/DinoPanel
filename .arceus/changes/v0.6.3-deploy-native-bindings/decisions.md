# Decisions — v0.6.3 部署強化

## D1: 不用 `npm install-scripts approve`

- **Context**: npm ≥ 12 預設不執行套件 install script，導致原生模組未編譯。npm 自己建議的解法是 `npm install-scripts approve <pkg>`。
- **Options considered**: (a) approve 那 5 個被封鎖的套件；(b) 只針對需要的兩個模組直接取得／放置 `.node`。
- **Chosen**: (b)。
- **Rationale**: (a) 等於在生產機上對整批套件（含 `cpu-features`、`protobufjs`、`ssh2`）開放任意腳本執行，範圍遠大於實際需求，而我們只需要兩個 `.node` 檔案到位。(b) 的效果相同但攻擊面小得多，且不依賴 npm 未來版本對 approve 語意的變動。實務上這條也是本次在 234 上救回服務所走的路。

## D2: 修復來源是 `$SRC`（解開的 tarball），不是 `$INSTALL_DIR`

- **Context**: 隨附的預編譯檔放在 `server/node_modules/<pkg>/prebuilds/`，install.sh 會先把 `$SRC/server` 複製到 `$INSTALL_DIR/server`，再於該處 `npm install`。
- **Options considered**: (a) 從 `$INSTALL_DIR` 既有的 prebuilds 複製；(b) 從 `$SRC` 複製。
- **Chosen**: (b)。
- **Rationale**: 沙箱實測確認 **`npm install` 會清掉 node_modules 內隨附的 `prebuilds/` 目錄** — 走 (a) 會在真正需要修復時發現來源已消失。`$SRC` 是解開後的 tarball，npm 從不觸碰，是唯一可靠的來源。

## D3: 釘住原生套件版本，而非只靠 prebuild-install 退路

- **Context**: `better-sqlite3: ^12.0.0` 是 range，install.sh 用 `--no-package-lock`，所以目標機在安裝當下會解析到最新的 12.x（234 實測 12.11.1），與 tarball 帶的 12.10.0 不符 → 版本護欄會拒用預編譯檔 → 退回需要網路的 `prebuild-install`，「離線安裝」的目標落空。
- **Options considered**: (a) 接受退路、承認需要網路；(b) 產生並隨附 npm lockfile；(c) 只把這兩個原生套件釘到隨附預編譯檔的版本（`--no-save`）。
- **Chosen**: (c)。
- **Rationale**: (a) 沒達成使用者要求的離線目標。(b) monorepo 用 pnpm，沒有 npm lockfile，要生一份是更大的改動且會改變整棵依賴樹的解析。(c) 只影響兩個套件、6 行程式碼，且**附帶好處是生產跑的就是建置與測試過的版本** — 原本的行為是安裝當下才解析，等於生產跑著從沒測過的版本。無 `.version` 時 `NATIVE_PINS` 為空，舊 tarball 行為不變。

## D4: 預檢必須實際建連線，不能只 `require()`

- **Context**: 第一版預檢用 `node -e "require('better-sqlite3')"`。
- **Options considered**: (a) 統一用 `require()`；(b) 依套件用不同的驗證表達式。
- **Chosen**: (b)。
- **Rationale**: 沙箱實測抓到 **better-sqlite3 的 binding 是延遲載入的** — 在完全沒有 `.node` 的情況下 `require()` 仍然成功，只有 `new Database()` 才會拋 `Could not locate the bindings file`。若用 (a)，預檢會誤判放行，然後在 migration 步驟以原本那個看不懂的錯誤爆掉 — 也就是這個 change 要消滅的行為本身。node-pty 相反（require 即載入），故依套件分開處理。

## D5: 不自動跑 node-gyp 編譯

- **Context**: 修復鏈的最後一環可以是從原始碼編譯。
- **Chosen**: 不做，改為 `err` 中止並印出 `prebuild-install` 與 `node-gyp rebuild` 兩條指令。
- **Rationale**: 編譯慢（數分鐘）、需要完整工具鏈，而且走到這一步表示隨附預編譯檔與官方預編譯檔都失敗了 — 那通常是 ABI／架構／網路層面的異常，值得人看一眼，不該讓部署腳本悶著頭試。程式碼中留 `ponytail:` 註記說明此天花板。

## D6: 不 bump 版本

- **Context**: 專案慣例每個 change 都會 bump 版本並更新 README 版本表。
- **Chosen**: 不 bump（維持 0.6.2）。
- **Rationale**: 本 change 只動 `scripts/` 與 `docs/`，應用程式碼與依賴皆無變更，使用者看到的面板功能完全相同。為部署工具修補而製造一個版本號只會讓版本表變吵。
