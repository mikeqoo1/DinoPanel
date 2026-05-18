# v0.5.1 — Task checklist (draft)

This is mostly a **manual validation** pass driven by the operator
against the real Rocky 9.4 deploy at 192.168.199.234. The
"verification" column captures what evidence to look for.

## Smoke pass items

### S1. Firewall rollback — Confirm path ✅ 2026-05-18

- [x] Stage allow rule via `/system/firewall` → Add rule, port `19000/tcp`
- [x] 30s countdown AlertDialog visible
- [x] Click "確認保留" — rule visible in list with allow badge
- [x] DB: both `confirming_at` AND `confirmed_at` non-NULL on row port=19000
- [x] Kernel: `firewall-cmd --list-all --permanent | grep 19000` shows the rich rule
- [x] Cleanup via UI delete — DB + kernel both clean

### S2. Firewall rollback — Cancel path ✅ 2026-05-18

- [x] Stage allow rule on port `19001/tcp`
- [x] Click "立即撤銷" — modal closes, rule not in list
- [x] DB clean: `firewall_rule_meta WHERE port = 19001` returns nothing
- [x] Kernel clean: `firewall-cmd --list-all --permanent | grep 19001` silent

### S3. Firewall rollback — Auto-revert (close tab) ✅ 2026-05-18

- [x] Stage allow rule on port `19002/tcp`
- [x] **Close the browser tab** (do not click Confirm or Cancel)
- [x] Wait ~35 seconds
- [x] Re-open `/system/firewall` — port `19002` is NOT in the list
- [x] DB clean: `SELECT … FROM firewall_rule_meta WHERE port = 19002` returns nothing
- [x] Kernel clean: `firewall-cmd --list-all --permanent | grep 19002` returns nothing

### S4. Audit log captures mutations ✅ 2026-05-18

- [x] Trigger 3 known mutations through the UI (retention change,
      scheduler create, scheduler delete)
- [x] /system/logs → Operation tab shows all 3 mutations
- [x] DB confirm via direct SELECT — full smoke-pass history
      visible (S1 firewall stage/confirm/delete, S3 stage,
      S4 scheduler CRUD, S5 retention change, PMM config bonus)
- [x] Path normalization works: all rows show route templates
      (`:id`), not raw URLs — proves Fastify v5
      `routeOptions.url` fallback is correct
- [ ] Body redaction skipped — `/api/auth/*` is excluded from
      AuditInterceptor by design (`shouldAudit()` early-returns
      for that prefix). Login attempts captured separately via
      `login_attempts` table → /system/logs Login tab.

### S5. Purge task — Run-now path ✅ 2026-05-18

- [x] Lowered retention to 1 day via Settings card
- [x] Seeded 50 audit rows with `created_at = now - 2 days`
- [x] Triggered `system.purge_operation_log` via
      `POST /api/scheduler/tasks/1/run` (built-in, id=1)
- [x] Old rows deleted, recent rows kept
- [x] Restored retention to 30 days

### S6. Driver detection (already validated 2026-05-18)

- [x] FirewalldDriver picked because `which firewall-cmd` returns 0
- [x] 9+ external rules parsed cleanly from `firewall-cmd --list-all --permanent`
- [x] No false positives, no crashes

## Fixes triggered by smoke pass

- [ ] *(any bug surfaced)* — TBD

## Settings dogfood (bonus)

- [ ] Wire PMM URL on this Rocky host (it actually runs PMM
      agents — pmm-agent visible in /system/logs/system). Confirm
      the monitoring page works against the real PMM Server.

## Verification gates (after fixes, if any)

- `pnpm typecheck` ✅
- `pnpm lint` ✅
- `pnpm test` ✅ (no regressions)
- `pnpm build` ✅
- This document's checkboxes all ticked
