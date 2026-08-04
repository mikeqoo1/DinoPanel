# v0.6.2 — 部署交接（T-21 未完成部分）

**狀態：** 程式碼完成、release 已切、tarball 已送達；**實機 smoke 待維運執行**（需要 234 的 root，代理端無此權限）。

## 已完成

| 項目 | 證據 |
|---|---|
| T-1 ~ T-20 全部完成 | tasks.md 全勾 |
| 全量驗證 | `pnpm typecheck && lint && test && build` 全綠，561 tests（main 基線 464） |
| AC7 唯讀保證 | `grep -rE 'docker (start\|stop\|restart\|rm\|exec)\|systemctl' apps/server/src/modules/nodes/` 零命中 |
| AC8 零依賴／零 migration | `apps/server/package.json` 除 version 外無 diff；`apps/server/drizzle/` 無 diff |
| 對抗式 review | round 1 REQUEST_CHANGES（1 block，已修並實證）→ round 2 **APPROVE**（零 block） |
| check-spec 稽核 | **APPROVE**，記錄於 meta.json（`verifiedSha` = `753d416`） |
| release commit | `753d416 release(v0.6.2): remote node read-only monitoring` |
| tarball 送達 234 | `/home/mike/dinopanel-0.6.2-1cc5fdb-prebuild-x64.tar.gz`（16 MB，2026-08-04 10:22） |

### 已對真機 235 做過的活體前置驗證（唯讀，未改動 235）

在部署前直接以 ssh 對 192.168.199.235 跑面板將使用的兩條常數命令，確認 parser 對真機輸出成立：

- `METRICS_CMD` → exit 0，5 個 `__DINO__` 分隔正確，`df -PTB1` 的 fstype 欄如預期（`/dev/mapper/rl-root xfs`、`/dev/md126p2 xfs`、`/dev/md126p1 vfat`）、loadavg／uptime 皆可解析。
- `DOCKER_PS_CMD` → exit 0，該機跑 GitLab EE 19.2.1 + gitlab-runner 系列容器，state 涵蓋 `running` / `created` / `exited`，**全部落在 `ContainerState` enum 內**。
- **抓出一個真實缺陷**：`efivarfs` 混入遠端磁碟表（硬寫的 `df -x` 清單漏掉它，而本機磁碟表自 v0.6.1 起就用共用 `isRealFilesystem()` 隱藏它）。已改為重用共用 predicate，並以 235 的原始輸出當 fixture（commit `1cc5fdb`）。

## 待維運執行（需要 234 的 root）

代理端只有 `mike@234` 的金鑰登入、無免密 sudo，`root@234` 拒絕公鑰 — 以下三步無法代勞。

### 1. 安裝 v0.6.2（234 上，root）

沿用既有流程（`bash scripts/deploy-rocky.sh --help` 會印出完整指令）：解開
`~/dinopanel-0.6.2-1cc5fdb-prebuild-x64.tar.gz` 後跑 `install.sh`，重啟面板服務。
**本版無 drizzle migration，不需 `db:migrate`。**

### 2. 佈金鑰：root@234 → 235（一次性）

金鑰必須屬於**面板的執行身分**（234 上的 root）。在 234 上以 root 執行：

```bash
[ -f ~/.ssh/id_ed25519 ] || ssh-keygen -t ed25519 -N ''
ssh-copy-id root@192.168.199.235      # 輸入 235 的 root 密碼（一次性，面板不儲存任何密碼）
ssh -o BatchMode=yes root@192.168.199.235 true && echo "key OK"
```

最後一行必須成功 — 面板用 `BatchMode=yes`，沒有金鑰就會直接回 `NODES_AUTH_FAILED`，不會退回互動式密碼。

### 3. 跑 smoke（可從任何能連到面板 API 的機器）

```bash
DP_USER=<admin> DP_PASS=<pass> bash scripts/smoke-nodes-234.sh
```

S1 註冊 235 + test 連線 + 409 重複防護、S2 metrics 形狀、S3 containers 形狀（該機有 docker，state enum 會真的被驗到）、S4 假 IP 192.0.2.1 → 502 `NODES_UNREACHABLE`。腳本結束會自行刪除測試節點（`trap cleanup EXIT`，失敗也會清）。

另需手動驗一項 AC14 無法自動化的部分：暫時弄壞金鑰（例如把 235 的 `authorized_keys` 該行改掉）後開 `/nodes`，確認 UI 顯示 **auth-failed 狀態 pill** 而非崩潰或無限轉圈。

## 收尾條件

smoke 全過後：把結果寫成 `smoke-pass.md`（慣例同 v0.6.1）、勾掉 T-21、`node /Projects/arceus/dist/cli.js change status v0.6.2-remote-node-monitoring completed`。

## 已知落差（誠實記錄）

- check-spec 的 `verifiedSha` 是 `753d416`，**不含**其後的 `1cc5fdb`（efivarfs 修補）。重跑稽核時 check-spec 自身的 API key 額度不足而失敗（非程式問題）。該 commit 已由 review 者人工檢視 + 全量驗證通過，但未經 check-spec 獨立判決；額度恢復後可補跑 `change verify`。
- `add()`/`remove()` 的 read-modify-write 競態刻意未修（單一管理者面板），程式碼留 `// ponytail:` 註記天花板與升級路徑。
- websites/databases 的 stderr 外洩仍是 v0.6 遺留的 followup，本章未觸碰（nodes 模組本身不新增外洩點）。
