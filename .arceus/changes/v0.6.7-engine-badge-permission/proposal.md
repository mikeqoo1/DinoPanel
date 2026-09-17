# v0.6.7 — 引擎標示 + socket 權限狀態 + 節點清單收合

## 為什麼 (Why)

v0.6.6 部署 234 後跑 14 台節點 smoke，6 台 `conex` 帳號的節點回 500 `NODES_COMMAND_FAILED`，
根因是 docker 有裝但 socket 無權限（不在 docker group）。面板把它當一般失敗，UI 只看到紅色錯誤碼，
看不出是權限問題。使用者選擇「面板端辨識、不動主機權限」。

同時提出兩個 UI 需求：(1) 遠端容器卡與本機容器管理頁要看得出是 Docker 還是 Podman
（v0.6.6 刻意跳過的 `engine` 欄位，現在有人要了）；(2) 節點清單 14 行太長，點選節點後要往下捲
才看到指標與容器，希望清單能收合。

## 目標

1. socket 權限不足 → 200 `{ permissionDenied: true }`，UI 黃色提示寫出帳號與引擎；不 log、不改主機。
2. 遠端回應加 `engine`（docker / podman / null），容器卡標題加 Badge。
3. 本機新 `GET /containers/engine`，容器管理頁標題旁 Badge「Docker 29.1.3」/「Podman 6.1.1」。
4. 節點清單：點選節點自動收合，標題列「顯示清單（N）/ 隱藏清單」切換。

## 範圍 (Scope)

- **In**：`nodes/ssh.ts`（`ENGINE_MARKER`、`isEnginePermissionDenied`、warn-skip）、`nodes.service.ts`
  （marker 解析、permissionDenied 分支）、shared `remoteContainersResponseSchema` + `localEngineSchema`、
  `containers.service.ts` `getEngine()` + controller route、web `use-containers.ts` `useEngine`、
  `nodes-page.tsx`、`containers.tsx`、i18n 4 keys × 2 語系、docs nodes/containers。
- **Out**：對任何節點 `usermod`；Compose / Images 頁 Badge；收合狀態持久化；`dockerAvailable` 改名。
