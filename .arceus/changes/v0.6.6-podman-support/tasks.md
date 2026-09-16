# Tasks — v0.6.6 Podman 支援

- [x] T-1 RED：`ssh.test.ts` 改 import `CONTAINER_PS_CMD`，加 fallback 順序／exit 127／無 mutation 動詞／
      `isDockerAbsent` podman 五個測試；`remote-parsers.test.ts` 加 Podman 形狀一筆；
      新 `docker-socket.test.ts` 五個 case；`compose.service.test.ts` 加 CS-10~12。跑出 6 個預期失敗。
- [x] T-2 GREEN：`ssh.ts` `CONTAINER_PS_CMD` + regex；`nodes.service.ts` 改 import；
      新 `containers/docker-socket.ts` + `containers.module.ts` 接上；`compose.service.ts` `composeBin`
      偵測迴圈、兩處 spawn 改用；`docker-error.ts` 訊息；i18n en / zh-TW。
- [x] T-3 文件：`docs/nodes.md`（fallback、rootless 可見範圍、AC7 grep 擴 podman）、
      `docs/containers.md`（socket 順序、Podman 段、compose 偵測、troubleshooting）、README 兩語系。
- [x] T-4 驗證：typecheck / lint / build 綠；`pnpm test` 574/574（基線 561）。
- [x] T-5 Smoke（本機 podman 6.1.1）：A 命令字串遮掉 docker 退到 podman；A2 皆無 → exit 127；
      C dockerode 對 `podman.sock` info/list/label-filter/inspect/images/networks/volumes；
      E2E 編好的 server 指 podman.sock，containers/compose/images/networks/volumes 全 200。
- [x] T-6 release cut v0.6.6（4 個 package.json bump）。
- [x] T-7a 部署 234（v0.6.5 → v0.6.6，upgrade 模式、DB 備份、verify 過）；14 台節點實跑 `CONTAINER_PS_CMD`；
      ConeX-dev1 純 Podman 模擬 exit 0 / 無引擎 exit 127（見 smoke-pass.md）。
- [x] T-7b 面板 HTTP 層 smoke：`scripts/smoke-podman-nodes-234.sh` 對 234 跑過，14 台結果與 root 直跑一致（8×200 / 6×500 conex 權限）。
- [ ] T-7c（另案）conex 6 台 docker socket permission denied → 500 `NODES_COMMAND_FAILED`；
      `usermod -aG docker conex` 或面板加獨立 error code。
- [ ] T-7d 面板裝在純 Podman 主機上 compose up/down（沒有這種環境，擱置）。
