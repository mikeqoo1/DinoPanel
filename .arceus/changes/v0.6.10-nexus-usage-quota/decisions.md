# Decisions — v0.6.10

- **D1 上限做成設定，不寫死在程式裡**。`usage-metrics`、`status-check`、`monthly-metrics`、
  `system/license` 與前端 bundle 全查過：Nexus **沒有任何地方**回傳社群版上限，bundle 只有
  `SOFT_THRESHOLD`／`HARD_THRESHOLD` 字串與 `PERCENTAGE: .75`。所以預設值用官方文件的 20 萬/10 萬，
  但做成每台可改（`PATCH :id/limits`），並在 UI 明講「以你 Usage Center 看到的為準」。
  把猜測的數字寫死在程式裡，錯了沒人知道。
- **D2 用量失敗不能拖垮流量取樣**。`fetchUsage` 自己吞例外回 null，五個欄位可為 null；
  帳號讀不到內部端點時流量圖照常，只是不顯示用量區塊。
- **D3 五個欄位加進既有 `nexus_samples`，不開第二張表**。同一次輪詢、同一個時間戳，
  分表只會多一次 join；也讓 24 小時請求數的走勢圖直接跟流量共用同一組樣本。
- **D4 `requests24h` 是 gauge 不是 rate**。`toSeries` 對它取桶內最後一筆原值，不做差分。
- **D5 警戒比例沿用 Nexus 自己的 75%**（從它 bundle 的 `PERCENTAGE: .75` 讀到），不自己另訂。
- **D6 pipe 綁在 `@Body` 參數上，不用方法層 `@UsePipes`**。方法層的 pipe 會套到**每一個**參數，
  `@Param('id')` 這個字串也會被拿去驗物件 schema → `PATCH :id/limits` 回
  `VALIDATION_FAILED expected object, received string`。真機 E2E 才抓到，單元測試看不到。
  repo 其他 controller（scheduler、databases、acme）本來就是參數層寫法，這裡改成一致。
