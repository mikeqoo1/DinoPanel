# Tasks — v0.6.3 部署強化

- [x] T-1 `build-release.sh`：`--prebuild` 迴圈加收 `better_sqlite3.node`，並為
      node-pty / better-sqlite3 各寫 `.version`（用 `path.resolve` 讀版本 — 相對路徑丟給
      `require()` 會被當成模組名，第一次就是寫錯這個導致 build 中斷）。
- [x] T-2 `install.sh`：`npm install` 依隨附 `.version` 釘住兩個原生套件版本
      （`--no-save`；無 `.version` 時參數與原本完全相同）。
- [x] T-3 `install.sh`：原生模組預檢 `native_ok()` — better-sqlite3 實際建
      `:memory:` 連線（延遲載入陷阱），node-pty 用 `require()`。
- [x] T-4 `install.sh`：`repair_from_tarball()`（版本相符才複製，來源為 `$SRC`）
      + `repair_with_prebuild_install()` 退路 + 皆失敗時 `err` 中止並印手動指令。
- [x] T-5 `docs/deployment.md`：npm ≥ 12 專節 + 依賴需求段補 better-sqlite3。
- [x] T-6 驗證：兩支腳本 `bash -n`；實跑 `build-release.sh --prebuild=x64` 確認 tarball
      內含兩個 `.node` 與 `.version`；沙箱以 `--ignore-scripts` 重現 npm 12 封鎖情境，
      驗證釘版本、預檢偵測、離線修復全數成立；`pnpm test` 維持 561 綠。
