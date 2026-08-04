# v0.6.2 — decisions（合成自 judge panel 勝出稿 minimal-surface；每項決策明說延後了什麼）

## D1 — SSH 傳輸：系統 `ssh` binary（經 runCommand）而非 ssh2 npm 依賴

**Context**：需從 234 對 235 執行唯讀命令。researcher 確認 codebase 零 SSH 既有依賴，`dockerode@5.0.0` 不支援 `ssh://`。
**Options considered**：(a) 新增 `ssh2`（native binding，需管理連線生命週期、host key、認證邏輯）；(b) 新增 `node-ssh`（ssh2 包裝，同樣的依賴成本）；(c) shell out 到系統 `ssh`，用既有 `runCommand()`（`apps/server/src/common/shell/run-command.ts`）。
**Chosen**：(c) 系統 `ssh` binary。固定參數 `-o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new`。
**Rationale**：零新依賴；`runCommand` 的 timeout、`CommandError` 分類（`TOOL_MISSING` 恰好覆蓋 ssh 缺席）、`commandErrorToHttp` 映射全部免費重用 — 這正是 lens 要的最大重用。ssh2 要自建 timeout/錯誤分類/金鑰載入，diff 至少大一個數量級。`accept-new` 的 TOFU 在內網可接受；known_hosts 嚴格管理留給未來需要跨網段時。**延後**：連線複用（ControlMaster）— 單節點 10s 輪詢用不到。

## D2 — 認證：只支援金鑰、不存密碼 → 本 change 不儲存任何秘密

**Context**：使用者要求記錄「憑證存放（settings KV vs 專用表、明文先例）」的取捨。既有先例：`db_instances.password` 與 PMM token 皆明文（v0.4-databases decisions.md Q3，SecretsService 至 v0.6.1 仍 absent）。
**Options considered**：(a) 支援密碼、明文存 settings KV（沿 PMM 先例）；(b) 支援密碼並先建加密機制；(c) 只支援金鑰認證（`BatchMode=yes`），面板端不存任何秘密。
**Rationale**：(a) 需要 `sshpass`（新系統依賴）且擴大明文秘密面積；(b) 是 SecretsService 的推測性提前實作，違反既定延後決策；(c) 讓「憑證存放」問題**整個消失** — 金鑰由 OS 層 `~/.ssh/` 管理，面板只存非秘密連線參數。最小 diff 同時是最安全的選項，罕見的雙贏。
**Chosen**：(c)。**延後**：密碼/自訂 keyPath 支援，等 SecretsService 落地後一併做。

## D3 — 節點清單存放：settings KV 單一 key（JSON 陣列），不開專用表

**Context**：「節點註冊」需要持久化，選項是 settings KV vs 專用 `remote_nodes` drizzle 表（需 `pnpm db:generate` 出新 migration）。
**Options considered**：(a) 專用表 + migration（型別最正規，但多一個 schema.ts diff、一個 migration 檔、部署時多一步 migrate）；(b) settings KV 每節點多 key（key 命名管理麻煩）；(c) settings KV 單一 key `nodes.list`，value 為 zod 驗證的 JSON 陣列。
**Chosen**：(c)。讀寫慣例照抄 `monitoring.service.ts` 的 drizzle upsert。
**Rationale**：v0.6.2 實際上只有一個節點；D2 之後所有欄位皆非秘密，KV 完全夠用。零 migration = 部署零風險（AC8 直接以 `drizzle/` 零 diff 驗收）。API 形狀刻意做成 list-based（`GET /api/nodes` 回陣列），未來升級專用表時 web 與 API 契約不變。**延後**：專用表 — 節點數多到需要查詢/關聯（如告警綁節點）時再開，屆時是一次直白的資料搬移。

## D4 — 取數模式：REST on-demand + 前端 `refetchInterval`，不做伺服端輪詢、不動 WS

**Context**：本機 metrics 是伺服端 1s 輪詢（`system.service.ts` `POLL_INTERVAL_MS`）+ `/ws/metrics` 廣播。遠端要不要比照？
**Options considered**：(a) 伺服端常駐輪詢 + `/ws/metrics` 帶 `nodeId` 廣播（動到 `metrics.gateway.ts` 契約，既有 dashboard 消費端有回歸風險，且沒人看頁面時白耗 ssh 連線）；(b) 伺服端輪詢 + 快取、REST 讀快取（多一份常駐狀態與生命週期管理）；(c) 純 on-demand REST，web 端 tanstack-query `refetchInterval: 10_000`，只在頁面開啟時取數。
**Chosen**：(c)。
**Rationale**：`/ws/metrics` 一行都不改 = 既有 dashboard 零回歸風險，是本 lens 的最重砝碼。伺服端零新狀態（無 interval、無快取、無清理邏輯）。單節點 + 內網 ssh（<1s）+ metrics 批次內建 `sleep 1`，10s 間隔綽綽有餘。**延後**：伺服端快取/串流 — 多節點常駐監控或需要歷史曲線時再上，屆時 REST 端點簽名不變、只是後面加快取。

