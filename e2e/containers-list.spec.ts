import { test, expect } from '@playwright/test';

/**
 * containers-list.spec.ts
 *
 * Smoke-tests the containers list page and the detail page (read-only).
 * No write operations (no stop/start) — safe to run against a shared Docker host.
 *
 * Gate: requires DINOPANEL_E2E_DOCKER=1 and a live Docker socket.
 * CI skips this by default.
 */
test.skip(!process.env.DINOPANEL_E2E_DOCKER, 'requires DINOPANEL_E2E_DOCKER=1 + live docker socket');

test('containers — list page shows at least one row with image name and state badge', async ({ page }) => {
  await page.goto('/containers');

  // Wait for at least one table row to appear (skeletons disappear, data loaded)
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 20_000 });

  // Verify we have at least one data row (not the empty-state row)
  const rows = page.locator('table tbody tr');
  const rowCount = await rows.count();
  expect(rowCount).toBeGreaterThanOrEqual(1);

  // First row should have a state badge in the first cell and a non-empty image cell.
  // Badge renders as a div with rounded-full + bg-* classes (shadcn Badge component).
  // The first <td> contains exactly one Badge div.
  const firstRow = rows.first();
  const stateTd = firstRow.locator('td').first();
  // The badge is a div child with text content (state text, translated)
  const badgeDiv = stateTd.locator('div').first();
  await expect(badgeDiv).toBeVisible();
  const badgeText = await badgeDiv.textContent();
  expect(badgeText?.trim().length).toBeGreaterThan(0);

  // Image cell: 3rd td (0-based: state=0, name=1, image=2, ports=3, created=4, actions=5)
  const imageTd = firstRow.locator('td').nth(2);
  const imageText = await imageTd.textContent();
  expect(imageText?.trim()).toBeTruthy();
});

test('containers — clicking a row navigates to detail page with tabs', async ({ page }) => {
  await page.goto('/containers');

  // Wait for rows to load
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 20_000 });

  // Click the first row to navigate to detail
  const firstRow = page.locator('table tbody tr').first();
  await firstRow.click();

  // Should navigate to /containers/:id
  await page.waitForURL(/\/containers\/[^/]+$/, { timeout: 15_000 });

  // Wait for the detail page to finish loading (lazy chunk fetch + container inspect)
  await page.waitForLoadState('networkidle', { timeout: 20_000 });

  // Tab bar must appear: 4 tabs (Logs / Stats / Inspect / Exec in en; 日誌/統計/詳細資訊/執行 in zh-TW).
  // Radix UI TabsTrigger renders as <button role="tab"> with data-state="active|inactive".
  // Match by count (exactly 4 tabs must be visible in the container detail bar).
  const allTabs = page.locator('[role="tab"]');
  await expect(allTabs.first()).toBeVisible({ timeout: 15_000 });
  await expect(allTabs).toHaveCount(4);
});

test('containers — detail Inspect tab shows Monaco JSON viewer with content', async ({ page }) => {
  await page.goto('/containers');

  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 20_000 });

  // Navigate to the first container's detail page
  await page.locator('table tbody tr').first().click();
  await page.waitForURL(/\/containers\/[^/]+$/, { timeout: 15_000 });
  await page.waitForLoadState('networkidle', { timeout: 20_000 });

  // Wait for the 4-tab bar to appear
  await expect(page.locator('[role="tab"]').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[role="tab"]')).toHaveCount(4);

  // Click the Inspect tab — it is the 3rd tab (0-based: Logs=0, Stats=1, Inspect=2, Exec=3)
  await page.locator('[role="tab"]').nth(2).click();

  // Monaco editor mounts inside .monaco-editor
  // Wait for the editor iframe/container to be present and contain text
  const monacoEditor = page.locator('.monaco-editor').first();
  await expect(monacoEditor).toBeVisible({ timeout: 20_000 });

  // The editor content area should contain JSON-like text (at minimum the opening brace)
  // Monaco renders view lines in .view-line spans
  await expect(
    page.locator('.monaco-editor .view-lines')
  ).toBeVisible({ timeout: 10_000 });

  // Check there is actual content (at least one view-line with text)
  const viewLines = page.locator('.monaco-editor .view-line');
  const lineCount = await viewLines.count();
  expect(lineCount).toBeGreaterThan(0);
});
