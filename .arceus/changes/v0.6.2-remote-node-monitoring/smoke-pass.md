# v0.6.2 — Rocky 234 實機 smoke PASS

**日期：** 2026-08-04
**面板：** `emts-rd-01.concords.com.tw`（192.168.199.234），v0.6.2（commit `1cc5fdb`）
**受監控節點：** `EMST-Test02`（192.168.199.235），root、port 22、108 天 uptime、跑 GitLab EE + gitlab-runner
**執行方式：** `DP_USER=admin DP_PASS=… BASE_URL=http://192.168.199.234:9999 bash scripts/smoke-nodes-234.sh`

## S1–S4（腳本自動）— 全過

```
==> S1 — register 192.168.199.235 + test connection + 409 NODES_DUPLICATE
  PASS registered smoke-235, id=97bf5de8-03b4-496e-8ab1-24e7239d19cc
  PASS test ok=true latencyMs=830ms
  PASS duplicate host:port → 409 NODES_DUPLICATE
==> S2 — GET :id/metrics
  PASS cpu.usage=3 (0–100)
  PASS mem.total=269506564096
  PASS uptimeSec=9333346
  PASS disks=4 entries
==> S3 — GET :id/containers
  PASS dockerAvailable=true
  PASS all 15 container(s) have valid ContainerState
==> S4 — register 192.0.2.1 (TEST-NET, unreachable)
  PASS 192.0.2.1 metrics → 502 NODES_UNREACHABLE

Nodes smoke S1–S4 PASSED
```

腳本結束自動刪除兩個測試節點（`trap cleanup EXIT`），事後 `GET /api/nodes` 回 `[]` 確認乾淨。

### S2 的兩個交叉驗證

- **`disks=4` 證實 efivarfs 修補在真機生效**：235 的原始 `df -PTB1` 有 5 筆（`efivarfs`、`/`、`/home`、`/boot`、`/boot/efi`），回傳只剩 4 筆真實檔案系統 — 共用 `isRealFilesystem()` 濾掉了 `efivarfs`，與本機磁碟表行為一致。
- **`uptimeSec=9333346` ≈ 108 天**，與 235 上 `uptime` 指令回報的 108 days 相符，確認 `/proc/uptime` 解析無誤。

## 手動驗證（AC14 / AC3 / AC10）— 全過

### auth-failed（AC14）

刻意**不動 235 的 `authorized_keys`**（生產設定），改以無金鑰的使用者打同一條路徑，命中相同的 `Permission denied (publickey)`：

```
POST /api/nodes {"host":"192.168.199.235","user":"nokeyuser"}   → 201
GET  /api/nodes/:id/metrics                                     → HTTP 502
{"code":"NODES_AUTH_FAILED","message":"SSH authentication failed"}
```

**同時實機驗證 AC10**：回應 body 只有 code + 固定短句，**沒有任何 raw stderr 外洩**（`Permission denied (publickey)` 僅存在於 server log）。

### 注入防護（AC3）

```
{"host":"-oProxyCommand=touch /tmp/dinopanel_pwn","user":"root"}  → HTTP 400
{"host":"192.168.199.235","user":"a;b"}                           → HTTP 400
{"host":"192.168.199.235","user":"root","port":0}                 → HTTP 400
GET /api/nodes                                                     → []
234 上 ls /tmp/dinopanel_pwn → No such file or directory
```

三種輸入全被 zod 擋在寫入前，且**沒有任何命令被執行**（ProxyCommand 的檔案不存在）。

### AC1（實機半驗）

`GET /api/nodes` 未帶 token → **401** `AUTH_TOKEN_MISSING`（v0.6.1 會是 404，因此同時證明 nodes 模組確實掛載、v0.6.2 已上線）。

## 未在實機驗證的項目

- **AC2 的「重啟 server 後節點仍存在」**：未實機重啟驗證（不想為此再中斷一次生產服務）。KV 持久化機制與 PMM credentials 完全相同且有單元測試覆蓋。
- **UI 層的狀態 pill 渲染**：以上驗的是 API 契約（錯誤碼 + 固定訊息）。前端依錯誤碼渲染 pill 有程式碼與 hook 測試覆蓋，但沒有人工開瀏覽器逐一看過四種 pill。
- **docker 缺席的 200 `{dockerAvailable:false}`**：235 有裝 docker，故此分支只有單元測試（mock exit 127）覆蓋，未在真機命中。

## 部署備註

本次部署踩到 npm 12 預設封鎖 install scripts 的問題（服務曾一度停擺），根因、窄範圍修復與後續建議見 `deploy-handoff.md`。升級前備份留在 `/var/lib/dinopanel/dinopanel.db{,-wal,-shm}.pre-0.6.2`。
