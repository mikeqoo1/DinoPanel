# Tasks — v0.6.11

- [x] T-1 RED 3 條：舊格式可載入並套預設、舊格式可 updateLimits 且保留密碼、url 無效仍丟棄。
- [x] T-2 GREEN：`storedInstanceSchema` 兩個上限欄位改 optional（不再由 `nexusInstanceSchema` 繼承必填），
      `toPublic` 補 `CE_*` 預設值。
- [x] T-3 typecheck / lint / build 綠；test 642。
- [x] T-4 release 0.6.11（`2ae0a75`）→ 部署 234 → 兩台實例回來，上限顯示 200000/100000，用量正常（見 v0.6.10 的 smoke-pass.md）。
