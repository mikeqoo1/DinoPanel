# Decisions — v0.6.6 Podman 支援

- **D1 遠端 fallback 放在 shell 命令字串裡**（`if command -v docker … elif command -v podman … else exit 127`），
  不是兩次 SSH round-trip。維持一個模組常數、零使用者輸入、AC7 的 mutation-verb grep 仍成立
  （regex 擴成 `(docker|podman) (start|stop|…)`）。
- **D2 `dockerAvailable` 欄位名不改**。語意改為「有容器引擎」；改名要動 shared schema + web，
  換來的只是名字好看。不加 `engine` 欄位——目前沒有任何 UI 需要知道是哪個引擎。
- **D3 socket 偏好順序 docker → rootful podman → rootless podman**。兩者都在時 docker 優先，
  與 v0.2 起的行為一致；`DOCKER_SOCKET_PATH` 有設永遠贏，且不檢查存在（讓既有 503 路徑處理）。
- **D4 compose 執行檔用啟動偵測，不加 env**。`docker compose version` 先、`podman compose version` 後，
  誰先回 0 就用誰；兩者皆無維持 `COMPOSE_UNAVAILABLE` 503。有 `podman-docker` shim 的主機
  `docker compose` 本身就會轉給 podman，偵測自然覆蓋。
- **D5 parser 不動**。Podman 的 `Names` 是陣列，`String(['x'])` 剛好得 `x`；`Status` 在 podman
  常為空字串，UI 顯示空白可接受。Podman 專屬 state（`stopping`/`stopped`）走既有 `dead` fallback。
