# Decisions — v0.6.9

- **D1 指標名稱先實測再寫死**。沒有憑記憶猜 Nexus 的指標名：先用使用者提供的帳密抓真實輸出（dev1 3537 行），
  確認 `org_eclipse_jetty_ee10_webapp_WebAppContext_requests_count`、`..._{1..5}xx_responses_total`、
  `bytes_{downloaded,uploaded}_by_format_*` 真的存在且有值，才寫進 `metrics.ts`。
- **D2 自己的 60 秒 setInterval，不用 scheduler 模組**。scheduler 是給使用者自訂 cron 任務用的（`scheduled_tasks` 表），
  內部輪詢塞進去只會讓使用者在排程頁看到一條刪不得的系統任務。照 `system.service.ts` 的既有寫法起計時器。
- **D3 存累積計數器，讀取時才算速率**。Prometheus 計數器本來就是累積值，桶內速率 =（末 − 首）/ 秒數，精確且無需內插；
  也讓「改變時間範圍」不用重新取樣。計數器倒退（Nexus 重啟）整桶丟掉，不畫成負峰。
- **D4 密碼沿用 v0.6.8 的 `common/secrets`**（AES-256-GCM + HKDF(JWT_SECRET)），與節點 sudo 密碼同一套；
  不另開加密方案、不新增環境變數。同樣沒有編輯端點，改密碼＝移除重加。
- **D5 倉庫清單走匿名端點**。`/service/rest/v1/repositories` 預設匿名可讀，即使帳號只有 metrics 權限也看得到倉庫，
  少一個失敗點。
- **D6 保留 7 天、桶寬依範圍**（1h→1 分、24h→10 分、7d→1 小時），一張圖 60–168 點，前端不必自己降採樣。
- **D7 不做告警**。v0.8 是告警模組（閾值 + 通知管道），在這裡各做一套只會之後要合併。
