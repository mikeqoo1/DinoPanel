# Tasks — v0.6.11

- [x] T-1 RED 3 條：舊格式可載入並套預設、舊格式可 updateLimits 且保留密碼、url 無效仍丟棄。
- [x] T-2 GREEN：`storedInstanceSchema` 兩個上限欄位改 optional（不再由 `nexusInstanceSchema` 繼承必填），
      `toPublic` 補 `CE_*` 預設值。
- [x] T-3 typecheck / lint / build 綠；test 642。
- [ ] T-4 release 0.6.11 → 部署 234 → 確認兩台實例回來、用量與上限正常。
