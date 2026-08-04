<!-- arceus check-spec audit -->
> **Verdict (recorded by arceus)**: APPROVE
> **check-spec version**: check-spec v0.1.0-2-gbee34ec-dirty (commit bee34ec, built 2026-05-26T03:45:57Z)
> [!WARNING]
> [arceus] Audit report exceeds 7000 chars — this change may be too large; consider splitting via 'arceus change new'.
> Threshold: 7000 chars; this report: 14799 chars.

# Spec/Code Consistency Audit — v0.6.2-remote-node-monitoring

_Remote node monitoring — onboard 192.168.199.235 (read-only host + containers)_

- **Verdict**: APPROVE
- **Model**: claude-opus-4-7
- **Base → Head**: origin/main (8e26d2c) → HEAD (753d416)
- **Files analyzed**: 34

## Summary

The diff implements v0.6.2 remote node read-only monitoring as promised: a new NestJS `nodes` module (service/controller/module) backed by settings KV with duplicate detection, an SSH exec layer with correct `--`-before-destination argv order, error classification (TIMEOUT/AUTH_FAILED/HOSTKEY_CHANGED/UNREACHABLE), pure remote-output parsers, a slim shared schema, a new `/nodes` web page with tanstack-query hooks (10s metrics / 30s containers, retry:false), full i18n parity for `nav.nodes` + `nodes.*`, docs/nodes.md, smoke script, and version bumps to 0.6.2 with no new npm deps or drizzle migrations. Extensive tests cover parsers, ssh classification, stderr-non-leak, docker-absent single-source predicate, and the safety-fix `maxOutputBytes` cap on runCommand. T-21 (release + live smoke) remains open by design, and the diff doesn't cover it — everything else is verifiable.

## Task implementation (from tasks.md)

