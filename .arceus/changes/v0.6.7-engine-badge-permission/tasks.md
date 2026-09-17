# Tasks — v0.6.7

- [x] T-1 RED：ssh.test（marker、`isEnginePermissionDenied` ×5、warn-skip）、nodes.service.test ×5、
      containers.service.test `getEngine` ×4 → 16 個預期失敗。
- [x] T-2 GREEN：shared schema（`engine`/`permissionDenied`/`localEngineSchema`）、`ssh.ts`、`nodes.service.ts`
      `splitEngineMarker`、`containers.service.ts` `getEngine`、controller `GET engine`（在 `:id` 前）。
- [x] T-3 Web：`useEngine`、containers 頁 Badge、nodes 頁 Badge + 黃卡 + 收合；i18n 4 keys × 2。
      （踩到：用 json.dumps 重寫 i18n 會折掉原檔重複 key `files.compress`，改定點插入；`delete_confirm`
      anchor 不唯一，插到別的 section，改用 `latency`。）
- [x] T-4 shared nodes.test 補新欄位 + permissionDenied / 未知 engine 兩個 case；docs nodes.md / containers.md。
- [x] T-5 typecheck / lint / build 綠；test 592（v0.6.6 基線 574）。
- [x] T-6 本機 E2E `/containers/engine`（podman.sock → podman、docker.sock → docker）。
- [x] T-7 release 0.6.7（`e6a9220`）→ 部署 234 → smoke：local engine docker 29.5.3、14 台全 200、conex 六台 `permissionDenied:true`（見 smoke-pass.md）。UI 目視留給使用者。
