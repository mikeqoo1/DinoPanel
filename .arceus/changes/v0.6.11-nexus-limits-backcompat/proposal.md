# v0.6.11 — 修 v0.6.10 讓舊的 Nexus 實例整個消失

## 為什麼 (Why)

v0.6.10 部署到 234 後，`GET /nexus` 回空陣列，v0.6.9 註冊的 ConeX-dev1/dev2 從畫面上消失。

根因：v0.6.10 把 `requestsPerDayLimit` / `componentsLimit` 加進 `nexusInstanceSchema`（必填），
而 KV 儲存用的 `storedInstanceSchema` 是由它 `omit` 衍生的，於是這兩個欄位在**儲存層也變成必填**。
`readList()` 的設計是「parse 失敗就丟掉該筆」（防竄改），結果 v0.6.9 寫入、沒有這兩個欄位的舊資料
每一筆都 parse 失敗 → 全部被丟掉。

資料沒有遺失（`readList` 只讀不寫，磁碟上的 blob 完好），但面板上等於實例全不見了。

## 目標

舊資料照常載入並套用社群版預設上限；真正無效的資料（例如 url 格式錯）仍然要丟掉。

## 範圍 (Scope)

- **In**：`storedInstanceSchema` 兩個上限欄位改為 optional、`toPublic` 補預設值；三條迴歸測試。
- **Out**：不做資料遷移腳本（舊 blob 讀得進來即可，之後任何一次寫入自然補上欄位）。
