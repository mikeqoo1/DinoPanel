# v0.6.2 — 遠端節點唯讀監控 spec

## 需求描述

**User story**：作為 DinoPanel 管理者，我要把遠端主機 192.168.199.235 註冊進面板，並在面板上唯讀查看它的 CPU/記憶體/磁碟/uptime 與 Docker 容器清單及狀態，全程不需在遠端主機安裝任何 agent；當它斷線、金鑰失效或沒裝 docker 時，我要看到明確、可行動的狀態，而不是 500 或無限轉圈。

### F1 — 節點註冊（settings KV，零 migration）
- 新模組 `apps/server/src/modules/nodes/`（`nodes.module.ts` / `nodes.controller.ts` / `nodes.service.ts`），於 `app.module.ts` 掛載，controller 沿用全域 auth guard（未登入 401）。
- 節點清單存 `settings` KV 表（`apps/server/src/database/schema.ts` 既有表）單一 key `nodes.list`，value 為 JSON 陣列 `[{ id, name, host, port, user }]`；讀寫沿用 `monitoring.service.ts` 對 `settings` 的 drizzle upsert 慣例（`onConflictDoUpdate` target `settings.key`）。`id` 用 `crypto.randomUUID()`。
- API：
  - `GET /api/nodes` → `RemoteNode[]`
  - `POST /api/nodes` body `{ name, host, user, port? (default 22) }` → 新增後回傳完整清單；`host:port` 已存在 → **409** `NODES_DUPLICATE`（service 層檢查，KV 無 unique 約束）
  - `DELETE /api/nodes/:id` → 移除
  - `POST /api/nodes/:id/test` → 執行遠端 `true`，成功回 `{ ok: true, latencyMs }`，失敗走 F4 錯誤碼
- 不儲存密碼或任何秘密 — 認證僅支援既佈署的 SSH 金鑰（`BatchMode=yes`，走 OpenSSH 預設金鑰解析）。

### F2 — 遠端主機狀態
- `GET /api/nodes/:id/metrics` → `RemoteNodeMetrics`（slim schema，見 F6）。
- 實作：**單次** `runCommand('ssh', buildSshArgs(node, METRICS_CMD))` 執行固定常數遠端命令批次（`export LC_ALL=C;` 開頭固定 locale、`__DINO__` 分隔段落）：
  `cat /proc/stat; cat /proc/loadavg; cat /proc/meminfo; cat /proc/uptime; sleep 1; cat /proc/stat; df -PTB1 -x tmpfs -x devtmpfs -x overlay`
- CPU usage 由兩次 `/proc/stat` 取樣差分計算（0–100）；mem 由 `MemTotal`/`MemAvailable` 推得 used/total/free；disks 由 `df -PTB1` 解析 `{mount,fstype,used,total}`（`-T` 提供 fstype 欄，對齊 v0.6.1 磁碟去噪先例）；uptime 由 `/proc/uptime` 取整數秒。
- SSH 固定參數（`buildSshArgs` 純函式組裝）：`-o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new -p <port> -- <user>@<host> <常數命令>`（`--` 在 destination **之前** — 見 F5 與 D9；原草稿此行誤植於 host 之後，已依 F5 安全條款更正）。

### F3 — 遠端容器狀態
- `GET /api/nodes/:id/containers` → `{ dockerAvailable: boolean, containers: RemoteContainer[] }`。
- 實作：`sshExec(node, DOCKER_PS_CMD)`（`export LC_ALL=C; docker ps -a --format '{{json .}}'`），逐行 JSON parse，映射 `{ ID→id, Names→name, Image→image, State→state, Status→status }`；`state` 以既有 `ContainerState` enum（`packages/shared/src/schemas/containers.ts`）驗證，未知值 fallback `dead` 不丟例外；單筆壞 JSON 行丟棄 + warn log，其餘照常回傳（單一容器的怪輸出不弄瞎整個清單）。
- 遠端 `docker` 不存在（exit 127，或非零 exit 且 stderr 出現針對 docker 的 not-found）→ **200** `{ dockerAvailable: false, containers: [] }` — docker 缺席是節點的預期狀態不是錯誤，UI 渲染「未安裝 Docker」。判定**絕不**在 exit 0 成立：非互動 ssh 會 source 遠端 `~/.bashrc`，無關的 `foo: command not found` 雜訊曾能讓正在跑容器的節點被誤報為未安裝（D9）。此判定為單一來源（`ssh.ts` 的 `isDockerAbsent`），同時供 200 回應與 log 抑制使用，兩處不得漂移。
- metrics 與 docker ps 刻意為兩次獨立 ssh 呼叫：沒裝 docker 不弄髒主機指標。

