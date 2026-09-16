# Spec — v0.6.6 Podman 支援

## AC1 遠端節點 fallback
- `CONTAINER_PS_CMD` 以 `export LC_ALL=C;` 開頭；先 `docker ps -a --format '{{json .}}'`，
  無 docker 則 `podman ps -a --format '{{json .}}'`，皆無 `exit 127`。
- `isDockerAbsent()` 對 exit 127 或 stderr 含 `(docker|podman): (command )?not found` 回 true。
- 命令字串不含 `(docker|podman) (start|stop|restart|rm|exec|run|kill|pull)`。

## AC2 Podman ps 形狀可解析
- `{ Id, Names: [name], Image, State, Status }` 一行 → `RemoteContainer` 的 id/name/state 正確。

## AC3 本機 socket 解析
- `DOCKER_SOCKET_PATH` 有設 → 原樣回傳（不檢查存在）。
- 未設 → `/var/run/docker.sock`、`/run/podman/podman.sock`、`$XDG_RUNTIME_DIR/podman/podman.sock`
  依序取第一個存在者；皆無 → `/var/run/docker.sock`。

## AC4 compose 引擎偵測
- `docker compose version` 成功 → `spawn('docker', ['compose', …])`。
- docker 失敗、`podman compose version` 成功 → `spawn('podman', ['compose', …])`。
- 皆失敗 → `listStacks()` 等丟 `COMPOSE_UNAVAILABLE`。

## AC5 文字
- `nodes.containers.no_docker` 兩語系改為「未安裝 Docker 或 Podman」；`DOCKER_UNREACHABLE` 訊息
  改「Container engine (Docker/Podman) is not reachable」；code 不變。

## 驗證
- 單元測試覆蓋 AC1–AC4（`ssh.test.ts`、`remote-parsers.test.ts`、`docker-socket.test.ts`、
  `compose.service.test.ts` CS-10~12）。
- 本機 smoke：見 `smoke-pass.md`。
