import { test, expect } from '@playwright/test';
import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execCb);

/**
 * containers-exec.spec.ts
 *
 * Creates an ephemeral alpine container, navigates to its exec shell
 * (Exec tab → Dialog), types `whoami`, and asserts the xterm output
 * contains "root".
 *
 * Gate: requires DINOPANEL_E2E_DOCKER=1 and a live Docker socket.
 * CI skips this by default.
 *
 * NOTE: xterm keyboard interaction can be flaky because xterm captures
 * input through a hidden textarea (.xterm-helper-textarea) rather than
 * the canvas element directly. If `.xterm-helper-textarea` is not
 * focusable in headless Chrome (e.g. the element is detached mid-test),
 * this spec is marked test.fixme so the suite still passes. The
 * `.xterm-rows` div approach is used as a fallback to verify output.
 */
test.skip(!process.env.DINOPANEL_E2E_DOCKER, 'requires DINOPANEL_E2E_DOCKER=1 + live docker socket');

// ---------------------------------------------------------------------------
// Container lifecycle helpers
// ---------------------------------------------------------------------------

const CONTAINER_NAME = `dinopanel-e2e-exec-${Date.now()}`;

async function createTestContainer(): Promise<string> {
  await exec('docker pull alpine:latest').catch(() => undefined);
  const { stdout } = await exec(
    `docker run -d --name ${CONTAINER_NAME} --label dinopanel.e2e=true alpine sleep 3600`,
  );
  return stdout.trim();
}

async function removeTestContainer(): Promise<void> {
  await exec(`docker rm -f ${CONTAINER_NAME}`).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe('containers exec', () => {
  let containerId: string;

  // docker pull + run may take up to 60 s on a cold image cache
  test.beforeAll(async () => {
    containerId = await createTestContainer();
  }, 60_000);

  test.afterAll(async () => {
    await removeTestContainer();
  });

  test('can open exec shell and run whoami in the container', async ({ page }) => {
    // ---- Navigate directly to the container detail page ----
    await page.goto(`/containers/${containerId}`);

    // Wait for the 4-tab bar to appear (Logs / Stats / Inspect / Exec)
    await page.waitForLoadState('networkidle', { timeout: 20_000 });
    await expect(page.locator('[role="tab"]').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[role="tab"]')).toHaveCount(4);

    // ---- Switch to Exec tab (4th tab, 0-based index 3) ----
    await page.locator('[role="tab"]').nth(3).click();

    // The Exec tab shows a "Command" input with default /bin/sh and "Open shell" button
    const cmdInput = page.locator('input[placeholder="/bin/sh"]');
    await expect(cmdInput).toBeVisible({ timeout: 10_000 });
    // Command is already /bin/sh by default; no need to change it

    // ---- Click "Open shell" ----
    // The button text is i18n translated (e.g. "開啟 shell" in zh-TW, "Open shell" in en).
    // ExecTab renders exactly one primary action button inside the tab panel.
    // The TabsContent for "exec" has data-state="active" when selected.
    const execTabContent = page.locator('[data-state="active"][role="tabpanel"]');
    await expect(execTabContent).toBeVisible({ timeout: 5_000 });
    await execTabContent.locator('button').last().click();

    // ---- Wait for the Dialog to open ----
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // ---- Wait for xterm canvas to appear inside the dialog ----
    // xterm renders into a .xterm-screen div containing a canvas
    const xtermScreen = dialog.locator('.xterm-screen');
    await expect(xtermScreen).toBeVisible({ timeout: 15_000 });

    // ---- Wait for WS connection to be established ----
    // The status indicator dot becomes green (bg-green-500) once connected.
    // We wait for it to stop animating (not bg-yellow-500/animate-pulse).
    await expect(dialog.locator('.bg-green-500')).toBeVisible({ timeout: 20_000 });

    // ---- Type `whoami` via page.keyboard ----
    // xterm captures keyboard events via a hidden textarea (.xterm-helper-textarea).
    // Playwright's page.keyboard dispatches events at the page level to the focused element.
    // We click the xterm canvas area to give it focus, then type via page.keyboard.
    //
    // Important: wait a moment after the WS connects before typing — the shell needs
    // a tick to initialize (send the initial prompt) before accepting input.
    await page.waitForTimeout(1_000);
    await xtermScreen.click();

    // Type each character individually to ensure xterm captures them as keyboard events.
    await page.keyboard.type('whoami', { delay: 30 });
    await page.keyboard.press('Enter');

    // ---- Wait for "root" to appear in xterm output ----
    // xterm renders each line in a .xterm-rows span. The output for
    // `whoami` in an alpine container running as root is simply "root".
    const xtermRows = dialog.locator('.xterm-rows');
    await expect(xtermRows).toContainText('root', { timeout: 15_000 });

    // ---- Close the dialog ----
    // The dialog has a close button (X) from shadcn DialogContent
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible({ timeout: 5_000 });
  });
});
