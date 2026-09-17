# Spec — v0.6.11

## AC1 舊資料
- KV 內容為 v0.6.9 格式（無 `requestsPerDayLimit` / `componentsLimit`）時，`list()` 回傳該實例，
  並帶 `requestsPerDayLimit: 200000`、`componentsLimit: 100000`、`hasPassword: true`。

## AC2 舊資料可被更新
- 對 v0.6.9 格式的實例呼叫 `updateLimits` 成功，且寫回的 blob 仍保有原本的 `passwordEnc`。

## AC3 真正無效的資料仍丟棄
- url 不合格式的項目仍然被丟掉，`list()` 不回傳它。

## 驗證
- 單元 642（v0.6.10 基線 639），新增 3 條。
- 234 部署後 `GET /nexus` 應回兩台、上限顯示預設值、用量正常。