### F4 — 錯誤分類（重用 CommandError 管線 + stderr 樣式細分）
- ssh binary 缺席：`runCommand` 丟 `CommandError('TOOL_MISSING')` → `commandErrorToHttp(err, 'NODES')` 自然回 503 `NODES_TOOL_MISSING` — **不需 boot probe、不需 Unavailable driver**（見 decisions.md D6）。
- `exitCode === null`（`runCommand` 逾時殺程序，已驗證 `run-command.ts` 行為）→ 504 `NODES_TIMEOUT`。
- exit 255（ssh 連線層失敗）依 stderr 樣式細分（純函式 `classifySshFailure()`，皆回 502）：
  - `Permission denied` / `bad permissions` / `UNPROTECTED PRIVATE KEY FILE` → `NODES_AUTH_FAILED`
  - `REMOTE HOST IDENTIFICATION HAS CHANGED` / `Host key verification failed` → `NODES_HOSTKEY_CHANGED`（message 含 known_hosts 處置提示的固定字串）
  - 其餘（`Connection refused` / `No route to host` / `Connection timed out` 等）→ `NODES_UNREACHABLE`
- 其他非零 exit → 既有 `commandErrorToHttp` 兜底 `NODES_COMMAND_FAILED`，永不落到未捕捉 500。
- **stderr 不外洩**：所有錯誤 message 為固定短句，raw stderr 僅 `Logger.warn` 進 server log（對齊 v0.6 Phase 4 `exposeStderr` 慣例；呼應 websites/databases stderr 外洩 followup，不再新增外洩點）。

### F5 — 信任邊界驗證（不可簡化）
- zod schema 驗證註冊輸入：`host` 符合 hostname/IPv4 格式且**不得以 `-` 開頭**；`user` 符合 `^[a-z_][a-z0-9_.-]*$`；`port` 為 1–65535 整數；`name` 非空字串 ≤64 字。
- ssh argv 中 host 之前放 `--` end-of-options（OpenSSH 在 host 位置後仍解析選項；`--` 由 client 消化，與 zod 拒前導 `-` 疊成雙層防護）。**實證**（OpenSSH_9.6p1）：`ssh -p 22 '-oProxyCommand=/bin/echo X' -- true` 會執行 ProxyCommand；`ssh -p 22 -- '-oProxyCommand=…' true` 則被拒（`hostname contains invalid characters`）。
- 節點清單自 settings KV 讀出時**逐筆以 `remoteNodeSchema` 重新驗證**（同 `createNodeSchema` 強度的 host/user/port 約束），不合法者丟棄並 warn — KV blob 是信任邊界，寫入時的驗證不能是唯一防線（D9）。
- `sshExec` 對 `runCommand` 傳入 `maxOutputBytes` 上限（4 MiB）：被監控節點不得以巨量 stdout 打爆面板行程（D9）。
- 遠端執行的命令字串一律為模組內常數（`METRICS_CMD` / `DOCKER_PS_CMD`），**不得**插入任何使用者輸入。

