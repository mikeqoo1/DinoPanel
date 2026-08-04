# v0.6.2 — 遠端節點唯讀監控 tasks

> 驗證基準：根目錄 `pnpm typecheck`、`pnpm lint`、`pnpm test`（vitest 3 workspaces，現有 464 測試零回歸）。每個 phase 結束時全綠。實作全程 feature branch（例：`feature/2026-08-XX-v0.6.2-remote-nodes`），Arceus preflight 擋 main。

## Phase 1 — 共用 schema（packages/shared）

- [x] T-1 新增 `packages/shared/src/schemas/nodes.ts`：`remoteNodeSchema`（id/name/host/port/user）、`createNodeSchema`（host 拒前導 `-`、hostname/IPv4 regex；user `^[a-z_][a-z0-9_.-]*$`；port int 1–65535 default 22）、`remoteNodeMetricsSchema`（disks 含 fstype）、`remoteContainerSchema`（import `containerStateSchema` 自 `./containers`）、`remoteContainersResponseSchema`（dockerAvailable + containers）；於 `packages/shared/src/schemas/index.ts` 加 `export * from './nodes.js';`（注意：是 schemas/index.ts 這個 per-schema barrel，非 src/index.ts）。
- [x] T-2 新增 `packages/shared/src/schemas/__tests__/nodes.test.ts`：合法輸入通過；`host: "-oProxyCommand=x"`、`user: "a;b"`、`port: 0` 皆被拒（對應 AC3 的 schema 層）。

## Phase 2 — server：節點註冊

- [x] T-3 新增 `apps/server/src/modules/nodes/nodes.service.ts`：以 drizzle 讀寫 `settings` key `nodes.list`（JSON 陣列，upsert 用 `onConflictDoUpdate` target `settings.key`，慣例同 `monitoring.service.ts`）；`list()` / `add()`（`crypto.randomUUID()` 產 id；同 `host:port` 已存在丟 409 `NODES_DUPLICATE`）/ `remove(id)`。
- [x] T-4 新增 `nodes.controller.ts`（`GET/POST /api/nodes`、`DELETE /api/nodes/:id`、`POST /api/nodes/:id/test`，body 以 `createNodeSchema` 驗證）與 `nodes.module.ts`，並於 `apps/server/src/app.module.ts` imports 掛載。
- [x] T-5 新增 `apps/server/src/modules/nodes/__tests__/nodes.service.test.ts`：CRUD 持久化（mock db）、id 唯一、重複 `host:port` 回 409、`nodes.list` 壞 JSON 時回空陣列不崩潰。

## Phase 3 — server：SSH 執行 + 錯誤分類 + 遠端 metrics

- [x] T-6 新增 `apps/server/src/modules/nodes/ssh.ts`：純函式 `buildSshArgs(node, remoteCmd)`（`['-o','BatchMode=yes','-o','ConnectTimeout=5','-o','StrictHostKeyChecking=accept-new','-p',String(node.port),`${node.user}@${node.host}`,'--',remoteCmd]`）；純函式 `classifySshFailure(exitCode, stderr)`（`null`→`NODES_TIMEOUT` 504；255 依 stderr 樣式→`NODES_AUTH_FAILED`/`NODES_HOSTKEY_CHANGED`/`NODES_UNREACHABLE` 皆 502，message 為固定短句、HOSTKEY_CHANGED 含 known_hosts 提示）；`sshExec(node, remoteCmd)` 呼叫 `runCommand('ssh', ...)`，`CommandError` rethrow `commandErrorToHttp(err,'NODES')`，raw stderr 只 `Logger.warn`。常數 `METRICS_CMD`/`DOCKER_PS_CMD` 定義於此（`export LC_ALL=C;` 開頭），禁止插值。
- [x] T-7 實作 `POST /api/nodes/:id/test`（remoteCmd = `true`，量測並回 `latencyMs`）。
- [x] T-8 新增 `apps/server/src/modules/nodes/remote-parsers.ts`：純函式 `parseProcStatDelta()`、`parseMeminfo()`、`parseLoadavg()`、`parseUptime()`、`parseDfPTB1()`（含 fstype 欄）、`parseDockerPsJson()`（壞行丟棄+warn、未知 state fallback `dead`）— 純函式不碰 I/O。
- [x] T-9 實作 `GET /api/nodes/:id/metrics`：單次 `sshExec` 執行 `METRICS_CMD`（`__DINO__` 分隔；含 `sleep 1` 雙取樣 `/proc/stat`），組裝 `RemoteNodeMetrics`。
- [x] T-10 新增測試：`__tests__/ssh.test.ts`（`buildSshArgs` golden：選項順序/port/`--` 位置/LC_ALL 前綴，覆蓋 AC11；`classifySshFailure` 全分支：255+refused→UNREACHABLE、255+Permission denied→AUTH_FAILED、255+HOST IDENTIFICATION→HOSTKEY_CHANGED、null→TIMEOUT，覆蓋 AC9；錯誤回應不含 stderr 內容斷言，覆蓋 AC10）；`__tests__/remote-parsers.test.ts`（Rocky 真實輸出 fixture：多磁碟、swap=0、截斷輸出，覆蓋 AC5/AC11）。

