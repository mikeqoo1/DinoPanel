# Tasks — v0.6.13

- [x] T-0 追查上限來源：REST 端點全無 → 在 `/service/extdirect/poll/rapture_State_get` 找到
      `nexus.community.*` 六個 key，兩台實測（dev1 Under limits / dev2 Over limits，上限皆 100000/40000）。
- [x] T-1 RED 9 條：`parseCommunityState` 六種情況 + 服務三條（快取、端點缺席仍存樣本、移除清快取）。
- [x] T-2 GREEN：shared `nexusCommunityStateSchema` + `NexusSeries.community`；`parseCommunityState`；
      service `refreshCommunityState` / `communityStateFor` / Map 快取。
- [x] T-3 Web：橫幅改由 `throttling` 驅動（範圍無關）、進度條用回報上限、顯示生效與超限日期、
      手動上限退為 fallback；i18n 兩語系；docs 改寫「上限來源」與「橫幅優先序」。
- [x] T-4 typecheck / lint / build 綠；test 659。
- [x] T-5 release 0.6.13（`cdc4207`）→ 部署 234 → dev2 `throttling:true`、上限 100000/40000、24h 請求 194,967（195%）、
      寬限期 2026-09-10 結束；dev1 `throttling:false` 13.5%（見 smoke-pass.md）。UI 目視留給使用者。
