# Tasks — v0.6.10

- [x] T-0 查上限來源：`usage-metrics`、`status-check`、`monthly-metrics`（意外找到，有 6 個月歷史）、
      `system/license`（402）、前端 bundle 2.2 MB 全查過 → **Nexus 不提供上限值**，只有 75% 警戒比例。
- [x] T-1 RED 11 條：`parseUsageMetrics` ×3、`toSeries` gauge ×2、poll 存用量／403 留 null／壞 body ×3、
      預設上限／指定上限／`updateLimits` 保留密碼／未知 id 404 ×4。
- [x] T-2 GREEN：shared（上限欄位 + `CE_*` 常數 + `USAGE_WARN_RATIO` + `nexusUsageSchema` +
      `CreateNexusInstanceInput`）、`parseUsageMetrics`、`toSeries` gauge、`nexus_samples` 五欄 +
      migration 0007、`fetchUsage`、`updateLimits`、`PATCH :id/limits`。
- [x] T-3 Web：`useUpdateNexusLimits`、`QuotaBar`／`UsageSection`／`LimitsDialog`、配額走勢圖、i18n 兩語系。
- [x] T-4 typecheck / lint / build 綠；test 639。
- [x] T-5 本機 E2E 對真實 dev2 → **抓到 D6 的 pipe 綁定錯誤**，修成參數層後重驗全過（見 smoke-pass.md）。
- [x] T-6 release 0.6.10（`b7131b3`）→ 部署 234 → **踩到舊實例被丟棄**，由 v0.6.11（`2ae0a75`）修正 →
      dev1 8.5%、dev2 97.8%（見 smoke-pass.md）。UI 目視留給使用者。
