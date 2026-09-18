# Smoke — v0.6.13（2026-09-18）

## 找到權威來源

`GET /service/extdirect/poll/rapture_State_get`（帶帳密）回傳 Nexus 自己 UI 用的 state blob，其中：

```
nexus.community.usageLimits      {"Total Components": 40000, "Max Requests per 24 Hours": 100000}
nexus.community.throttlingStatus "Over limits" (dev2) / "Under limits" (dev1)
nexus.community.gracePeriodEnds  2026-09-10T07:01:00 (dev2) / 2026-06-25T07:01:00 (dev1)
nexus.community.requestPer24HoursLimitDateLastExceeded  2026-09-18T03:01:00Z (dev2)
nexus.community.componentCountLimitDateLastExceeded     ""（兩台皆未超過元件上限）
status.edition                   COMMUNITY
contentUsageEvaluationResult     peak_requests_per_day utilization = HARD_THRESHOLD (dev2) / FREE_TIER (dev1)
```

**v0.6.10 猜的預設值兩個都錯**：真正上限是 100,000 請求／40,000 元件，不是 200,000／100,000。

## 234 部署（v0.6.12 → v0.6.13）與實測

| | ConeX-dev1 | ConeX-dev2 |
|---|---|---|
| throttling | false（Under limits）| **true（Over limits）** |
| 上限（Nexus 回報）| 100,000 req / 40,000 comp | 100,000 req / 40,000 comp |
| 24 小時請求 | 13,527（13.5%）| **194,967（195%）** |
| 元件 | 19,336（48.3%）| 16,459（41.1%）|
| 寬限期結束 | 2026-06-25 | **2026-09-10** |
| 最近超限 | 2026-07-25 | **2026-09-18 03:01Z** |
| 預期橫幅 | 無 | **紅色，且與圖表時間範圍無關** |

修正前後對照：同一個 194,967，舊版顯示 97.5%（對 200,000），新版顯示 195%（對真正的 100,000）。

## 未由腳本驗證（請在瀏覽器目視）
- dev2 卡片頂端紅色橫幅，內容含「限制自 2026-09-10 起生效」與「最近一次超限 2026-09-18 03:01」。
- 切到 1 小時／24 小時／7 天，橫幅都該維持紅色（不再跟著範圍變）。
- 用量列顯示「上限由 Nexus 回報」而非「設定上限」按鈕；24 小時請求數的進度條爆滿且為紅色。
- dev1 沒有橫幅。
