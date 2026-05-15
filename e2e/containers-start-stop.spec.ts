import { test, expect } from '@playwright/test';
import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execCb);

/**
 * containers-start-stop.spec.ts
 *
 * Creates a dedicated ephemeral test container, stops it, starts it again,
 * then tears down. Uses the containers list page for state observation.
 *
 * Gate: requires DINOPANEL_E2E_DOCKER=1 and a live Docker socket.
 * CI skips this by default.
 */
test.skip(!process.env.DINOPANEL_E2E_DOCKER, 'requires DINOPANEL_E2E_DOCKER=1 + live docker socket');

// ---------------------------------------------------------------------------
// Container lifecycle helpers
// ---------------------------------------------------------------------------

const CONTAINER_NAME = `dinopanel-e2e-${Date.now()}`;

async function createTestContainer(): Promise<string> {
  // Pull alpine silently (no-op if already present)
  await exec('docker pull alpine:latest').catch(() => undefined);

  const { stdout } = await exec(
    `docker run -d --name ${CONTAINER_NAME} --label dinopanel.e2e=true alpine sleep 3600`,
  );
  return stdout.trim(); // full container id
}

async function removeTestContainer(): Promise<void> {
  await exec(`docker rm -f ${CONTAINER_NAME}`).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Navigate to /containers and search the table for a row whose name cell
 * contains `name`. Returns the row locator.
 */
async function findRowByName(page: import('@playwright/test').Page, name: string) {
  // Reload the list page so the newly created container appears
  await page.goto('/containers');
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 20_000 });

  // Filter rows by any cell text matching the container name
  const row = page.locator('table tbody tr').filter({ hasText: name });
  await expect(row).toBeVisible({ timeout: 10_000 });
  return row;
}

/**
 * Wait for a row's state badge to reflect the given Docker state.
 * The state badge text is i18n translated. Instead of matching the translated
 * text, we poll the Docker API directly via exec to check actual container state,
 * AND wait for the row's first <td> to change (indicating a re-render after poll).
 *
 * For simplicity we wait for the row's badge text to NOT contain the previous state,
 * but since we don't know the translation, we rely on Docker CLI polling + page reload.
 */
async function waitForState(
  page: import('@playwright/test').Page,
  name: string,
  expectedDockerState: 'running' | 'exited',
  timeout = 30_000,
) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const { stdout } = await exec(
      `docker inspect --format '{{.State.Status}}' ${name}`,
    ).catch(() => ({ stdout: 'unknown' }));
    if (stdout.trim() === expectedDockerState) {
      // State confirmed via Docker CLI — now wait for the UI to reflect it.
      // The UI auto-refreshes every 10 s; trigger a manual reload to be faster.
      await page.reload();
      await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10_000 });
      return;
    }
    await new Promise((r) => setTimeout(r, 1_500));
  }
  throw new Error(
    `Container ${name} did not reach state '${expectedDockerState}' within ${timeout}ms`,
  );
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe('containers start / stop', () => {
  let containerId: string;

  // docker pull + run may take up to 60 s on a cold image cache
  test.beforeAll(async () => {
    containerId = await createTestContainer();
  }, 60_000);

  test.afterAll(async () => {
    await removeTestContainer();
  });

  test('can stop a running container and start it again via the list page', async ({ page }) => {
    // ---- Step 1: navigate to list and find the test container row ----
    let row = await findRowByName(page, CONTAINER_NAME);

    // Hover the row to reveal action buttons (opacity-0 until hover)
    await row.hover();

    // ---- Step 2: click Stop button ----
    // When the container is running, RowActions renders:
    //   [0] Pause  [1] Stop  [2] Restart  [3] Remove
    // All wrapped in a flex div inside the last <td>.
    // The action buttons div is the last cell's content.
    const actionBtns = row.locator('td').last().locator('button');
    // Stop is at index 1 when running (Pause=0, Stop=1, Restart=2, Remove=3)
    const stopBtn = actionBtns.nth(1);
    await expect(stopBtn).toBeVisible({ timeout: 5_000 });
    await stopBtn.click();

    // ---- Step 3: poll Docker until state = exited, then reload UI ----
    await waitForState(page, CONTAINER_NAME, 'exited', 30_000);

    // ---- Step 4: find row again after page reload and click Start ----
    row = await findRowByName(page, CONTAINER_NAME);
    await row.hover();

    // When exited: [0] Start  [1] Remove
    const startBtn = row.locator('td').last().locator('button').first();
    await expect(startBtn).toBeVisible({ timeout: 5_000 });
    await startBtn.click();

    // ---- Step 5: poll Docker until state = running ----
    await waitForState(page, CONTAINER_NAME, 'running', 30_000);

    // Final sanity check via Docker CLI
    const { stdout } = await exec(`docker inspect --format '{{.State.Status}}' ${CONTAINER_NAME}`);
    expect(stdout.trim()).toBe('running');
  });
});
