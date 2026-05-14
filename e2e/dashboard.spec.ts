import { test, expect } from '@playwright/test';

test('dashboard — shows metric cards with live data and Recharts SVG', async ({ page }) => {
  await page.goto('/');

  // Dashboard renders 4 metric cards (CardTitle elements with text-sm font-medium class)
  // Rather than matching i18n text, verify the structural metric cards exist
  // The cards contain a large bold number value
  const metricValues = page.locator('.text-2xl.font-bold.tabular-nums');
  await expect(metricValues.first()).toBeVisible({ timeout: 10_000 });

  // Wait for live WebSocket connection — the "live" badge only appears when connected.
  // The badge text is always "live" (hardcoded, not translated) in dashboard.tsx
  await expect(page.getByText('live')).toBeVisible({ timeout: 15_000 });

  // After live data arrives, at least one card value should be non-dash
  await expect(
    page.locator('.text-2xl.font-bold.tabular-nums').filter({ hasNotText: '—' }).first()
  ).toBeVisible({ timeout: 15_000 });

  // Recharts renders SVG — wait for it to appear inside a metric chart
  await expect(page.locator('svg').first()).toBeVisible({ timeout: 15_000 });

  // System info section: CardTitle is rendered; search for the card that contains a grid of fields
  // hostname field row has a span with the machine hostname value
  // The Field component always renders label in a w-32 span
  await expect(page.locator('.w-32.shrink-0').first()).toBeVisible({ timeout: 10_000 });
});
