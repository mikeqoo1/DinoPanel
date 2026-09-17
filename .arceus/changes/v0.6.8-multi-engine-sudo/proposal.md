# v0.6.8 — 多引擎盤點 + rootless Podman（sudo 密碼）

## 為什麼 (Why)

使用者在 235 與 ConeX-dev2 用 Quadlet 跑 rootless Podman（`User=conexd`），面板一個都沒列出來。兩個原因：
(1) v0.6.6 的命令「有 docker 就不跑 podman」，兩引擎並存的主機 podman 那條路根本沒執行；
(2) rootless Podman 容器只有擁有者看得到，面板用 root（235）或 mike（dev2）跑 `podman ps` 都是 0。
235 實測：root 的 `podman ps -a` 0 個，`sudo -u conexd env XDG_RUNTIME_DIR=/run/user/969 podman ps` 才有。

使用者決定：dev2 不改用 root 註冊，改成把 mike 的 sudo 密碱交給面板提權查看。

## 目標

1. 兩個引擎都有就都列，每行標引擎與擁有者。
2. 以 root 執行時（原生 root 或 sudo 提權）掃 `/run/user/*` 逐使用者 `podman ps`，把 rootless 容器撈進來。
3. 節點可選填 sudo 密碼：加密存放、API 不回傳、只經 stdin 送給 `sudo -S`；`test` 連線時順帶驗密碼。
4. UI：新增節點對話框多一欄 sudo 密碼；清單有鑰匙圖示；容器表多「引擎／擁有者」欄；密碼錯與 socket 無權限各有提示。

## 範圍 (Scope)

- **In**：`common/shell/run-command.ts`（`input` stdin）、新 `common/secrets/secrets.ts`（AES-256-GCM，HKDF(JWT_SECRET)）、
  `nodes/ssh.ts`（`CONTAINERS_CMD` 取代 `CONTAINER_PS_CMD`、`wrapRemote`、`isSudoFailed`）、`remote-parsers.ts`
  （`parseContainersOutput` 取代 `parseDockerPsJson`）、`nodes.service.ts`（stored vs public、加解密、sudo 探測）、
  shared schema（`sudoPassword`、`hasSudo`、`engines[]`、容器 `engine`/`owner`、`sudoFailed`）、web 三處、i18n 8 keys × 2、docs。
- **Out**：編輯既有節點密碼的端點（移除再新增）；sudoers NOPASSWD 方案（使用者選密碼）；對節點做任何權限變更；
  專用加密金鑰（等 v0.7 SecretsService）。
