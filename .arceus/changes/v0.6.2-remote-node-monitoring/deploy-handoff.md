# v0.6.2 — 部署記錄與 T-21 現況

**現況：** v0.6.2 **已上線** Rocky 234（`emts-rd-01`）並運作正常；root@234 → 235 金鑰已佈好並驗證免密。**smoke 尚未跑 — 卡在缺面板管理員帳密。**

## 已完成

| 項目 | 證據 |
|---|---|
| T-1 ~ T-20 | tasks.md 全勾；561 tests 全綠（main 基線 464） |
| AC7 唯讀保證 | `grep -rE 'docker (start\|stop\|restart\|rm\|exec)\|systemctl' apps/server/src/modules/nodes/` 零命中 |
| AC8 零依賴／零 migration | `apps/server/package.json` 除 version 外無 diff；`drizzle/` 無 diff |
| 對抗式 review | round 1 REQUEST_CHANGES（1 block，已修並實證）→ round 2 **APPROVE** |
| check-spec | **APPROVE**（`verifiedSha` = `753d416`，見下方落差） |
| **部署 234** | `install.sh` upgrade 模式；`/usr/local/dinopanel/server/package.json` = 0.6.2；服務 active、journal 無 error |
| **AC1 半驗（實機）** | `GET /api/nodes` 未帶 token → **401** `AUTH_TOKEN_MISSING`（舊版會是 404，證明 nodes 模組確實掛載） |
| **金鑰佈署** | root@234 產 ed25519 → 附加到 235 的 `authorized_keys`（idempotent）→ `ssh -o BatchMode=yes root@192.168.199.235` 成功回 `EMST-Test02`（108 天 uptime） |
| DB 備份 | 停服務後複製（一致快照）：`/var/lib/dinopanel/dinopanel.db{,-wal,-shm}.pre-0.6.2` |

### 對真機 235 的活體前置驗證（唯讀，部署前做）

- `METRICS_CMD` → exit 0，段落分隔正確，`df -PTB1` fstype 欄如預期（`rl-root xfs`、`md126p2 xfs`、`md126p1 vfat`）。
- `DOCKER_PS_CMD` → exit 0；235 跑 GitLab EE 19.2.1 + gitlab-runner，state 涵蓋 `running`/`created`/`exited`，全在 `ContainerState` enum 內。
- **抓出一個真實缺陷並修掉**：`efivarfs` 混入遠端磁碟表（硬寫的 `df -x` 漏掉它，本機磁碟表自 v0.6.1 就用共用 `isRealFilesystem()` 隱藏它）→ 改為重用共用 predicate，fixture 取自 235 原始輸出（commit `1cc5fdb`）。

## ⚠️ 部署根因：npm 12 預設封鎖 install scripts（會擋掉未來每次部署）

`install.sh` 第 257 行 `npm install --omit=dev --no-package-lock --silent` **回傳成功，但原生模組完全沒編譯**：

```
5 packages have install scripts blocked because they are not covered by allowScripts:
  better-sqlite3@12.11.1 (install: prebuild-install || node-gyp rebuild --release)
  node-pty@1.1.0        (install: node scripts/prebuild.js || node-gyp rebuild; postinstall: …)
  cpu-features@0.0.10, protobufjs@7.6.5, ssh2@1.17.0
```

234 的 npm 已是 **12.0.1**，新版預設不執行套件 install script。於是 `npm install` 靜默「成功」，接著 install.sh 的 DB 步驟（內嵌 node script 開 SQLite）以 `Could not locate the bindings file` 崩掉，**服務留在停止狀態**。v0.6.1（2026-06-03）裝得起來是因為當時 npm 還沒這行為 — **環境變了，不是 v0.6.2 的程式問題**。

**本次採用的窄範圍修復**（刻意不對任何套件開放腳本權限）：

1. better-sqlite3：於套件目錄跑 `prebuild-install`，取官方預編譯 `build/Release/better_sqlite3.node`。
2. node-pty：tarball 本來就帶 `prebuilds/linux-x64/pty.node`（`--prebuild=x64` 的產物），複製到 `build/Release/pty.node`（即其 post-install 會做的事）。
3. 驗證 `require()` 兩者皆 OK → 啟動服務 → health ok、journal 無 error。

`cpu-features` / `protobufjs` / `ssh2` 的 script 仍封鎖：前者是 ssh2 的選用效能優化，後兩者不影響啟動，實測無 runtime error。

**建議的 followup（不在 tasks.md，需你核准才動工）**：
- `install.sh` 在 `npm install` 後加一道 preflight — 找不到 `better_sqlite3.node` / `pty.node` 就大聲失敗並印出 `prebuild-install` 的修復指令，而不是讓後面的步驟丟看不懂的 bindings 錯誤、把服務留在停止狀態。
- `docs/deployment.md` 補記 npm ≥ 12 的 script 封鎖行為與處置。
- 考慮讓 `build-release.sh --prebuild` 也收 better-sqlite3 的 `.node`（目前只收 node-pty），這樣目標機完全不需要網路或編譯。

## 待辦：跑 smoke（缺帳密）

`scripts/smoke-nodes-234.sh` 需要面板管理員帳密（升級模式保留了原有管理員；記錄在 memory 的 dev 帳號 `admin/DinoTest1234` 在 234 上回 401）。取得後執行：

```bash
DP_USER=<admin> DP_PASS=<pass> bash scripts/smoke-nodes-234.sh
```

S1 註冊 235 + test 連線 + 409 重複防護、S2 metrics 形狀、S3 containers 形狀（235 有 docker，state enum 會真的被驗到）、S4 假 IP 192.0.2.1 → 502 `NODES_UNREACHABLE`；結束自動刪除測試節點。

另需手動驗 AC14 無法自動化的部分：暫時弄壞 235 的 `authorized_keys` 該行 → 開 `/nodes` 確認顯示 **auth-failed 狀態 pill** 而非崩潰。

smoke 全過後：寫 `smoke-pass.md`、勾 T-21、`node /Projects/arceus/dist/cli.js change status v0.6.2-remote-node-monitoring completed`。

## 已知落差（誠實記錄）

- check-spec 的 `verifiedSha` = `753d416`，**不含**其後的 `1cc5fdb`（efivarfs 修補）。重跑時 check-spec 自身的 API key 額度不足而失敗（非程式問題），額度恢復可補跑 `change verify`。
- `add()`/`remove()` 的 read-modify-write 競態刻意未修（單一管理者面板），程式碼留 `// ponytail:` 註記天花板與升級路徑。
- websites/databases 的 stderr 外洩是 v0.6 遺留 followup，本章未觸碰。
- health 端點的 `version` 欄回報 `0.1.0-dev`（升級前後皆然，與本章無關的既有小瑕疵）。
