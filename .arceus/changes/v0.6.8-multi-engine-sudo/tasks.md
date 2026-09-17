# Tasks — v0.6.8

- [x] T-1 RED（36 失敗）：run-command `input`、secrets ×6、ssh（腳本斷言、wrapRemote ×3、isSudoFailed ×5、input 轉送、warn-skip）、
      parser ×6、service（存密碼 ×2、testNode ×3、getContainers ×7）、shared schema ×6。
- [x] T-2 GREEN：`run-command.ts`、新 `common/secrets/secrets.ts`、`ssh.ts`、`remote-parsers.ts`、`nodes.service.ts`（`StoredNode`/`toPublic`）、
      `nodes.controller.ts`、shared `nodes.ts`。刪 `CONTAINER_PS_CMD`/`ENGINE_MARKER`/`isEnginePermissionDenied`/`parseDockerPsJson`。
      規格修正：腳本用字面 `docker ps -a`（AC7 grep）、`-k`。
- [x] T-3 Web：`use-nodes.ts` 型別、對話框 sudo 欄、鑰匙圖示、測試結果 sudo ✓/✗、容器卡多引擎 + 引擎欄 + 黃字／黃卡；i18n 8 keys × 2
      （移除 v0.6.7 `permission_denied`）。docs/nodes.md 重寫容器段 + sudo 密碼段。
- [x] T-4 typecheck / lint / build 綠；test 606。
- [x] T-5 真機（部署前）：root@234 執行 dist 產生的 wrapped 命令 → dev2 sudo 正確：6 組引擎／使用者、7 容器（含 conexd）；
      密碼錯：exit 1 + `incorrect password attempt`；dev2 無 sudo：docker/mike + podman/mike；235 root：5 組、19 容器（含 conexd）。
- [x] T-6 release 0.6.8（`34b5f85`）→ 部署 234 → dev2 帶 sudo 密碼重註冊（`sudoOk:true`）→ smoke 14 台全 200，235 `podman/conexd=1`、dev2 `podman/conexd=1 + podman/infrad=6`（見 smoke-pass.md）。UI 目視留給使用者。