### F6 — 共用 schema
- 新檔 `packages/shared/src/schemas/nodes.ts`：`remoteNodeSchema`、`createNodeSchema`、`remoteNodeMetricsSchema { ts, cpu:{usage,loadAvg[3]}, mem:{used,total,free}, disks[]:{mount,fstype,used,total}, uptimeSec }`、`remoteContainerSchema { id, name, image, state, status }`（import 既有 `containerStateSchema`）、`remoteContainersResponseSchema { dockerAvailable, containers }`。
- 於 `packages/shared/src/schemas/index.ts`（實際的 per-schema barrel，現有 14 個 `export * from './xxx.js'`）加一行 `export * from './nodes.js';` — 注意不是 `packages/shared/src/index.ts`（該檔只 re-export `./schemas/index.js`）。
- 刻意**不**重用完整 `MetricsSnapshot`（含 net/diskIo 遠端不採集）與完整 `containerSchema`（ports/labels 由 CLI 格式解析成本高、監控用不到）。

### F7 — Web /nodes 頁
- `apps/web/src/App.tsx` 加 lazy `<Route path="/nodes">`（`AuthGuard` 內）；`sidebar.tsx` items 加 `{ to:'/nodes', icon, label:t('nav.nodes') }`（Lucide `Server` 系 icon）。
- 新 hook `apps/web/src/hooks/use-nodes.ts`（tanstack-query，慣例同 `use-toolbox.ts`）：節點 CRUD mutations + `invalidateQueries`；選定節點的 metrics query 帶 `refetchInterval: 10_000`、containers query 帶 `refetchInterval: 30_000`（容器變動頻率低，減半對節點的 ssh 次數），皆 **`retry: false`**（顯式關閉 tanstack 自動重試，防死節點 ssh storm；頁面開啟時前端輪詢，伺服端無狀態）。
- 頁面：節點清單（新增 dialog **內嵌 `ssh-copy-id` 指引文案**、刪除、測試連線鈕含 latency 顯示）＋選定節點的狀態卡（CPU%/loadAvg/mem/disks/uptime）＋容器表格（name/image/state/status）。節點失敗以**狀態 pill** 呈現（unreachable / auth-failed / hostkey-changed / timeout），不觸發 error boundary、無 toast 轟炸；`dockerAvailable:false` 渲染「未安裝 Docker」空狀態而非錯誤區塊。
- i18n：`nodes.*`（含各錯誤碼人話文案）與 `nav.nodes` 同步加入 `apps/web/src/i18n/en.json` 與 `zh-TW.json`（parity test 會擋漏）。

## 驗收條件 (AC)

