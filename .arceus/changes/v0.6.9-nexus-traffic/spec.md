# Spec — v0.6.9

## AC1 純函式（`metrics.ts`）
- `parsePrometheusText`：只取 `name value` 行；跳過註解、含 `{` 的 labelled series、格式錯誤行與非有限值；支援科學記號。
- `extractNexusMetrics`：取 requests／2xx–5xx；`bytes_*_by_format_*` 只留有流量的格式，並加總成 `bytesDown`／`bytesUp`；缺的計數器讀成 0。
- `bucketMsForRange`：1h→60_000、24h→600_000、7d→3_600_000。
- `toSeries`：每桶一點，速率 =（末 − 首）/ 秒數；計數器倒退整桶丟棄；樣本 < 2 或間隔為 0 不產生點。

## AC2 實例儲存
- `add` 密碼加密寫進 KV `nexus.list`；`list` 只回 `hasPassword`，序列化結果不含明文也不含 `passwordEnc`。
- 同 URL 重複 → 409 `NEXUS_DUPLICATE`；`remove` 一併刪除該實例的 `nexus_samples` 列；KV 壞掉回空陣列不丟例外。

## AC3 抓取
- `scrape` 對 `<url>/service/rest/metrics/prometheus` 送 `Authorization: Basic base64(user:pass)`。
- 401/403 → `NEXUS_AUTH_FAILED`；網路失敗／逾時（10s）→ `NEXUS_UNREACHABLE`；其他非 2xx → `NEXUS_COMMAND_FAILED`。
- `poll()` 每個實例存一筆樣本；實例掛掉不 reject、記一行 `nexus.scrape_failed`（不含帳密）；之後刪除超過 7 天的樣本。

## AC4 API
`GET /nexus`、`POST /nexus`、`DELETE /nexus/:id`（204）、`POST /nexus/:id/test`、
`GET /nexus/:id/series?range=`（非法 range 退回 `1h`）、`GET /nexus/:id/repositories`。

## AC5 UI
側欄「Nexus」分頁；每個實例一張卡：狀態徽章（取樣中／取樣落後 >3 分／尚未取樣）、目前請求與下載速率、
累計請求與下載量、兩張圖（請求+錯誤、下載+上傳）、範圍切換、依格式徽章、倉庫表格、測試與移除按鈕；新增對話框。

## 驗證
- 單元 627（v0.6.8 基線 606），其中 nexus 21 條。
- 本機 E2E 對真實 dev1/dev2：註冊、live scrape、倉庫清單、等兩輪取樣後 series 有點。見 smoke-pass.md。
