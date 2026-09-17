# v0.6.10 — Nexus 社群版用量配額

## 為什麼 (Why)

v0.6.9 上線隔天，使用者的 CI 在 ConeX-dev2 上 `docker push` 失敗：
`403 PAYMENT REQUIRED: At current usage levels, Sonatyp...`。同一台之前 npm 也踩過 402。
這不是程式問題，是 Nexus 社群版的用量配額，但面板上看不到離上限還有多遠，
只能自己開 Nexus UI 翻，也無法判斷什麼時候可以重跑 CI。

實測：dev2 的 `requests_per_last_24h` 是 **195,563**，dev1 只有 16,905。這就是 Nexus 拿來判斷的數字。

## 目標

1. 面板顯示 Nexus 社群版拿來判斷的用量計數，配進度條與 75% / 100% 顏色。
2. 用量隨時間的走勢圖，讓人看得出什麼時候退到配額以下、CI 可以重跑。
3. 上限可在 UI 修改（Nexus 不提供上限值）。

## 範圍 (Scope)

- **In**：`parseUsageMetrics`；輪詢時一併抓 `/service/rest/internal/ui/usage-metrics`；
  `nexus_samples` 加 5 個可為 null 的欄位（migration 0007）；`PATCH /nexus/:id/limits`；
  實例設定加 `requestsPerDayLimit` / `componentsLimit`；卡片新增用量區塊、上限對話框、24 小時請求數走勢圖；
  i18n 兩語系；docs。
- **Out**：告警／通知（v0.8）；`monthly-metrics` 歷史（有找到端點，沒人要就不做）；
  自動判斷上限（Nexus 根本不給）。
