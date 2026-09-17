# Smoke — v0.6.10 + v0.6.11（2026-09-17）

## 上限來源調查（結論：Nexus 不提供）

| 來源 | 結果 |
|---|---|
| `/service/rest/internal/ui/usage-metrics` | 200，只有用量數字，**沒有上限** |
| `/service/rest/internal/ui/status-check` | 200，18 條健康檢查，無配額字樣 |
| `/service/rest/v1/monthly-metrics` | 200，6 個月歷史（requestCount／componentCount／peakStorage／responseSize），無上限 |
| `/service/rest/v1/system/license` | 402 Payment Required（本身即社群版的訊號） |
| `/service/rest/internal/ui/{license,product-info,user-limits,usage,usage-metrics/limits}` | 全 404 |
| UI bundle `nexus-coreui-bundle.js`（2.2 MB） | 只有 `SOFT_THRESHOLD`／`HARD_THRESHOLD` 字串與 `PERCENTAGE: .75`，**無數值** |

→ 上限做成每台可設定，預設 200,000 / 100,000。

## 計數器行為（實測）

`requests_per_last_24h` 在 dev2 上連續 40 秒三次讀取皆為 195,563，且與 17 分鐘前相同 →
**Nexus 自己排程重算，不是即時跳動**。面板每 60 秒取樣，所以配額圖是階梯狀，這是資料本身粗，不是面板卡住。

## 本機 E2E（dist server :3999 對真實 dev2）

- 新增實例回 `requestsPerDayLimit: 200000, componentsLimit: 100000`。
- 一輪輪詢後 series 帶 `usage: {"requests24h":195563,"componentCount":16458,"uniqueUsers30d":3,"peakRequestsPerDay30d":353057,"peakRequestsPerMinute1d":7440}`。
- `PATCH :id/limits` **第一次回 400 `VALIDATION_FAILED expected object, received string`** —
  方法層 `@UsePipes` 會套到 `@Param('id')`。改成參數層後：合法 200 並回新上限、`0` 回 400、未知 id 回 404。
- 收尾刪除本機實例。

## 234 部署

- v0.6.10（`b7131b3`）：migration 0007 applied、服務起來，但 **`GET /nexus` 回空陣列** —
  v0.6.9 註冊的兩台實例因新的必填上限欄位在儲存層 parse 失敗被丟棄（磁碟 blob 完好，`readList` 只讀不寫）。
- v0.6.11（`2ae0a75`）：修為儲存層選填 + 讀取時套預設，兩台實例回來。

## 234 實測（v0.6.11）

| 實例 | 24h 請求 | 上限 | 使用率 | 元件 | 使用者 | 30 天單日尖峰 |
|---|---|---|---|---|---|---|
| ConeX-dev1 | 16,905 | 200,000 | 8.5% | 19,332 | 1 | 43,841 |
| ConeX-dev2 | **195,563** | 200,000 | **97.8%** | 16,458 | 3 | 353,057 |

dev2 的 97.8% 與使用者回報的 `403 PAYMENT REQUIRED` docker push 失敗一致。

## 未由腳本驗證（請在瀏覽器目視）
- 用量區塊兩條進度條（dev2 的請求條應為紅色並掛「已超過上限」或接近滿），「設定上限」對話框。
- 24 小時請求數走勢圖（階梯狀）。
