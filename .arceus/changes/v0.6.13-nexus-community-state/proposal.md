# v0.6.13 — 讀 Nexus 自己的上限與判定

## 為什麼 (Why)

使用者回報 dev2 的橫幅不是紅色。兩個原因，第二個比第一個嚴重得多：

1. v0.6.12 的橫幅跟著圖表的時間範圍走。使用者選「1 小時」，而最後一次被擋的寫入在一小時前，
   於是顯示黃色的「曾經拒絕寫入」。橫幅講的是這台機器的狀態，不該被圖表縮放影響。
2. 追查時在 `/service/extdirect/poll/rapture_State_get`（Nexus 自己 UI 用的 state blob）
   找到**權威資料**：`nexus.community.usageLimits` = `{"Total Components": 40000,
   "Max Requests per 24 Hours": 100000}`、`nexus.community.throttlingStatus` = `"Over limits"`、
   `gracePeriodEnds` = `2026-09-10`。
   **v0.6.10 猜的預設值（20 萬／10 萬）兩個都錯**，面板把 194,967 顯示成 97.5%，實際上是真正上限 10 萬的 **195%**。

## 目標

上限與「現在是否拒絕寫入」一律以 Nexus 回報為準，不再由面板推論。

## 範圍 (Scope)

- **In**：`parseCommunityState`；輪詢時抓 state blob 並快取；`NexusSeries.community`；
  進度條改用回報的上限；橫幅改由 `throttlingStatus` 驅動；顯示寬限期結束與最近超限時間；
  手動上限退為 fallback（僅在 Nexus 不回報時才出現「設定上限」按鈕）；i18n；docs。
- **Out**：不存進資料庫（這是當下狀態，開機後首輪輪詢即補齊）；不動 v0.6.12 的計數器（作為輔助佐證保留）。
