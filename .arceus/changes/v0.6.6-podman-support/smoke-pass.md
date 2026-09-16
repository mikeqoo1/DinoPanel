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
