import { test, expect } from '@playwright/test';

/**
 * Login golden path — does NOT use storageState so we test the real login flow.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test('login page — can sign in with valid credentials and land on dashboard', async ({ page }) => {
  await page.goto('/login');

  // Login form is visible — heading text is i18n-translated, check for the form instead
  await expect(page.locator('form')).toBeVisible();

  // Fill credentials using stable id attributes
  await page.locator('#username').fill('admin');
  await page.locator('#password').fill('DinoTest1234');

  // Submit
  await page.locator('form button[type="submit"]').click();

  // Redirects to dashboard (index route) — match any path that is NOT /login
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });

  // AppShell sidebar is rendered (DinoPanel brand text present)
  await expect(page.getByText('DinoPanel').first()).toBeVisible();
});

test('login page — shows error on wrong password', async ({ page }) => {
  await page.goto('/login');

  await page.locator('#username').fill('admin');
  await page.locator('#password').fill('wrong-password-xyz');
  await page.locator('form button[type="submit"]').click();

  // The error toast text is i18n-translated; match the sonner toast container
  await expect(page.locator('[data-sonner-toast]')).toBeVisible();
});
