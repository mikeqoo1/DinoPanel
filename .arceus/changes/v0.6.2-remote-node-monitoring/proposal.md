# v0.6.2 — 遠端節點唯讀監控（納管 192.168.199.235）

## 為什麼 (Why)

DinoPanel 目前只能監控自己所在的主機（192.168.199.234，Rocky）。使用者的第二台主機 192.168.199.235 上跑著 Docker 容器，狀態完全不可見 — 要看 CPU/記憶體/磁碟或容器是否活著，只能手動 ssh 上去敲指令。這是日常維運的實際痛點，且使用者明確希望它排在 v0.7 帳號安全之前。

本 change 以**最小表面積**把 235 納入面板：唯讀監控主機狀態（CPU/記憶體/磁碟/uptime）與 Docker 容器清單/state，外加最簡單的節點註冊。刻意不做任何遠端操作 — 那是未來 multi-host 章節的事，現在做只會憑空增加攻擊面與回歸風險。

技術路線是 agentless SSH：235 上**不裝任何 agent、不改任何設定**（只需事先 `ssh-copy-id` 佈好金鑰）。伺服端全部重用既有機制 — `runCommand()`（`apps/server/src/common/shell/run-command.ts`）包 system `ssh` binary、`commandErrorToHttp()` 錯誤映射、settings KV 存節點清單（沿用 `monitoring.service.ts` 的 PMM 先例）、web 端沿用 lazy route + sidebar items + tanstack-query hook 慣例。**零新依賴、零 DB migration、零對既有模組的行為變更** — 對既有程式碼的修改只有 6 個檔案的純增量掛載點（schemas barrel、`app.module.ts`、`App.tsx`、`sidebar.tsx`、i18n x2）。

遠端監控的本質是「對一台隨時可能斷線、金鑰失效、沒裝 docker 的機器發請求」— 失敗是常態不是例外。因此錯誤分類是一級公民：ssh exit 255 依 stderr 樣式細分為「不可達 / 認證失敗 / host key 變更」，忘了 `ssh-copy-id` 是最可能的入門失敗，不能把它誤顯示成「不可達」。

## 範圍 (Scope)

### In
- 節點註冊：新 `nodes` NestJS 模組，節點清單（name/host/port/user）存 settings KV 單一 key（JSON 陣列），提供 list / add / delete / test-connection 四個 API（test 回 `latencyMs`）。
- 遠端主機狀態：`GET /api/nodes/:id/metrics` — 單次 ssh 執行固定常數命令批次（`/proc/stat` 兩次取樣算 CPU usage、`/proc/loadavg`、`/proc/meminfo`、`/proc/uptime`、`df -PTB1`），解析成 slim schema 回傳。
- 遠端容器狀態：`GET /api/nodes/:id/containers` — `ssh <node> docker ps -a --format '{{json .}}'`，解析成 `{id,name,image,state,status}`（state 重用既有 `ContainerState` enum）；遠端沒裝 docker 回 200 `{dockerAvailable:false, containers:[]}`（docker 缺席是節點的預期狀態，不是錯誤）。
- 錯誤分類：`NODES_TOOL_MISSING`（ssh 缺席，走既有 `CommandError` 管線）、`NODES_UNREACHABLE` / `NODES_AUTH_FAILED` / `NODES_HOSTKEY_CHANGED`（exit 255 依 stderr 樣式細分）、`NODES_TIMEOUT`（`exitCode === null`）。錯誤 message 一律固定短句，raw stderr 只進 server log（對齊 v0.6 `exposeStderr` 慣例）。
- 信任邊界驗證：host/user/port 嚴格 zod 驗證（拒絕前導 `-`）+ ssh argv `--` end-of-options，雙層防 ssh 參數注入。
- Web：新 `/nodes` 頁（sidebar 入口、`use-nodes.ts` hook、i18n `nodes.*` 雙語 key），metrics 以 `refetchInterval` 前端輪詢、`retry: false`，死節點以狀態 pill 呈現而非 error boundary；註冊 dialog 內嵌 `ssh-copy-id` 指引文案。
- 測試（parser golden、`buildSshArgs` golden、錯誤分類、stderr 不外洩斷言）+ `docs/nodes.md` + `scripts/smoke-nodes-234.sh`（跟隨 `smoke-toolbox-234.sh` / `smoke-backups-234.sh` 慣例）。
- 版本收尾：bump 4 個 package.json（root/server/web/shared，0.6.1 → 0.6.2）+ README 與 README_zh-TW 版本表補列。

### Out（明確延後，非遺漏）
- 遠端容器操作（start/stop/restart）— 未來 multi-host 章節。
- 遠端網站/資料庫/檔案管理 — 同上。
- 密碼認證、憑證加密存放 — 只支援金鑰認證，因此**本 change 完全不儲存任何秘密**。
- 伺服端輪詢、伺服端快取、WS 串流（`/ws/metrics` 完全不動）、歷史數據落地 — 多節點/多分頁成為問題時，in-flight promise 合併 + 負向快取是已命名的升級路徑。
- 專用 `remote_nodes` 資料表 / DB migration — 節點數成長到 KV JSON 難以維護時再升級。
- ssh2/node-ssh npm 依賴、SSH 連線池（ControlMaster）、known_hosts 管理 UI。
- 非 Linux / 非 GNU coreutils 遠端目標（BusyBox、macOS）— 解析失敗以錯誤浮出，不做相容。

## Stakeholders
- **使用者（110084@concords.com.tw）**：主導者，需要在單一面板看到兩台主機的健康狀態；傾向 agentless、反對推測性抽象。
- **維運面（Rocky 234）**：部署前置條件只有一條 — 以面板執行身分對 235 完成 `ssh-copy-id`；235 端零改動。
- **未來 multi-host 章節的實作者**：本 change 的 API 形狀（list-based `GET /api/nodes`、per-node 子資源）是其自然起點；slim schema 與 KV 存放皆為可平滑升級的形狀。
- **v0.7 帳號安全章節**：本章不新增任何秘密存放（金鑰留在 OS 層 `~/.ssh/`），不增加 v0.7 的清理負債。