- [ ] AC1：`GET /api/nodes` 未登入回 401；登入後回傳陣列且通過 `remoteNodeSchema` 驗證。
- [ ] AC2：`POST /api/nodes` 以 `{name:'rocky-235', host:'192.168.199.235', user:'root'}` 成功建立且 port 預設 22；同 `host:port` 再 POST 一次回 409 `NODES_DUPLICATE`；重啟 server 後 `GET /api/nodes` 仍包含該節點（KV 持久化）。
- [ ] AC3：`POST /api/nodes` 以 `host: "-oProxyCommand=touch /tmp/pwn"` 或 `user: "a;b"` 皆回 400（zod 拒絕），且無任何命令被執行。
- [ ] AC4：對可達節點 `POST /api/nodes/:id/test` 回 `{ok:true, latencyMs>0}`；對不可達假 IP（192.0.2.1）回 502 且 `code === 'NODES_UNREACHABLE'`，在 ConnectTimeout(5s)+緩衝內回應不掛死。
- [ ] AC5：`GET /api/nodes/:id/metrics` 回傳通過 `remoteNodeMetricsSchema`：`cpu.usage` 介於 0–100、`mem.used <= mem.total`、`disks` 至少含 mount `/` 且每筆 `fstype` 非空、`uptimeSec > 0`。
- [ ] AC6：`GET /api/nodes/:id/containers` 每筆 `state` 皆屬 `ContainerState` enum；遠端無 docker 時回 200 `{dockerAvailable:false, containers:[]}`（mock exit 127 測試）。
- [ ] AC7：`grep -rE 'docker (start|stop|restart|rm|exec)|systemctl' apps/server/src/modules/nodes/` 零命中（唯讀保證，遠端命令全為唯讀常數）。
- [ ] AC8：不新增任何 npm 依賴（`apps/server/package.json` 除 version bump 外 diff 為空）、不新增任何 drizzle migration（`apps/server/drizzle/` diff 為空）。
- [ ] AC9：錯誤分類單元測試全過：mock exit 255 + `Connection refused`→`NODES_UNREACHABLE`；+ `Permission denied (publickey)`→`NODES_AUTH_FAILED`；+ `REMOTE HOST IDENTIFICATION HAS CHANGED`→`NODES_HOSTKEY_CHANGED`（message 含 known_hosts 提示）；mock `exitCode === null`→`NODES_TIMEOUT`。
- [ ] AC10：stderr 不外洩斷言：所有錯誤回應 body 內不含 mock stderr 內容（測試明確斷言），raw stderr 僅出現在 server log。
- [ ] AC11：parser 單元測試涵蓋 `/proc/stat` 差分、`/proc/meminfo`、`df -PTB1`（含 fstype 欄、多磁碟、swap=0 fixture）、docker ps JSON 行解析（未知 state fallback、壞行跳過+其餘保留）；`buildSshArgs` golden 測試（選項順序、port、`--` 位置、`LC_ALL=C` 前綴）。
- [ ] AC12：web `/nodes` 頁經 sidebar 可達；metrics query `refetchInterval: 10_000`、containers query `refetchInterval: 30_000`，皆 `retry: false`（程式碼可查）；`i18n-parity.test.ts` 通過。
- [ ] AC13：`pnpm typecheck && pnpm lint && pnpm test && pnpm build` 全綠（既有 464 測試零回歸，總數 > 464）。
- [ ] AC14（實機 smoke）：Rocky 234 部署後 `scripts/smoke-nodes-234.sh` 對 235 全過（S1 註冊+test、S2 metrics 形狀 jq 驗證、S3 containers 形狀、S4 假 IP 錯誤形狀、結束清理測試節點）；手動驗證暫時失效金鑰後 UI 顯示 auth-failed pill 而非崩潰。

## 技術假設

1. 234 → 235 的金鑰 SSH 已由維運事先佈好（`ssh-copy-id`，面板執行身分的 key）；`BatchMode=yes` 下無金鑰即快速失敗，不會卡互動式密碼。
2. 235 為 Linux + GNU coreutils，`/proc/stat`、`/proc/meminfo`、`/proc/loadavg`、`/proc/uptime`、`df -PTB1` 皆可用；遠端批次以 `export LC_ALL=C;` 開頭固定 locale，杜絕解析漂移。
3. 235 的 ssh user 有權執行 `docker ps`（root 或 docker group）；無權時錯誤自然浮出為 `NODES_COMMAND_FAILED`（stderr 進 log 可排障）。
4. `StrictHostKeyChecking=accept-new` 的 TOFU 模型在內網 LAN 可接受（decisions.md D1）；host key 變更時得到明確的 `NODES_HOSTKEY_CHANGED` 而非靜音。
5. `runCommand` 預設 15s timeout 足以涵蓋 metrics 批次內的 `sleep 1`（總耗時約 1.5–2.5s）；timeout 殺程序時 `exitCode === null`（已驗證 `run-command.ts`）。
6. 單節點、10s 前端輪詢下，每次頁面輪詢 2 個 ssh 連線的開銷可忽略；多節點/多分頁成為問題時再上 in-flight promise 合併 + 負向快取（失敗也要快取，否則死節點比活節點吃更多資源）或 ControlMaster（decisions.md D4 升級路徑）。
7. dockerode@5.0.0（經 docker-modem@5.0.7）雖技術上支援 `ssh://` 且 ssh2@1.17.0 已在依賴樹，本 change 仍不使用 — 理由見 decisions.md D1/D5（單一執行路徑、零連線生命週期管理）。
