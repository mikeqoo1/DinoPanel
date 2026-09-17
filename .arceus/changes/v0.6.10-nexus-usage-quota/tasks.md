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
- [ ] T-6 release 0.6.10 → 部署 234 → 確認兩台用量顯示、dev2 應該接近/超過上限 → UI 目視。