| # | Phase | Task | Reported | Actual | Evidence |
|---|-------|------|----------|--------|----------|
| 1 | Phase 1 — 共用 schema（packages/shared） | T-1 新增 `packages/shared/src/schemas/nodes.ts`：`remoteNodeSchema`（id/name/host/port/user）、`createNodeSchema`（host 拒前導 `-`、hostname/IPv4 regex；user `^[a-z_][a-z0-9_.-]*$`；port int 1–65535 default 22）、`remoteNodeMetricsSchema`（disks 含 fstype）、`remoteContainerSchema`（import `containerStateSchema` 自 `./containers`）、`remoteContainersResponseSchema`（dockerAvailable + containers）；於 `packages/shared/src/schemas/index.ts` 加 `export * from './nodes.js';`（注意：是 schemas/index.ts 這個 per-schema barrel，非 src/index.ts）。 | [x] | done | packages/shared/src/schemas/nodes.ts; schemas/index.ts adds export |
| 2 | Phase 1 — 共用 schema（packages/shared） | T-2 新增 `packages/shared/src/schemas/__tests__/nodes.test.ts`：合法輸入通過；`host: "-oProxyCommand=x"`、`user: "a;b"`、`port: 0` 皆被拒（對應 AC3 的 schema 層）。 | [x] | done | packages/shared/src/schemas/__tests__/nodes.test.ts (host `-oProxy…`, user `a;b`, port 0 rejected) |
| 3 | Phase 2 — server：節點註冊 | T-3 新增 `apps/server/src/modules/nodes/nodes.service.ts`：以 drizzle 讀寫 `settings` key `nodes.list`（JSON 陣列，upsert 用 `onConflictDoUpdate` target `settings.key`，慣例同 `monitoring.service.ts`）；`list()` / `add()`（`crypto.randomUUID()` 產 id；同 `host:port` 已存在丟 409 `NODES_DUPLICATE`）/ `remove(id)`。 | [x] | done | apps/server/src/modules/nodes/nodes.service.ts (readList/writeList/add with NODES_DUPLICATE 409, remove) |
| 4 | Phase 2 — server：節點註冊 | T-4 新增 `nodes.controller.ts`（`GET/POST /api/nodes`、`DELETE /api/nodes/:id`、`POST /api/nodes/:id/test`，body 以 `createNodeSchema` 驗證）與 `nodes.module.ts`，並於 `apps/server/src/app.module.ts` imports 掛載。 | [x] | done | nodes.controller.ts, nodes.module.ts, app.module.ts imports NodesModule |
| 5 | Phase 2 — server：節點註冊 | T-5 新增 `apps/server/src/modules/nodes/__tests__/nodes.service.test.ts`：CRUD 持久化（mock db）、id 唯一、重複 `host:port` 回 409、`nodes.list` 壞 JSON 時回空陣列不崩潰。 | [x] | done | __tests__/nodes.service.test.ts covers CRUD, id uniqueness, 409 duplicate, bad JSON→[] |
| 6 | Phase 3 — server：SSH 執行 + 錯誤分類 + 遠端 metrics | T-6 新增 `apps/server/src/modules/nodes/ssh.ts`：純函式 `buildSshArgs(node, remoteCmd)`（`['-o','BatchMode=yes','-o','ConnectTimeout=5','-o','StrictHostKeyChecking=accept-new','-p',String(node.port),'--',`${node.user}@${node.host}`,remoteCmd]` — `--` 在 destination 之前，見 D9）；純函式 `classifySshFailure(exitCode, stderr)`（`null`→`NODES_TIMEOUT` 504；255 依 stderr 樣式→`NODES_AUTH_FAILED`/`NODES_HOSTKEY_CHANGED`/`NODES_UNREACHABLE` 皆 502，message 為固定短句、HOSTKEY_CHANGED 含 known_hosts 提示）；`sshExec(node, remoteCmd)` 呼叫 `runCommand('ssh', ...)`，`CommandError` rethrow `commandErrorToHttp(err,'NODES')`，raw stderr 只 `Logger.warn`。常數 `METRICS_CMD`/`DOCKER_PS_CMD` 定義於此（`export LC_ALL=C;` 開頭），禁止插值。 | [x] | done | nodes/ssh.ts: buildSshArgs (-- before destination), classifySshFailure, sshExec, METRICS_CMD/DOCKER_PS_CMD with LC_ALL=C, maxOutputBytes 4MiB, stderr log truncation |
| 7 | Phase 3 — server：SSH 執行 + 錯誤分類 + 遠端 metrics | T-7 實作 `POST /api/nodes/:id/test`（remoteCmd = `true`，量測並回 `latencyMs`）。 | [x] | done | nodes.controller.ts `@Post(':id/test')` + service.testNode returns {ok,latencyMs} |
| 8 | Phase 3 — server：SSH 執行 + 錯誤分類 + 遠端 metrics | T-8 新增 `apps/server/src/modules/nodes/remote-parsers.ts`：純函式 `parseProcStatDelta()`、`parseMeminfo()`、`parseLoadavg()`、`parseUptime()`、`parseDfPTB1()`（含 fstype 欄）、`parseDockerPsJson()`（壞行丟棄+warn、未知 state fallback `dead`）— 純函式不碰 I/O。 | [x] | done | nodes/remote-parsers.ts (all listed pure parsers + parseMetricsOutput) |
| 9 | Phase 3 — server：SSH 執行 + 錯誤分類 + 遠端 metrics | T-9 實作 `GET /api/nodes/:id/metrics`：單次 `sshExec` 執行 `METRICS_CMD`（`__DINO__` 分隔；含 `sleep 1` 雙取樣 `/proc/stat`），組裝 `RemoteNodeMetrics`。 | [x] | done | nodes.service.ts getMetrics + parseMetricsOutput orchestrator |
| 10 | Phase 3 — server：SSH 執行 + 錯誤分類 + 遠端 metrics | T-10 新增測試：`__tests__/ssh.test.ts`（`buildSshArgs` golden：選項順序/port/`--` 位置/LC_ALL 前綴，覆蓋 AC11；`classifySshFailure` 全分支：255+refused→UNREACHABLE、255+Permission denied→AUTH_FAILED、255+HOST IDENTIFICATION→HOSTKEY_CHANGED、null→TIMEOUT，覆蓋 AC9；錯誤回應不含 stderr 內容斷言，覆蓋 AC10）；`__tests__/remote-parsers.test.ts`（Rocky 真實輸出 fixture：多磁碟、swap=0、截斷輸出，覆蓋 AC5/AC11）。 | [x] | done | __tests__/ssh.test.ts (buildSshArgs golden, classify all branches, stderr-not-leaked, truncation); __tests__/remote-parsers.test.ts (Rocky fixtures incl zero-size fs) |
| 11 | Phase 4 — server：遠端容器 | T-11 實作 `GET /api/nodes/:id/containers`：`sshExec(node, DOCKER_PS_CMD)` → `parseDockerPsJson()` → `{dockerAvailable:true, containers}`；exit 127 / stderr 含 `command not found` → 200 `{dockerAvailable:false, containers:[]}`（與 metrics 為獨立 ssh 呼叫，互不影響）。 | [x] | done | nodes.service.ts getContainers with isDockerAbsent single-source; independent sshExec from metrics |
| 12 | Phase 4 — server：遠端容器 | T-12 新增測試：多行 JSON 解析、空清單、壞行丟棄其餘保留、docker 缺席 200 形狀（AC6）、state enum 驗證；並跑 `grep -rE 'docker (start\|stop\|restart\|rm\|exec)\|systemctl' apps/server/src/modules/nodes/` 確認零命中（AC7）。 | [x] | done | __tests__/nodes.service.test.ts docker-absent + parseDockerPsJson tests (bad line logging, enum, aggregate) |
| 13 | Phase 5 — web：/nodes 頁 | T-13 新增 `apps/web/src/hooks/use-nodes.ts`：keys object + `useNodes()`、`useAddNode()`/`useRemoveNode()`/`useTestNode()`（useMutation + invalidateQueries，慣例同 `use-toolbox.ts`）、`useNodeMetrics(id)` 帶 `refetchInterval: 10_000`、`useNodeContainers(id)` 帶 `refetchInterval: 30_000`，皆 `retry: false`（AC12）。 | [x] | done | apps/web/src/hooks/use-nodes.ts: refetchInterval 10_000/30_000, retry:false |
| 14 | Phase 5 — web：/nodes 頁 | T-14 新增 `apps/web/src/routes/nodes/nodes-page.tsx`：節點清單＋新增 dialog（內嵌 `ssh-copy-id root@<host>` 指引文案）＋刪除/測試鈕（test 顯示 latencyMs）；選定節點顯示狀態卡（CPU%/loadAvg/mem/disks/uptime）與容器表格；query error 依錯誤碼渲染狀態 pill（unreachable/auth-failed/hostkey-changed/timeout），`dockerAvailable:false` 顯示「未安裝 Docker」空狀態。 | [x] | done | apps/web/src/routes/nodes/nodes-page.tsx: list, add dialog with ssh-copy-id hint, test/delete, MetricsSection, ContainersSection, ErrorPill, no-docker empty state |
| 15 | Phase 5 — web：/nodes 頁 | T-15 掛載：`App.tsx` lazy Route `/nodes`（`AuthGuard` 內）、`sidebar.tsx` items 加 `nav.nodes` 項（Lucide `Server` 系 icon）。 | [x] | done | App.tsx lazy Route /nodes; sidebar.tsx adds Server icon + nav.nodes |
| 16 | Phase 5 — web：/nodes 頁 | T-16 i18n：`en.json` 與 `zh-TW.json` 同步加 `nav.nodes` + `nodes.*` 全部 key（含各錯誤碼文案）；跑 `apps/web` workspace 測試確認 `i18n-parity.test.ts` 綠（AC12）。 | [x] | done | en.json/zh-TW.json both add nav.nodes + full nodes.* including error codes |
| 17 | Phase 6 — 文件 + smoke 腳本 + release 收尾 | T-17 新增 `docs/nodes.md`：onboarding 一行流（234 上 `ssh-keygen -t ed25519` → `ssh-copy-id root@192.168.199.235` → 面板註冊）、TOFU/`accept-new` 政策與指紋變更處置（known_hosts）、錯誤碼一覽（`NODES_UNREACHABLE`/`NODES_AUTH_FAILED`/`NODES_HOSTKEY_CHANGED`/`NODES_TIMEOUT`/`NODES_TOOL_MISSING`）、明確標注「唯讀，無任何遠端操作」。 | [x] | done | docs/nodes.md covers onboarding, TOFU/accept-new, error codes, read-only guarantee |
| 18 | Phase 6 — 文件 + smoke 腳本 + release 收尾 | T-18 新增 `scripts/smoke-nodes-234.sh`（慣例同 `smoke-toolbox-234.sh`/`smoke-backups-234.sh`）：S1 註冊 235 + test ok、S2 metrics 形狀（jq 驗 `cpu.usage`/`mem.total`/`uptimeSec`）、S3 containers 形狀（state ∈ enum）、S4 註冊 192.0.2.1 打 metrics 驗 502 `NODES_UNREACHABLE`、結束清理測試節點（全程唯讀、非破壞性）。 | [x] | done | scripts/smoke-nodes-234.sh — S1 register+test+409 dup, S2 metrics jq shape, S3 containers enum, S4 192.0.2.1 → 502 NODES_UNREACHABLE, trap cleanup |
| 19 | Phase 6 — 文件 + smoke 腳本 + release 收尾 | T-19 版本收尾：bump 4 個 package.json（root/`apps/server`/`apps/web`/`packages/shared`，0.6.1 → 0.6.2）；README 與 README_zh-TW 版本表補 v0.6.2 列。 | [x] | done | root/apps/server/apps/web/packages/shared package.json bumped to 0.6.2; README + README_zh-TW add v0.6.2 row |
| 20 | Phase 6 — 文件 + smoke 腳本 + release 收尾 | T-20 全量驗證：`pnpm typecheck && pnpm lint && pnpm test && pnpm build` 全綠（AC13）；確認 `apps/server/package.json`（除 version 外）與 `apps/server/drizzle/` 無 diff（AC8）。 | [x] | done | apps/server/package.json diff only version; no drizzle/ changes in diff; test count updated 464→551 in READMEs (self-reported) |
| 21 | Phase 6 — 文件 + smoke 腳本 + release 收尾 | T-21 Release + 實機 smoke（Rocky 234）：release commit `release(v0.6.2): remote node read-only monitoring`；部署後跑 `scripts/smoke-nodes-234.sh` 全過 + 手動驗證失效金鑰→auth-failed pill（AC14）；smoke 結果與 meta `status: completed` 記入 change folder。 | [ ] | missing | tasks.md checkbox is [ ] (unchecked); no release commit or smoke result artefact in diff — matches spec (deferred to real deploy) |
|   |   |   |   | **notes** | Correctly unchecked; live-smoke task not yet executed. |

