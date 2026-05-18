import { test, expect } from '@playwright/test';

const FIREWALL_E2E = process.env.DINOPANEL_E2E_FIREWALL === '1';

// Gated: most CI sandboxes and dev VMs lack ufw / firewall-cmd, so
// run only when the operator opts in via env. The dry-path
// (UnavailableFirewallDriver) is covered by the unit tests.
test.describe('firewall', () => {
  test.skip(!FIREWALL_E2E, 'DINOPANEL_E2E_FIREWALL=1 not set');

  test('stage allow rule, see countdown modal, confirm, rule appears', async ({ page }) => {
    const testPort = 19999; // unlikely to clash; allow rule has no effect on traffic

    await page.goto('/system/firewall');
    await page.waitForLoadState('networkidle');

    // If the page shows the "not configured" card, this e2e is invalid.
    const notConfigured = page.getByText(/Neither ufw nor firewall-cmd|沒有安裝/);
    if (await notConfigured.isVisible().catch(() => false)) {
      test.fail(true, 'firewall not configured on this host');
      return;
    }

    // Open Add Rule dialog
    await page.getByRole('button', { name: /add rule|新增規則/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Fill port
    await dialog.locator('input[type="number"]').first().fill(String(testPort));

    // Stage
    await dialog.getByRole('button', { name: /stage rule|套用/i }).click();
    await expect(dialog).toBeHidden();

    // Rollback modal appears with a numeric countdown
    const rollback = page.getByRole('dialog').filter({ has: page.locator('text=/\\d+s/') });
    await expect(rollback).toBeVisible({ timeout: 5_000 });

    // Confirm
    await rollback.getByRole('button', { name: /keep rule|確認保留/i }).click();
    await expect(rollback).toBeHidden({ timeout: 5_000 });

    // Rule visible in the table
    const portCell = page.getByRole('cell', { name: String(testPort) });
    await expect(portCell).toBeVisible({ timeout: 10_000 });

    // Cleanup — delete the rule
    page.once('dialog', (d) => d.accept());
    const row = page.getByRole('row').filter({ hasText: String(testPort) });
    await row.locator('button[title*="Remove"], button[title*="刪除"]').click();
    await expect(portCell).toBeHidden({ timeout: 5_000 });
  });
});
