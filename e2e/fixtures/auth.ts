import type { Page } from '@playwright/test';

export const TEST_USER = 'admin';
export const TEST_PASS = 'DinoTest1234';

/**
 * Perform login via the UI and wait until the dashboard (index route) is loaded.
 */
export async function login(page: Page, username = TEST_USER, password = TEST_PASS) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  // Use id selectors because the labels are i18n-translated and may vary by locale
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.locator('form button[type="submit"]').click();
  // After login the router redirects to "/" (dashboard)
  await page.waitForURL('/');
}

/**
 * Call the REST API directly to delete a file (avoids UI round-trip in cleanup).
 */
export async function apiDeleteFile(page: Page, filePath: string) {
  await page.request.delete('/api/files', {
    data: { path: filePath },
  });
}