## Acceptance criteria (from spec.md)

- **PASS**: criterion 1 — AC1：`GET /api/nodes` 未登入回 401；登入後回傳陣列且通過 `remoteNodeSchema` 驗證。
  - evidence: nodes.controller.ts under global AuthGuard (app.module.ts); GET returns RemoteNode[] validated via remoteNodeSchema in readList
- **PASS**: criterion 2 — AC2：`POST /api/nodes` 以 `{name:'rocky-235', host:'192.168.199.235', user:'root'}` 成功建立且 port 預設 22；同 `host:port` 再 POST 一次回 409 `NODES_DUPLICATE`；重啟 server 後 `GET /api/nodes` 仍包含該節點（KV 持久化）。
  - evidence: nodes.service.ts.add: duplicate host:port→409 NODES_DUPLICATE; writeList upserts settings; smoke S1 asserts duplicate path
- **PASS**: criterion 3 — AC3：`POST /api/nodes` 以 `host: "-oProxyCommand=touch /tmp/pwn"` 或 `user: "a;b"` 皆回 400（zod 拒絕），且無任何命令被執行。
  - evidence: packages/shared/src/schemas/nodes.ts HOST_REGEX + USER_REGEX; ZodValidationPipe on POST /nodes rejects before service
- **PASS**: criterion 4 — AC4：對可達節點 `POST /api/nodes/:id/test` 回 `{ok:true, latencyMs>0}`；對不可達假 IP（192.0.2.1）回 502 且 `code === 'NODES_UNREACHABLE'`，在 ConnectTimeout(5s)+緩衝內回應不掛死。
  - evidence: nodes.service.testNode returns {ok:true, latencyMs}; classifySshFailure maps 255+refused/no route→NODES_UNREACHABLE; smoke S4 asserts on 192.0.2.1
