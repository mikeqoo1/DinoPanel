# Decisions — v0.6.7

- **D1 權限不足是 200 狀態，不是錯誤**。與「未安裝引擎」同類：節點設定問題、不會自己好、每 30 秒輪詢一次。
  走 error 會讓 ErrorPill 一直紅、且每次輪詢 warn 一行。判斷式 `isEnginePermissionDenied`（非 0、非 127、
  stderr 含 `permission denied`）放 `ssh.ts` 與 `isDockerAbsent` 並列，`sshExec` warn-skip 共用。
- **D2 引擎靠命令自己回報**（第一行 `__DINO_ENGINE__=docker|podman`），不是第二次 SSH 也不是猜。
  marker 在 ps 之前 echo，所以 ps 因權限失敗時仍知道是哪個引擎。沒 marker（舊命令）→ `engine: null`。
- **D3 本機引擎用 `/version` 的 Components 判斷**（Podman 回 `Podman Engine`，Docker 回 `Engine`），
  不用 socket 路徑猜（`DOCKER_SOCKET_PATH` 可指任何地方、`podman-docker` shim 會讓 docker.sock 其實是 podman）。
  成功後快取；失敗不快取（daemon 稍後起來要能重試）。
- **D4 `engine` 路由宣告在 `:id` 之前**，否則 `GET /containers/engine` 會被當容器 id。
- **D5 收合是純前端 state**：選節點 → 收合；再點同一台（取消選取）或刪掉選中節點 → 展開；
  標題列按鈕手動切換。不存 localStorage。
- **D6 `dockerAvailable` 保留**，新增 `engine` + `permissionDenied` 兩欄；schema 三欄皆必填（UI 不用處理 undefined）。
