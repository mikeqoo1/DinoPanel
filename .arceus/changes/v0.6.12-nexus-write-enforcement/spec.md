# Spec — v0.6.12

## AC1 抓取
- `extractNexusMetrics` 取 `nexus_analytics_{blocked_requests_count,throttled_requests,grace_throttled_requests}`，
  缺少時為 0。

## AC2 `enforcementFromSamples`
- 回 `{ blocked, throttled, graceThrottled, blockedInRange }`，取有計數器的樣本中最後一筆為總量、
  與第一筆的差為範圍內增量；差為負（重啟）夾 0；單筆樣本 `blockedInRange` 為 0；
  全無計數器（舊列或舊版 Nexus）回 null。

## AC3 儲存與 API
- `poll()` 把三個計數器寫進樣本；`GET /nexus/:id/series` 回 `enforcement`。

## AC4 UI
- `blockedInRange > 0` → 紅色橫幅「Nexus 正在拒絕寫入」，寫出範圍內次數與累計次數。
- 累計 > 0 但範圍內 0 → 黃色「曾經拒絕寫入」，說明限制可能仍在。
- 只有 grace 計數非零 → 黃色「處於寬限期」。
- 三者皆 0 或 null → 不顯示橫幅。

## 驗證
- 單元 650（v0.6.11 基線 642），新增 8 條。
- 234 部署後 dev2 應顯示橫幅（真實 blocked=7），dev1 不顯示。
