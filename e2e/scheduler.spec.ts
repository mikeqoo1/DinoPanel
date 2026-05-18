import { test, expect } from '@playwright/test';

/**
 * v0.5 scheduler smoke: create a shell task that echoes a unique
 * marker, kick off Run-now, expand the row, and assert a success
 * run line appears.
 *
 * Cleans up after itself by deleting the task at the end.
 */
test('scheduler — create shell task, run now, see success run', async ({ page }) => {
  const marker = `dinopanel-e2e-${Date.now()}`;
  const taskName = `e2e ${marker}`;

  await page.goto('/system/scheduler');

  // List loaded (or empty placeholder shown)
  await page.waitForLoadState('networkidle');

  // Open Add task dialog
  await page.getByRole('button', { name: /add task|新增任務/i }).click();

  // Wait for dialog
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // Name input (first text input in dialog after labels)
  await dialog.locator('input[type="text"], input:not([type])').first().fill(taskName);

  // Shell command textarea (only one textarea visible in default shell mode)
  await dialog.locator('textarea').fill(`echo ${marker}`);

  // Submit
  await dialog.getByRole('button', { name: /create|建立/i }).click();
  await expect(dialog).toBeHidden();

  // New row appears
  const row = page.getByRole('row').filter({ hasText: taskName });
  await expect(row).toBeVisible({ timeout: 10_000 });

  // Run now (Play icon button on the row)
  const runBtn = row.locator('button[title*="Run"], button[title*="立即"]');
  await runBtn.click();

  // Expand the row (chevron toggle)
  const toggleBtn = row.locator('button').first();
  await toggleBtn.click();

  // The expanded panel should show a recent run; we look for the
  // unique marker we asked echo to print, or a success badge in the
  // expanded section beneath the row.
  await expect(page.getByText('success').last()).toBeVisible({ timeout: 15_000 });

  // Cleanup — click delete and accept the confirm dialog.
  // Some browsers show a window.confirm; intercept it.
  page.once('dialog', (d) => d.accept());
  const removeBtn = row.locator('button[title*="Delete"], button[title*="刪除"]');
  await removeBtn.click();
  await expect(row).toBeHidden({ timeout: 5_000 });
});
