# Decisions — v0.6.11

- **D1 儲存層 schema 要比 API schema 寬鬆**。API 型別要求必填是對的（前端不必處理 undefined），
  但 KV 是歷史資料，凡是由 API schema `omit` 衍生儲存 schema 的地方，新增必填欄位就會讓舊資料全部失效。
  這次把上限在儲存層標為 optional，並在 `toPublic` 補上預設值。
- **D2 不寫遷移腳本**。KV 是單一 JSON blob，讀得進來就沒事；下次 add／remove／updateLimits 任一次寫入，
  整份 blob 會以新格式重寫。多寫一支一次性腳本反而多一個要維護的東西。
- **D3 保留「parse 失敗就丟掉」的行為**。那是 v0.6.2 起的防竄改設計（KV 內容會流進 ssh argv／HTTP URL），
  不因為這次踩到就放寬；只放寬「這個欄位可以不存在」。
- **D4 教訓**：用 `schema.omit()` 從對外契約衍生儲存契約，看起來 DRY，實際上把「對外必填」偷偷變成
  「儲存必填」。往後在 nexus／nodes 這類 KV 模組加必填欄位，先想舊資料讀不讀得進來。
