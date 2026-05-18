# v0.5.1 — Task checklist (draft)

This is mostly a **manual validation** pass driven by the operator
against the real Rocky 9.4 deploy at 192.168.199.234. The
"verification" column captures what evidence to look for.

## Smoke pass items

### S1. Firewall rollback — Confirm path

- [ ] Stage allow rule via `/system/firewall` → Add rule, port
      `19000/tcp`, no source, action allow
- [ ] 30s countdown AlertDialog visible
- [ ] Click "確認保留" (Confirm)
- [ ] **Verify in DB**:
      ```sql
      SELECT id, port, proto, confirming_at, confirmed_at
      FROM firewall_rule_meta WHERE port = 19000;
      ```
      Both `confirming_at` AND `confirmed_at` should be non-NULL.
- [ ] **Verify in kernel**: `sudo firewall-cmd --list-all --permanent | grep 19000` shows the rich rule
- [ ] Cleanup: delete the rule via UI

### S2. Firewall rollback — Cancel path

- [ ] Stage allow rule on port `19001/tcp`
- [ ] Click "立即撤銷" (Revert)
- [ ] **Verify**: kernel no longer has the rule, meta row gone

### S3. Firewall rollback — Auto-revert (close tab)

- [ ] Stage allow rule on port `19002/tcp`
- [ ] **Close the browser tab** (do not click Confirm or Cancel)
- [ ] Wait ~35 seconds
- [ ] Re-open `/system/firewall`
- [ ] **Verify**: port `19002` is NOT in the list (auto-revert fired)
- [ ] **Verify in journalctl**: `journalctl -u dinopanel | grep auto_revert` should be silent (no errors)

### S4. Audit log captures mutations

- [ ] Trigger 3 known mutations through the UI:
      a. Change `audit.retentionDays` from 30 → 14 (Settings page)
      b. Create a scheduler task `date-test` via /system/scheduler
      c. Delete the scheduler task
- [ ] Go to `/system/logs` → Operation tab
- [ ] **Verify 3 rows visible** with paths:
      - `PUT /api/audit/retention`
      - `POST /api/scheduler/tasks`
      - `DELETE /api/scheduler/tasks/:id`
- [ ] **Verify body redaction**: change admin password via Settings
      → Operation tab should show `POST /api/auth/change-password`
      with `bodySummary` containing `[redacted]`, NEVER the
      plaintext password
      *(Caveat: `/api/auth/*` is currently skipped — see audit
      interceptor `shouldAudit()`. If we want it captured, that's
      a tiny fix here.)*

### S5. Purge task — Run-now path

- [ ] Lower retention to 1 via Settings → Operation log retention
- [ ] Generate audit rows older than 1 day (trick: directly insert
      via SQL with `created_at = now - 2 days * 86_400_000`)
      ```bash
      sudo node -e "
      const Database = require('/usr/local/dinopanel/server/node_modules/better-sqlite3');
      const db = new Database('/var/lib/dinopanel/dinopanel.db');
      const twoDaysAgo = Date.now() - 2 * 86_400_000;
      const stmt = db.prepare('INSERT INTO operation_log (method, path, status_code, duration_ms, created_at) VALUES (?, ?, ?, ?, ?)');
      for (let i = 0; i < 50; i++) stmt.run('GET', '/api/test/old/' + i, 200, 1, twoDaysAgo);
      console.log('seeded');
      "
      ```
- [ ] Trigger purge manually via API (the built-in task is hidden
      from the UI list):
      ```bash
      TOKEN='<paste your access token from devtools/localStorage>'
      curl -X GET "http://192.168.199.234:9999/api/scheduler/tasks?includeBuiltin=true" \
        -H "Authorization: Bearer $TOKEN"
      # find the purge task id (probably 1), then:
      curl -X POST "http://192.168.199.234:9999/api/scheduler/tasks/1/run" \
        -H "Authorization: Bearer $TOKEN"
      ```
- [ ] **Verify**: the 50 seeded rows are gone, recent rows kept
- [ ] **Verify in /system/logs Task tab**: a row for the purge
      task with `output` showing `retention=1d, deleted=50, kept=…`

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
