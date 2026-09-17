# Tasks — v0.6.9

- [x] T-0 探測真實端點：確認 prometheus 端點需授權（403 → 帶帳密 200，3537 行）、指標名稱與數值、
      repositories 匿名可讀、234 連得到兩台。
- [x] T-1 RED：`metrics.test.ts` 13 條（parser／extract／bucket／toSeries 含計數器倒退與零間隔）、
      `nexus.service.test.ts` 8 條（加密儲存、重複、移除、壞 KV、Basic auth、401/403、網路失敗、poll 不 reject）。
- [x] T-2 GREEN：shared `schemas/nexus.ts`；`metrics.ts`；`nexus.service.ts`（KV + 加解密 + fetch + poller + series）；
      controller／module；`nexus_samples` 表 + migration `0006_grey_dracula.sql`；app.module 註冊。
- [x] T-3 Web：`use-nexus.ts`、`nexus-page.tsx`（recharts 雙序列圖）、側欄 Boxes 圖示、`/nexus` 路由、i18n 兩語系。
- [x] T-4 typecheck / lint / build 綠；test 627。
- [x] T-5 本機 E2E 對真實 dev1/dev2（見 smoke-pass.md），結束後刪除本機測試實例。
- [ ] T-6 release 0.6.9 → 部署 234 → 在 234 上新增兩台實例 → 隔兩輪確認 series 有點 → UI 目視。
