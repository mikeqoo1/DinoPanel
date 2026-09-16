# Smoke — v0.6.6 Podman 支援（本機 Ubuntu 24.04，podman 6.1.1 rootless，docker 29.1.3 並存）

日期：2026-09-16

| # | 內容 | 結果 |
|---|---|---|
| A | `CONTAINER_PS_CMD` 在 PATH 只有 podman/bash 的環境執行 | 過。輸出兩行 `{{json .}}`，含 `Id`、`Names:["uconx-db"]`、`State:"created"/"exited"`、`Labels.com.docker.compose.project` |
| A2 | PATH 只有 bash（無 docker 無 podman） | 過。exit 127，無輸出 |
| C | dockerode 直連 `/run/user/1000/podman/podman.sock` | 過。`info` ServerVersion 6.1.1；listContainers 2；label filter `com.docker.compose.project` 2；inspect OK；images 41 / networks 5 / volumes 10 |
| E2E | `node dist/main.js` 帶 `DOCKER_SOCKET_PATH=/run/user/1000/podman/podman.sock PORT=3999`，admin 登入後打 API | 過。`/api/containers` 200×2、`/api/compose` 200×1（discovered stack `ucodexup`，services db/uconx）、`/api/images` 200×41、`/api/networks` 200×5、`/api/volumes` 200×10 |

備註：
- E2E 的 compose 偵測命中 `docker compose`（本機有 docker compose plugin），`podman compose` 路徑靠 CS-11 單元測試
  與手動 `podman compose version`（會轉給 `/usr/libexec/docker/cli-plugins/docker-compose`）確認可執行。
- server log 的 `EACCES mkdir /opt/dinopanel` 是 dev 非 root 既有雜訊，與本次無關。
- 未驗：純 Podman 遠端主機在 /nodes 的實際畫面、Podman 主機上 compose up/down（見 tasks T-7）。

## 234 部署 + 遠端真機驗證（2026-09-16）

**部署**：`~/upgrade-0.6.6.sh`（stop → `dinopanel.db{,-wal,-shm}.pre-0.6.6` 一致備份 → 解 tarball
`dinopanel-0.6.6-87d76a6-prebuild-x64.tar.gz` → `install.sh` upgrade 模式 → verify）。install.sh 的
npm 12 預檢命中並由 tarball 預編譯檔修復 better-sqlite3 / node-pty，migration 過，服務 active、
`server/package.json` 0.6.6、`:9999/api/nodes` 未帶 token 401、首頁 200。

**14 台節點實跑面板同一條 `CONTAINER_PS_CMD`（root@234 → 各節點）**：

| 節點 | 帳號 | 引擎 | exit | 結果 |
|---|---|---|---|---|
| 235、ConeX-dev1/dev2、emts-rd-03-foreman、vm-conex-pmk1/2 | root / mike / conex | docker + podman | 0 | docker 優先，17 / 15 / 0 / 9 / 2 / 1 個容器 |
| vm-dcore-test1/2 | 110084-mike | docker | 0 | 55 / 43 個容器 |
| vm-dcore-quote-1~3 | conex | docker + podman | 1 | `permission denied … /var/run/docker.sock`（conex 不在 docker group） |
| vm-conex-app-qa1~3 | conex | docker | 1 | 同上 |

→ 全 fleet 沒有一台純 Podman 主機，fallback 在真實清單上不會觸發。

**純 Podman 模擬（ConeX-dev1，Alma 9.8，podman 5.8.2 rootless）**：在遠端建 PATH 只含 podman+bash 的
暫存目錄，經 root@234 的 SSH 執行同一條命令 → exit 0、3 行 `{{json .}}`（running=2 exited=1，
與 `podman ps -a | wc -l` 一致）；PATH 只含 bash → exit 127；正常 PATH → docker 15 個。**AC1 真機成立。**

**面板 HTTP 層（`scripts/smoke-podman-nodes-234.sh`，admin 登入 `:9999`）**：與 root 直跑逐台一致 —
235 / ConeX-dev1 / ConeX-dev2 / foreman / pmk1 / pmk2 / test1 / test2 → 200 `dockerAvailable:true`，
容器數 17 / 15 / 0 / 9 / 2 / 1 / 55 / 43，state 全在 enum 內；quote-1~3 + app-qa1~3（conex）→ 500 `NODES_COMMAND_FAILED`。
無任何節點回 `dockerAvailable:false`（fleet 全有 docker）。

**順手發現（另案）**：6 台 conex 節點是「docker 有裝但 socket 無權限」，`isDockerAbsent` 不認 → 面板回 500
`NODES_COMMAND_FAILED`，UI 看不出是權限問題。修法二選一：operator 端 `usermod -aG docker conex`；
或面板端把 `permission denied … docker.sock` 辨識成獨立 code（例 `NODES_ENGINE_PERMISSION_DENIED`）給 UI 明講。
