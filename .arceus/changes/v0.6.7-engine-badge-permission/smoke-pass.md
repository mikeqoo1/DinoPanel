# Smoke — v0.6.7（2026-09-17）

## 本機 E2E（Ubuntu，dist server :3999，admin dev 帳號）

| socket | `GET /api/containers/engine` |
|---|---|
| `/run/user/1000/podman/podman.sock` | 200 `{"engine":"podman","version":"6.1.1"}`，第二次相同（快取） |
| `/var/run/docker.sock` | 200 `{"engine":"docker","version":"29.1.3"}`，第二次相同 |
| `/nonexistent.sock` | 503 `DOCKER_UNREACHABLE` |

## 234 部署（v0.6.6 → v0.6.7）

`~/upgrade-0.6.7.sh`（`upgrade-0.6.6.sh` 改名而來）：stop → `dinopanel.db{,-wal,-shm}.pre-0.6.7` → 解
`dinopanel-0.6.7-e6a9220-prebuild-x64.tar.gz` → install.sh upgrade（npm12 預檢再次由 tarball 修復兩個原生模組）
→ active、`server/package.json` 0.6.7、`:9999/api/nodes` 401、首頁 200。

## 234 面板層 smoke（`scripts/smoke-podman-nodes-234.sh`）

- local engine: **docker 29.5.3**（234 同時裝了 podman，但 socket 是 docker 的 — 判斷靠 `/version` Components，正確）。
- 14 台節點全部 **200**（v0.6.6 是 8×200 + 6×500）：

| 節點 | engine | 結果 |
|---|---|---|
| 235 / ConeX-dev1 / ConeX-dev2 / foreman / pmk1 / pmk2 / test1 / test2 | docker | 18 / 15 / 0 / 9 / 2 / 1 / 54 / 43 個容器 |
| vm-dcore-quote-1~3、vm-conex-app-qa1~3（conex） | docker | `permissionDenied: true`、0 容器 — 原本的 500 `NODES_COMMAND_FAILED` 消失 |

主機端零變更（沒有對任何節點 usermod）。

## 未由腳本驗證（請在瀏覽器目視）
- 節點頁：點選節點後清單收合、標題列「顯示清單（14）/ 隱藏清單」切換。
- 遠端容器卡標題 Badge「Docker」；conex 六台顯示黃色「此節點有安裝 Docker，但帳號 conex 無權存取其 socket。」
- 容器管理頁標題旁 Badge「Docker 29.5.3」。
