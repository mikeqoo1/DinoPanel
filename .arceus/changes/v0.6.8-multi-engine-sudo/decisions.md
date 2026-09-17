# Decisions — v0.6.8

- **D1 密碼進 DB 是 v0.6.2「面板不存秘密」的第一次破例，由使用者拍板。** 緩解：AES-256-GCM 加密、每筆隨機 IV、
  金鑰 HKDF 自 JWT_SECRET（零部署變更）、`GET /nodes` 只回 `hasSudo`、密碼只走 ssh stdin（不進 argv／env／log）。
  JWT_SECRET 換掉 → `NODES_SUDO_UNREADABLE` 500，移除重加。v0.7 SecretsService 落地再換專用金鑰（ponytail 註記）。
- **D2 同一支腳本、兩種執行身分。** `wrapRemote(script, sudo)`：沒密碼 `bash -c '…'`，有密碰 `sudo -S -k -p "" bash -c '…'`。
  腳本自己用 `id -u` 決定要不要掃 `/run/user/*`，所以 root 註冊的節點（235）不用密碼也撈得到 rootless。
- **D3 `-k` 每次驗密碼**，不吃 sudo timestamp 快取；否則密碼改了面板還會一陣子「看起來正常」。
- **D4 腳本不含單引號**，`wrapRemote` 對此 throw；引擎命令寫成字面 `docker ps -a` / `podman ps -a`，AC7 的 mutation grep 才有意義。
- **D5 每個引擎跑一次就印一行狀態 `{engine,owner,rc,err}`**，容器行包成 `{engine,owner,c}`。permission denied 變成該引擎的
  狀態，其他引擎照列（v0.6.7 是整個回應一個 `permissionDenied`，兩引擎並存時不夠用）。v0.6.7 的 `engine`/`permissionDenied`
  頂層欄位與 `__DINO_ENGINE__` marker 一併移除（web 同 repo 同版 ship，無外部消費者）。
- **D6 sudo 失敗是 200 狀態**（`sudoFailed`），與「未安裝引擎」同級：操作者打錯密碼、不會自己好、每 30 秒輪詢；共用 warn-skip。
- **D7 rootless 掃描以 `/run/user/*` 為母集**：有 runtime dir 的使用者才可能有活的 rootless podman（linger 或登入中）。
  沒 linger 又沒登入的使用者的已停容器看不到 — 可接受，那些容器也沒在跑。
