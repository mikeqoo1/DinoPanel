# v0.6.12 — Nexus 寫入封鎖狀態

## 為什麼 (Why)

v0.6.10 上線隔天，使用者的 CI 又在 dev2 推 image 失敗（同樣的 403 PAYMENT REQUIRED），
但面板顯示 24 小時請求數只有 180,574 / 200,000（90%）、元件數 16,459 / 100,000。
**照百分比看應該要能推，實際上推不上去。**

查證結果：Sonatype 的政策不是「此刻超量才擋」，而是超過後給寬限期、寬限期結束就進入執行狀態
（它自己的 UI 文字：「Usage limits came into effect on 某日，新元件無法再加入」）。
降回上限以下不會立刻恢復。所以只看用量百分比會給出錯誤結論。

Nexus 自己有計數器誠實回答這件事：`nexus_analytics_blocked_requests_count`（dev2 = 7、dev1 = 0）、
`nexus_analytics_grace_throttled_requests`（dev2 = 0 → 寬限期已過）。實測 dev2 的
`POST /v2/<repo>/blobs/uploads/` 回 403、dev1 同樣呼叫回 202。

## 目標

面板直接說「現在推不推得上去」，而不是讓人從百分比推論。

## 範圍 (Scope)

- **In**：`extractNexusMetrics` 多抓三個 `nexus_analytics_*` 計數器；`nexus_samples` 加三個可為 null 的欄位
  （migration 0008）；`enforcementFromSamples` 純函式；`NexusSeries.enforcement`；卡片頂部狀態橫幅；
  i18n 兩語系；docs 一節。
- **Out**：告警／通知（v0.8）；自動判斷限制何時解除（Nexus 不給日期）；任何對 Nexus 的寫入操作。
