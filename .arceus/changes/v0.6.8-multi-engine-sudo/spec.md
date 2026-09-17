# Spec — v0.6.8

## AC1 腳本
- `CONTAINERS_CMD` 以 `export LC_ALL=C;` 開頭、含字面 `docker ps -a` 與 `podman ps -a`、含 `/run/user/` 與 `sudo -n -u`、無單引號、
  無 `(docker|podman) (start|stop|restart|rm|exec|run|kill|pull)`、皆無引擎 `exit 127`。
- `wrapRemote(s,false)` = `bash -c '<s>'`；`wrapRemote(s,true)` = `sudo -S -k -p "" bash -c '<s>'`；`s` 含單引號 → throw。

## AC2 判斷式
- `isSudoFailed`：exit 非 0 且 stderr 符合 `incorrect password attempt|Sorry, try again|a password is required|is not in the sudoers file|^sudo:`。
- `sshExec` 對 `isDockerAbsent` / `isSudoFailed` 皆不 warn。

## AC3 parser
- `parseContainersOutput`：`{engine,owner,c}` → 容器（含 engine/owner；`Id`/`ID`、`Names` 字串或陣列；未知 state → dead）；
  `{engine,owner,rc,err}` → `{engine,owner,ok: rc===0, permissionDenied: rc!==0 && /permission denied/i}`；其他 → onBadLine。

## AC4 service
- `add({sudoPassword})` → KV 存 `sudoPasswordEnc`（不含明文）；回傳與 `list()` 皆只有 `hasSudo`。
- `getContainers`：有密碼 → `sudo` 包裝 + `input: pw\n`；exit 127 → no-engine；sudo 拒 → `sudoFailed`；其他非 0 → 500；
  正常 → `{dockerAvailable:true, sudoFailed:false, engines, containers}`。
- `testNode`：有密碼時多跑一次 `sudo -S -k … true` 回 `sudoOk`；沒密碼不多跑、無 `sudoOk` 欄。
- 解密失敗 → 500 `NODES_SUDO_UNREADABLE`。

## AC5 secrets
- `deriveSecretsKey` 確定性 32 bytes；`encryptSecret` 每次不同、不含明文、`v1:` 前綴；錯 key／竄改／格式錯 → throw。

## AC6 UI
- 新增節點：`sudo 密碼（選填）`（root 時停用）；列表名稱旁鑰匙圖示；測試連線顯示 `sudo ✓/✗`。
- 容器卡：標題後每個成功引擎一顆 Badge；有 permissionDenied 的引擎在標題下一行黃字；表格多「引擎」欄（Badge + 擁有者）；
  `sudoFailed` → 黃卡。

## 驗證
- 單元 606（v0.6.7 基線 592）。真機：root@234 用 dist 的 `wrapRemote(CONTAINERS_CMD)` 打 dev2（sudo 正確／錯誤／無）與 235（root），見 smoke-pass.md。
