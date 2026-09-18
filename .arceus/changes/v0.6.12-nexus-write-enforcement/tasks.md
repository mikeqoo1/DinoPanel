# Tasks — v0.6.12

- [x] T-0 查證：重現 CI 的 `POST /v2/docker_private/conex/middy/blobs/uploads/` → dev2 403（完整訊息）、dev1 202；
      `GET /v2/`、`tags/list` 兩邊皆 200（只擋寫入）；找到三個 `nexus_analytics_*` 計數器；
      面板歷史證明失敗當下用量只有 90%。
- [x] T-1 RED 9 條：三個計數器抽取、缺少讀 0、`enforcementFromSamples` 六種情況、poll 寫入欄位。
- [x] T-2 GREEN：shared（`nexusEnforcementSchema` + metrics 三欄 + `NexusSeries.enforcement`）、
      `extractNexusMetrics`、`enforcementFromSamples`、`nexus_samples` 三欄 + migration 0008、service。
      修正：schema 宣告順序（`nexusEnforcementSchema` 必須在 `nexusSeriesSchema` 之前）。
- [x] T-3 Web：`EnforcementBanner`（紅／黃／寬限三態）置於卡片最上方；i18n 兩語系。docs 新增「Write enforcement」節。
- [x] T-4 typecheck / lint / build 綠；test 650。
- [x] T-5 release 0.6.12（`ba4303b`）→ 部署 234（migration 0008）→ dev1 無橫幅、dev2 `blocked:7`；
      再觸發一次被擋寫入後轉為 `blocked:8, blockedInRange:1`，紅色路徑活驗通過（見 smoke-pass.md）。UI 目視留給使用者。