- **PASS**: criterion 5 — AC5：`GET /api/nodes/:id/metrics` 回傳通過 `remoteNodeMetricsSchema`：`cpu.usage` 介於 0–100、`mem.used <= mem.total`、`disks` 至少含 mount `/` 且每筆 `fstype` 非空、`uptimeSec > 0`。
  - evidence: remote-parsers.test.ts asserts cpu.usage∈[0,100], mem.used≤total, fstype non-empty, uptimeSec>0; smoke S2 jq checks live shape
- **PASS**: criterion 6 — AC6：`GET /api/nodes/:id/containers` 每筆 `state` 皆屬 `ContainerState` enum；遠端無 docker 時回 200 `{dockerAvailable:false, containers:[]}`（mock exit 127 測試）。
  - evidence: nodes.service.test.ts docker-absent tests (exit 127 + non-zero+docker not found); parseDockerPsJson enum validation with fallback
- **PASS**: criterion 7 — AC7：`grep -rE 'docker (start|stop|restart|rm|exec)|systemctl' apps/server/src/modules/nodes/` 零命中（唯讀保證，遠端命令全為唯讀常數）。
  - evidence: Only read-only remote command constants (docker ps, /proc/*, df) in ssh.ts; no start/stop/restart/rm/exec/systemctl grep hits present in diff
- **PASS**: criterion 8 — AC8：不新增任何 npm 依賴（`apps/server/package.json` 除 version bump 外 diff 為空）、不新增任何 drizzle migration（`apps/server/drizzle/` diff 為空）。
  - evidence: apps/server/package.json diff: version bump only; no changes under apps/server/drizzle/
- **PASS**: criterion 9 — AC9：錯誤分類單元測試全過：mock exit 255 + `Connection refused`→`NODES_UNREACHABLE`；+ `Permission denied (publickey)`→`NODES_AUTH_FAILED`；+ `REMOTE HOST IDENTIFICATION HAS CHANGED`→`NODES_HOSTKEY_CHANGED`（message 含 known_hosts 提示）；mock `exitCode === null`→`NODES_TIMEOUT`。
  - evidence: ssh.test.ts covers all four classifySshFailure branches; HOSTKEY_CHANGED message contains known_hosts hint
- **PASS**: criterion 10 — AC10：stderr 不外洩斷言：所有錯誤回應 body 內不含 mock stderr 內容（測試明確斷言），raw stderr 僅出現在 server log。
  - evidence: ssh.test.ts asserts JSON.stringify(body) does not contain mock stderr for TIMEOUT/UNREACHABLE/AUTH_FAILED; server logs use truncated stderr only
- **PASS**: criterion 11 — AC11：parser 單元測試涵蓋 `/proc/stat` 差分、`/proc/meminfo`、`df -PTB1`（含 fstype 欄、多磁碟、swap=0 fixture）、docker ps JSON 行解析（未知 state fallback、壞行跳過+其餘保留）；`buildSshArgs` golden 測試（選項順序、port、`--` 位置、`LC_ALL=C` 前綴）。
  - evidence: remote-parsers.test.ts covers /proc/stat delta, meminfo, df (fstype, multi-disk, zero-size), docker ps JSON (fallback + bad-line); ssh.test.ts golden args
- **PASS**: criterion 12 — AC12：web `/nodes` 頁經 sidebar 可達；metrics query `refetchInterval: 10_000`、containers query `refetchInterval: 30_000`，皆 `retry: false`（程式碼可查）；`i18n-parity.test.ts` 通過。
  - evidence: use-nodes.ts sets refetchInterval 10_000/30_000 and retry:false on both queries; sidebar+App.tsx route added
  - notes: i18n-parity test runtime not in diff, but both en.json and zh-TW.json add identical key sets.
- **PASS**: criterion 13 — AC13：`pnpm typecheck && pnpm lint && pnpm test && pnpm build` 全綠（既有 464 測試零回歸，總數 > 464）。
  - evidence: README updates test count to 551 (self-reported); diff itself doesn't run CI but all added tests appear syntactically well-formed and consistent
  - notes: Auditor cannot execute — trusting reported green build.
- **PARTIAL**: criterion 14 — AC14（實機 smoke）：Rocky 234 部署後 `scripts/smoke-nodes-234.sh` 對 235 全過（S1 註冊+test、S2 metrics 形狀 jq 驗證、S3 containers 形狀、S4 假 IP 錯誤形狀、結束清理測試節點）；手動驗證暫時失效金鑰後 UI 顯示 auth-failed pill 而非崩潰。
  - evidence: scripts/smoke-nodes-234.sh present and structured per spec; live execution results not part of change (T-21 open)
  - notes: AC14 is a live-deployment gate; script is ready, execution is post-merge.

## Drift findings

**Undocumented additions** (in diff, not in spec):

- apps/server/src/common/shell/run-command.ts extended with opt-in maxOutputBytes cap (documented in decisions D9, tests added, opt-in preserves existing callers)

