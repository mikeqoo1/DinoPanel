# Smoke — v0.6.12（2026-09-18）

## 診斷（動工前，真機）

使用者的 CI job 於 09-18 01:09 在 dev2 推 image 失敗。面板存下來的歷史顯示**當下用量只有 90%**：

| 時間 | dev2 `requests_per_last_24h` |
|---|---|
| 09-17 16:50 | 195,563 |
| 09-17 20:10 | 229,225（最高，超過 20 萬）|
| 09-17 21:10 | 180,574（退回上限以下）|
| **09-18 01:09（CI 失敗）** | **180,574（90%）** |
| 09-18 09:12 | 178,896 |

重現 CI 的呼叫並取得完整訊息（CI log 截斷了）：

```
POST /v2/docker_private/conex/middy/blobs/uploads/
403 PAYMENT REQUIRED: At current usage levels, Sonatype Nexus Repository Community
Edition requires a paid license to publish or cache new components.
Contact your repository administrator to resolve. INSTANCE ID: 71bdade8-…
```

| 檢查 | dev1 | dev2 |
|---|---|---|
| `POST …/blobs/uploads/`（寫入） | **202** | **403** |
| `GET /v2/`、`GET …/tags/list`（讀取） | 200 | 200 |
| `nexus_analytics_blocked_requests_count` | 0 | **7** |
| `nexus_analytics_grace_throttled_requests` | 0 | 0（寬限期已過）|
| `peak_requests_per_day_30d` | 43,841 | 353,057 |

→ 只擋寫入、讀取正常；dev2 已進入執行狀態，且**降回上限以下不會自動解除**
（Sonatype UI 文字：「Usage limits came into effect on <date> … new components can no longer be added」）。

## 234 部署（v0.6.11 → v0.6.12）

migration 0008 applied、服務起來、版本 0.6.12、`:9999` 首頁 200。

## 面板實測

| 實例 | enforcement | 預期橫幅 |
|---|---|---|
| ConeX-dev1 | `{blocked:0, throttled:0, graceThrottled:0, blockedInRange:0}` | 不顯示 |
| ConeX-dev2 | `{blocked:7, …, blockedInRange:0}` | 黃色「曾經拒絕寫入」 |

**紅色路徑活驗**：對 dev2 再觸發一次被擋的寫入（403），40 秒後下一輪輪詢
→ `{blocked:8, blockedInRange:1}`，橫幅轉紅「Nexus 正在拒絕寫入」。
（dev2 的累計數因此由 7 變 8，那一次是本次測試造成的。）

## 未由腳本驗證（請在瀏覽器目視）
- dev2 卡片最上方的紅色橫幅與文案；dev1 卡片沒有橫幅。
