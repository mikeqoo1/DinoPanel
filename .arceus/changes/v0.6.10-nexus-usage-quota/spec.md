# Spec — v0.6.10

## AC1 `parseUsageMetrics`
- 取 `usage[0]` 的 `requests_per_last_24h`、`component_total_count`、`unique_users_last_30d`，
  以及 `request_rates` 底下的 `peak_requests_per_day_30d`、`peak_requests_per_minute_1d`。
- body 非物件／`usage` 不是陣列或空陣列 → null；巢狀 `request_rates` 缺少 → 該欄讀成 0。

## AC2 儲存
- `poll()` 在 prometheus 成功後抓用量，五個欄位寫進同一筆樣本；用量失敗（403／連不上／body 壞）→
  五欄皆 null 但**樣本照存**。

## AC3 上限
- `add` 未給上限 → 預設 200000 / 100000；有給則照給的值。
- `PATCH /nexus/:id/limits` 只改上限、保留 `passwordEnc`；未知 id → 404；非正整數 → 400。

## AC4 序列
- `NexusPoint.requests24h` 為桶內最後一筆 gauge 值，無資料時 null。
- `NexusSeries.usage` 為最新一筆樣本的用量，該筆沒有用量時 null。

## AC5 UI
用量區塊：兩條進度條（24 小時請求數、元件數）對各自上限，<75% 綠、≥75% 黃、≥100% 紅並掛「已超過上限」標籤；
三個數字（30 天不重複使用者、30 天單日尖峰、24 小時單分鐘尖峰）；「設定上限」對話框；
24 小時請求數走勢圖（有資料才顯示）；讀不到用量時顯示說明而非錯誤。

## 驗證
- 單元 639（v0.6.9 基線 627），nexus 模組 33 條。
- 本機 E2E 對真實 dev2：用量 195,563 進得去、PATCH 正常/400/404、series 帶 usage 與 gauge。見 smoke-pass.md。