## D5 — 遠端 docker 取得：`ssh <node> docker ps -a --format '{{json .}}'`

**Context**：三條路：TCP socket、SSH tunnel 到 socket + dockerode、ssh 直跑 docker CLI。
**Options considered**：(a) 遠端 daemon 開 TCP（要改 235 的 daemon 設定 + TLS 憑證管理 — 違反 agentless/零遠端改動前提）；(b) SSH tunnel 到 `/var/run/docker.sock` + 第二個 dockerode 實例（tunnel 生命週期管理、埠分配，全是新機制）；(c) `ssh ... docker ps -a --format '{{json .}}'` 走 D1 的同一條 `sshExec` 路徑，逐行 JSON parse。
**Chosen**：(c)。
**Rationale**：與 metrics 共用唯一一條執行路徑，第二個消費者零邊際成本。唯讀清單場景下 CLI JSON 輸出（ID/Names/Image/State/Status）完全夠用；為此建 tunnel 基建是典型推測性抽象。**延後**：dockerode-over-tunnel — 等未來 multi-host 章節要做遠端容器「操作」時才有理由，屆時再評估。

## D6 — 不採 Unavailable-driver 分層：直接用 CommandError 管線

**Context**：toolbox 的慣例是 boot probe + real/Unavailable 雙 driver（`toolbox.module.ts` 的 `which()` factory）。研究報告建議 nodes 模組比照。
**Options considered**：(a) 照抄：`NodesDriver` interface + `SshNodesDriver` + `UnavailableNodesDriver` + boot probe factory（3 個檔案、1 個 interface，但只會有一個真實作）；(b) 不分層：service 直呼 `runCommand('ssh',...)`，`TOOL_MISSING` 由 `commandErrorToHttp(err,'NODES')` 自然轉成 coded 錯誤。
**Chosen**：(b)。
**Rationale**：toolbox 的 driver 分層存在是因為 feature 可用性要在 boot 時定案並由 `GET /api/toolbox/status` 聚合回報；nodes 的失敗模式（ssh 缺席、節點不可達）本質是 per-request、per-node 的，boot probe 答不了「235 現在可達嗎」。單一實作的 interface 違反本 lens（與 ponytail「no interface with one implementation」）。既有錯誤管線已提供等價的 coded 失敗（`NODES_TOOL_MISSING`）。**延後**：若未來節點數多、需要 feature-gating UI，再引入 status 聚合端點。此取捨會在 `nodes.service.ts` 留 `// ponytail:` 註記。

## D7 — UI 放置：新 `/nodes` 頁，不動 dashboard

**Options considered**：(a) dashboard 加遠端節點區塊（觸碰既有 dashboard 版面與資料流，回歸風險最高的檔案）；(b) 新 `/nodes` lazy route + sidebar 入口（純增量：`App.tsx` 一行 Route、`sidebar.tsx` 一個 item、其餘全新檔）。
**Chosen**：(b)。
**Rationale**：對既有頁面 diff 最小、且 `/nodes` 是未來 multi-host 章節的自然家（節點列表本來就該是一級頁面）。**延後**：dashboard 摘要卡 — 等節點常態多台再加。

## D8 — 回傳形狀：新 slim schema，不重用 `MetricsSnapshot` / `containerSchema`

**Context**：既有 `MetricsSnapshot` 含 net/diskIo（需持續取樣算 rate，遠端 on-demand 拿不到有意義值）；`containerSchema` 含 ports[]/labels/imageId（docker CLI `--format json` 不給結構化 ports，解析成本高）。
**Options considered**：(a) 重用完整 schema、填假值（型別上「重用」但語意撒謊，dashboard 元件誤用風險）；(b) 新 `remoteNodeMetricsSchema` / `remoteContainerSchema`，只含真的採得到的欄位，`state` 仍 import 既有 `containerStateSchema` enum。
**Chosen**：(b)。
**Rationale**：schema 是契約 — 填假值的「重用」是負資產。slim schema 總量約 30 行，且 enum 層級照樣重用。**延後**：欄位擴充（ports、labels）等真的有 UI 需求再加，加欄位是向後相容的。

## 使用者定案（2026-08-04，open questions 四題）

1. **235 ssh 身分：root**。金鑰佈署（`ssh-copy-id root@192.168.199.235`）為一次性維運動作，所需密碼由維運當場輸入 — **不入庫、不入 git、不入任何檔案**（與 D2 一致，面板端零秘密）。
2. **`StrictHostKeyChecking=accept-new` TOFU 核可**（內網環境）— D1 維持不變。
3. **重複 `host:port` 註冊本版就擋**：service 層檢查，409 `NODES_DUPLICATE`。
4. **輪詢間隔分流**：metrics 10s、containers 30s（容器變動頻率低，減半 ssh 次數）。