## Phase 4 — server：遠端容器

- [x] T-11 實作 `GET /api/nodes/:id/containers`：`sshExec(node, DOCKER_PS_CMD)` → `parseDockerPsJson()` → `{dockerAvailable:true, containers}`；exit 127 / stderr 含 `command not found` → 200 `{dockerAvailable:false, containers:[]}`（與 metrics 為獨立 ssh 呼叫，互不影響）。
- [x] T-12 新增測試：多行 JSON 解析、空清單、壞行丟棄其餘保留、docker 缺席 200 形狀（AC6）、state enum 驗證；並跑 `grep -rE 'docker (start|stop|restart|rm|exec)|systemctl' apps/server/src/modules/nodes/` 確認零命中（AC7）。

## Phase 5 — web：/nodes 頁

- [ ] T-13 新增 `apps/web/src/hooks/use-nodes.ts`：keys object + `useNodes()`、`useAddNode()`/`useRemoveNode()`/`useTestNode()`（useMutation + invalidateQueries，慣例同 `use-toolbox.ts`）、`useNodeMetrics(id)` 帶 `refetchInterval: 10_000`、`useNodeContainers(id)` 帶 `refetchInterval: 30_000`，皆 `retry: false`（AC12）。
- [ ] T-14 新增 `apps/web/src/routes/nodes/nodes-page.tsx`：節點清單＋新增 dialog（內嵌 `ssh-copy-id root@<host>` 指引文案）＋刪除/測試鈕（test 顯示 latencyMs）；選定節點顯示狀態卡（CPU%/loadAvg/mem/disks/uptime）與容器表格；query error 依錯誤碼渲染狀態 pill（unreachable/auth-failed/hostkey-changed/timeout），`dockerAvailable:false` 顯示「未安裝 Docker」空狀態。
- [ ] T-15 掛載：`App.tsx` lazy Route `/nodes`（`AuthGuard` 內）、`sidebar.tsx` items 加 `nav.nodes` 項（Lucide `Server` 系 icon）。
- [ ] T-16 i18n：`en.json` 與 `zh-TW.json` 同步加 `nav.nodes` + `nodes.*` 全部 key（含各錯誤碼文案）；跑 `apps/web` workspace 測試確認 `i18n-parity.test.ts` 綠（AC12）。

## Phase 6 — 文件 + smoke 腳本 + release 收尾

- [ ] T-17 新增 `docs/nodes.md`：onboarding 一行流（234 上 `ssh-keygen -t ed25519` → `ssh-copy-id root@192.168.199.235` → 面板註冊）、TOFU/`accept-new` 政策與指紋變更處置（known_hosts）、錯誤碼一覽（`NODES_UNREACHABLE`/`NODES_AUTH_FAILED`/`NODES_HOSTKEY_CHANGED`/`NODES_TIMEOUT`/`NODES_TOOL_MISSING`）、明確標注「唯讀，無任何遠端操作」。
- [ ] T-18 新增 `scripts/smoke-nodes-234.sh`（慣例同 `smoke-toolbox-234.sh`/`smoke-backups-234.sh`）：S1 註冊 235 + test ok、S2 metrics 形狀（jq 驗 `cpu.usage`/`mem.total`/`uptimeSec`）、S3 containers 形狀（state ∈ enum）、S4 註冊 192.0.2.1 打 metrics 驗 502 `NODES_UNREACHABLE`、結束清理測試節點（全程唯讀、非破壞性）。
- [ ] T-19 版本收尾：bump 4 個 package.json（root/`apps/server`/`apps/web`/`packages/shared`，0.6.1 → 0.6.2）；README 與 README_zh-TW 版本表補 v0.6.2 列。
- [ ] T-20 全量驗證：`pnpm typecheck && pnpm lint && pnpm test && pnpm build` 全綠（AC13）；確認 `apps/server/package.json`（除 version 外）與 `apps/server/drizzle/` 無 diff（AC8）。
- [ ] T-21 Release + 實機 smoke（Rocky 234）：release commit `release(v0.6.2): remote node read-only monitoring`；部署後跑 `scripts/smoke-nodes-234.sh` 全過 + 手動驗證失效金鑰→auth-failed pill（AC14）；smoke 結果與 meta `status: completed` 記入 change folder。
