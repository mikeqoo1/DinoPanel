# Spec — v0.6.7

## AC1 遠端 marker
- `CONTAINER_PS_CMD` 在 `docker ps` 前 `echo __DINO_ENGINE__=docker;`，在 `podman ps` 前 `echo __DINO_ENGINE__=podman;`。
- service 讀第一行 marker → `engine`，剩餘行進 parser；無 marker → `engine: null`、不當成容器。

## AC2 權限不足
- `isEnginePermissionDenied`: exitCode 非 0 且非 127、stderr `/permission denied/i` → true；exit 0 或 127 → false。
- `getContainers` → `{ dockerAvailable: true, engine, permissionDenied: true, containers: [] }`，不丟 HttpException、不 warn。
- 引擎缺席 → `{ dockerAvailable: false, engine: null, permissionDenied: false, containers: [] }`。

## AC3 本機引擎
- `GET /api/containers/engine` → `{ engine, version }`；Components 任一 Name 含 podman → `podman`，否則 `docker`。
- 第二次呼叫不再打 `version()`；失敗丟 `DOCKER_UNREACHABLE` 503 且不快取。

## AC4 UI
- 遠端容器卡標題後 Badge（Docker / Podman）；`permissionDenied` → 黃色卡「此節點有安裝 {{engine}}，但帳號 {{user}} 無權存取其 socket。」
- 容器管理頁 h1 旁 Badge「{Engine} {version}」。
- 節點頁：選節點後清單隱藏、標題列出現「顯示清單（N）」；再點變「隱藏清單」。

## 驗證
- 單元：ssh.test（marker 順序、predicate ×5、warn-skip）、nodes.service.test ×5、containers.service.test ×4、shared nodes.test ×2 新增；i18n parity。
- 本機 E2E：server 指 podman.sock → `/containers/engine` 回 podman；指 docker.sock → docker。
- 234：部署後 `/containers/engine` 回 docker；節點 smoke 6 台 conex 從 500 變 200 `permissionDenied:true`、其餘 8 台 `engine:docker`；UI 目視。
