# v0.6.9 — Nexus 流量監控

## 為什麼 (Why)

使用者要看兩台 Nexus Repository（ConeX-dev1/dev2 的 `:18081`）的流量。這兩台是 npm proxy，
dev1 已累積下載 3.26 GB、dev2 20.9 GB，但面板上完全看不到，只能自己開 Nexus UI 翻。

探測後確認 Nexus 3.96 社群版提供 `/service/rest/metrics/prometheus`（需 `nexus:metrics:read`），
裡面有 Jetty 的請求數與各 HTTP 狀態碼，以及 Nexus 自己的 `bytes_downloaded_by_format_*`／
`bytes_uploaded_by_format_*`。`/service/rest/v1/repositories` 匿名可讀，附每個倉庫的容量。

## 目標

1. 面板新分頁列出 Nexus 實例，顯示目前請求速率、傳輸速率與累計量。
2. 請求速率與傳輸速率的時間序列圖，可切 1 小時／24 小時／7 天。
3. 倉庫清單（名稱、格式、類型、容量）。
4. 帳密加密儲存、API 不回傳。純唯讀，不對 Nexus 做任何寫入。

## 範圍 (Scope)

- **In**：shared `schemas/nexus.ts`；server `modules/nexus/`（純函式 `metrics.ts`、service、controller、module）；
  `nexus_samples` 表 + migration 0006；web `use-nexus.ts` + `routes/nexus/nexus-page.tsx` + 側欄 + 路由；
  i18n 兩語系；`docs/nexus.md`。
- **Out**：告警（v0.8 專門模組會做，不在這裡重複）；編輯實例的端點（移除再新增）；
  Nexus 使用者／倉庫管理；per-repository 流量（Nexus 只給 per-format，沒有 per-repo 的位元組計數器）。
