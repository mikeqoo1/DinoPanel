# v0.6.6 — Podman 支援

## 為什麼 (Why)

2026-09-16 盤點：containers 與 nodes 兩個模組寫死 Docker——本機 dockerode 只找
`/var/run/docker.sock`、compose 只叫 `docker compose`、遠端節點只跑 `docker ps`。
Rocky / Alma 這類 RHEL 系預設裝的是 Podman 不是 Docker，純 Podman 的主機在面板上
只會顯示「未安裝 Docker」，本機裝在 Podman 主機上則整個 containers 模組 503。

Podman 提供 Docker 相容 REST API（`podman.socket`）與 `podman compose` 包裝，
`podman ps --format '{{json .}}'` 的欄位（`Id`/`Names`/`Image`/`State`/`Status`）
與 docker 相同——不需要新 driver，只要把「找 docker」的三個點各退一步到 podman。

## 目標

1. 遠端節點：沒 `docker` 就用 `podman ps`，兩者都沒有才顯示未安裝。仍為唯讀模組常數。
2. 本機：`DOCKER_SOCKET_PATH` 未設時自動找 docker → rootful podman → rootless podman socket；
   compose 先 `docker compose` 再 `podman compose`。
3. 文件與 UI 文字不再只寫 Docker。

## 範圍 (Scope)

- **In scope**：`nodes/ssh.ts`（`CONTAINER_PS_CMD`、`isDockerAbsent` regex）、
  `containers/docker-socket.ts`（新，`resolveSocketPath()`）、`containers.module.ts`、
  `compose.service.ts`（`composeBin` 偵測）、`docker-error.ts` 訊息、i18n `nodes.containers.no_docker`、
  `docs/nodes.md`、`docs/containers.md`、README 兩語系。
- **Out of scope**（有人踩到再加）：API 回應加 `engine` 欄位；Podman 專屬 state 對應
  （未知值本來就落 `dead`）；compose 執行檔 env override；`dockerAvailable` 欄位改名（相容）。

## Stakeholders

- 維運：想把純 Podman 主機納進 /nodes、或把面板裝在 Podman 主機上的人。
