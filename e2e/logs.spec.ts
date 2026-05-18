import { test, expect } from '@playwright/test';

/**
 * Cross-test validation that AuditInterceptor is wired correctly:
 * trigger a known mutation (PUT /api/audit/retention through the
 * Settings page), then open /system/logs operation tab and verify
 * the row landed.
 */
test('logs — operation tab captures audit rows from mutations', async ({ page }) => {
  // Trigger a known mutation: change retention via the Settings card.
  // The exact value doesn't matter — pick something within bounds.
  const newRetention = 31;

  await page.goto('/settings');
  await page.waitForLoadState('networkidle');

  const retentionInput = page.locator('#audit-retention');
  await expect(retentionInput).toBeVisible({ timeout: 10_000 });

  await retentionInput.fill(String(newRetention));
  // The retention input lives inside a card with a w-fit save button.
  // Find the closest button after the input, scoped to its DOM neighbourhood.
  const retentionSaveBtn = page.locator(
    'xpath=//input[@id="audit-retention"]/ancestor::*[contains(@class,"flex")][1]//button',
  );
  await retentionSaveBtn.first().click();

  // Sonner toast confirms the save
  await expect(page.getByText(/Retention updated|已更新保留天數/)).toBeVisible({ timeout: 5_000 });

  // Navigate to operation log tab
  await page.goto('/system/logs');
  await page.waitForLoadState('networkidle');

  // Default tab is "system"; switch to "operation"
  await page.getByRole('tab', { name: /operation|操作/i }).click();

  // Find a row referencing the audit/retention endpoint we just hit
  const auditRow = page
    .getByRole('row')
    .filter({ hasText: '/api/audit/retention' });
  await expect(auditRow.first()).toBeVisible({ timeout: 10_000 });

  // The method should be PUT
  await expect(auditRow.first()).toContainText('PUT');
});
