# Smoke — v0.6.8（2026-09-17）

## 部署前真機（root@234 執行 dist 產出的 `wrapRemote(CONTAINERS_CMD, …)`）

| 目標 | 身分 | 結果 |
|---|---|---|
| ConeX-dev2 | mike + `sudo -S -k`，密碼經 stdin | exit 0；狀態行 6 組：docker/root、podman/root、podman/{jimmy,mike,infrad,conexd}；7 個容器行 |
| ConeX-dev2 | mike，密碼錯 | exit 1，無輸出，stderr `Sorry, try again. sudo: no password was provided sudo: 1 incorrect password attempt` → `isSudoFailed` 命中 |
| ConeX-dev2 | mike，不提權 | docker/mike + podman/mike，0 容器 |
| 235 | root，不提權 | 5 組：docker/root、podman/root、podman/{mike,alanfarng,conexd}；19 個容器行；conexd 行形狀 `{"engine":"podman","owner":"conexd","c":{…}}` |

## 234 部署（v0.6.7 → v0.6.8）

`~/upgrade-0.6.8.sh`：stop → `dinopanel.db{,-wal,-shm}.pre-0.6.8` → 解 `dinopanel-0.6.8-34b5f85-prebuild-x64.tar.gz` →
install.sh upgrade（原生模組再次由 tarball 修復）→ active、0.6.8、`:9999/api/nodes` 401、首頁 200。
（第一次用 `sudo bash -c "rm …; bash upgrade"` 包兩層沒有輸出也沒執行，改回直接 `sudo -S bash ~/upgrade-0.6.8.sh` 才跑。）

## dev2 重新註冊（API）

`DELETE /nodes/<old>` 204 → `POST /nodes {…,"user":"mike","sudoPassword":"…"}` → 回 `hasSudo: true`、無密碼欄位 →
`POST /nodes/<new>/test` → `{"ok":true,"latencyMs":375,"sudoOk":true}`。

## 面板層 smoke（`scripts/smoke-podman-nodes-234.sh`，14 台全 200）

| 節點 | 引擎 | 容器（engine/owner） |
|---|---|---|
| 235（root） | docker+podman | 19：docker/root=18、**podman/conexd=1** |
| ConeX-dev2（mike + sudo） | docker+podman | 7：**podman/conexd=1、podman/infrad=6** |
| ConeX-dev1（mike） | docker+podman | 16：docker/mike=15、podman/mike=1 |
| foreman / pmk1 / pmk2 | docker+podman | 9 / 2 / 1（全 docker） |
| test1 / test2（110084-mike） | docker | 54 / 43 |
| quote-1~3（conex） | podman（docker/conex DENIED） | 0 |
| app-qa1~3（conex） | —（docker/conex DENIED，無 podman） | 0 |

local engine：docker 29.5.3。smoke 腳本第一版 jq 在「無成功引擎」時對字串取欄位崩掉（app-qa1），已修。

## 未由腳本驗證（請在瀏覽器目視）
- 新增節點對話框的「sudo 密碼（選填）」欄（user 為 root 時停用）；dev2 名稱旁鑰匙圖示；測試連線顯示 `375ms · sudo ✓`。
- 235 與 dev2 容器卡：標題後 Docker、Podman 兩顆 Badge；每行「引擎」欄 `Podman conexd`。
- quote-1 容器卡標題下黃字「Docker：帳號 conex 無權存取其 socket」，表格顯示無容器。
