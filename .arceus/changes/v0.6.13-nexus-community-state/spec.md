# Spec — v0.6.13

## AC1 `parseCommunityState`
- 從 `{data:{data:{...}}}` 取 `nexus.community.{usageLimits,throttlingStatus,gracePeriodEnds,
  requestPer24HoursLimitDateLastExceeded,componentCountLimitDateLastExceeded}` 與 `status.edition`。
- 每個項目可能是 `{hash,value}` 或裸值，兩種都要吃。
- `throttling` = status 存在且非 `under limits`（不分大小寫）。空字串日期回 null。
- 無法辨識的 payload 回 null；缺 `usageLimits`（Pro）時兩個上限為 null 但其餘照常。

## AC2 服務
- `poll()` 對每個實例刷新狀態並快取；端點 404／壞 body → 該實例無狀態，且**樣本照存**。
- `remove()` 清掉快取。`GET /nexus/:id/series` 回 `community`。

## AC3 UI
- 進度條用 `community.requestsPerDayLimit ?? instance.requestsPerDayLimit`（元件同理）。
- 有回報上限時顯示「上限由 Nexus 回報」，不顯示「設定上限」按鈕。
- `community.throttling` 為 true → 紅色橫幅（含生效日期、最近超限時間、累計被擋次數）；
  為 false → 不顯示橫幅；`community` 為 null → 沿用 v0.6.12 的計數器判斷。
- 用量區塊補一列「寬限期結束」。

## 驗證
- 單元 659（v0.6.12 基線 650），新增 9 條。
- 234 部署後：dev2 紅色且上限顯示 100,000／40,000、24 小時請求數約 195%；dev1 無橫幅。
