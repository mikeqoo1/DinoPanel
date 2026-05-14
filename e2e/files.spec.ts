import { test, expect } from '@playwright/test';
import os from 'node:os';

const HOME_DIR = os.homedir();
const TEST_FILENAME = 'e2e-smoke-test.txt';
const TEST_FILE_PATH = `${HOME_DIR}/${TEST_FILENAME}`;

test.afterEach(async ({ page }) => {
  // Clean up the test file via REST API (best-effort)
  await page.request.delete('/api/files', {
    data: { path: TEST_FILE_PATH },
    headers: { 'Content-Type': 'application/json' },
  }).catch(() => {
    // ignore if file was already deleted or never created
  });
});

test('files — lists directory entries and can create a new file', async ({ page }) => {
  await page.goto('/files');

  // Navigate to the server user's home directory (world-readable).
  // The FilesPage defaults to /root which may be inaccessible.

  // Step 1: Navigate to / via the breadcrumb Home icon
  await page.locator('nav.flex.items-center.gap-1').getByRole('button').first().click();
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 15_000 });

  // Step 2: Navigate into /home
  await page.locator('td button span.font-mono', { hasText: 'home' }).first().click();
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10_000 });

  // Step 3: Navigate into the user's home directory (e.g. 'mike')
  const homeBasename = HOME_DIR.split('/').pop() ?? 'mike';
  await page.locator('td button span.font-mono', { hasText: homeBasename }).first().click();
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10_000 });

  // The action toolbar is the LAST div.flex.items-center.gap-1 inside the card header bar.
  // (Earlier .flex.items-center.gap-1 divs are breadcrumb segments.)
  const newFileBtn = page.locator(
    'div.flex.flex-wrap.items-center.justify-between div.flex.items-center.gap-1'
  ).last().getByRole('button').first();

  await newFileBtn.click();

  // Dialog opens with a text input (placeholder "name")
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByPlaceholder('name')).toBeVisible({ timeout: 5_000 });

  // Fill filename and submit
  // Dialog buttons order: [Cancel(0), Save(1), Close/X(2)]
  // Use nth(1) to click Save — last() would hit the X close button
  await dialog.getByPlaceholder('name').fill(TEST_FILENAME);
  await dialog.getByRole('button').nth(1).click();

  // Dialog closes
  await expect(dialog).not.toBeVisible({ timeout: 10_000 });

  // Success toast
  await expect(page.locator('[data-sonner-toast]')).toBeVisible({ timeout: 10_000 });

  // New file appears in the list
  await expect(page.getByText(TEST_FILENAME)).toBeVisible({ timeout: 10_000 });
});
