# Smoke — v0.6.9（2026-09-17）

## 端點探測（動工前）

| 端點 | 匿名 | 帶帳密 |
|---|---|---|
| `/service/rest/v1/status` | 200 | — |
| `/service/rest/v1/repositories` | 200（含每個倉庫 `size`） | — |
| `/service/metrics/prometheus` | 301 → `/service/rest/metrics/prometheus` | — |
| `/service/rest/metrics/prometheus` | 403 | 200，3537 行 / 393 kB |

實測存在且有值的指標：`org_eclipse_jetty_ee10_webapp_WebAppContext_requests_count`（dev1 15802、dev2 165878）、
同前綴的 `1xx`–`5xx` `_responses_total`、`bytes_downloaded_by_format_npm`（dev1 3.26 GB、dev2 20.9 GB）。
兩台都是 Nexus 3.96.0-09 COMMUNITY，只有 npm 格式有流量、上傳為 0。234 連得到兩台（200）。

## 本機 E2E（dist server :3999 對真實 dev1/dev2）

- `POST /nexus` ×2 → 201；`GET /nexus` 回 `hasPassword: true`，無明文、無 `passwordEnc`。
- `POST /nexus/:id/test` → `{"requests":15959,...,"byFormat":{"npm":{"down":3264059120,"up":0}}}`。
- `GET /nexus/:id/repositories` → 8 筆（匿名端點，帳號只需 metrics 權限也拿得到）。
- 等兩輪取樣後 `GET /nexus/:id/series?range=1h` → 2 個點、`requests` 0.033/s（正是面板自己每 60 秒取樣打的那兩次）。
- 收尾刪除本機兩筆實例，dev DB 不留憑證。

## 234 部署（v0.6.8 → v0.6.9）

`~/upgrade-0.6.9.sh`：stop → `dinopanel.db{,-wal,-shm}.pre-0.6.9` → 解 `dinopanel-0.6.9-7ef42da-prebuild-x64.tar.gz`
→ install.sh upgrade（原生模組由 tarball 修復、**migration 0006 applied**）→ active、0.6.9、`:9999/api/nodes` 401、首頁 200。

## 234 面板實測

| 實例 | 累計請求 | 累計下載 | 格式 | 倉庫 | 最大倉庫 |
|---|---|---|---|---|---|
| ConeX-dev1 | 17607 | 3.60 GB | npm | 8 | `npm_proxy_npmjs` 21.5 GB |
| ConeX-dev2 | 175841 | 23.0 GB | npm | 8 | `docker_private` 37.9 GB |

- 兩台都在 110 秒後出現第一個樣本、170 秒後出現第一個速率點（每 60 秒取樣，兩筆才算得出速率），`latestTs` 落後 13 秒。
- dev1 的累計下載在三分鐘內由 3.28 GB 增至 3.60 GB — 真實 npm 流量，不是靜態數字。
- `?range=bogus` 退回 `1h`；`?range=7d` 正常回應（桶寬 1 小時，目前只有 1 點）。

## 未由腳本驗證（請在瀏覽器目視）
- 側欄「Nexus」分頁、每張卡的狀態徽章（取樣中）、目前與累計數字。
- 兩張圖（請求速率、傳輸速率）與 1 小時／24 小時／7 天切換。
- 依格式徽章顯示 `npm ↓3.6 GB`、倉庫表格 8 列、測試與移除按鈕。
