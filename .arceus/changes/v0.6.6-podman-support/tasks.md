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
- [ ] T-7（operator）找一台真正純 Podman 的遠端主機註冊進 /nodes 看容器頁；面板裝在 Podman 主機上
      跑 compose up/down 一次。本機沒有純 Podman 環境，這兩條沒驗。
