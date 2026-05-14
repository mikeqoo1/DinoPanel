import { chromium, type FullConfig } from '@playwright/test';
import { spawn, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const STORAGE_STATE_PATH = path.join(__dirname, '.auth-state.json');

const SERVER_ENV = {
  NODE_ENV: 'production',
  PORT: '9999',
  HOST: '127.0.0.1',
  JWT_SECRET: 'dev-secret-do-not-use-in-production-32chars-minimum-length-required',
  DATA_DIR: './data',
  WEB_DIST: '../../apps/web/dist',
  LOG_LEVEL: 'warn',
};

async function waitForServer(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

/**
 * Returns true only when 9999 is running AND serving the production SPA
 * (i.e. index.html references hashed assets from /assets/).
 */
async function isProdSpaRunning(): Promise<boolean> {
  try {
    const [healthRes, rootRes] = await Promise.all([
      fetch('http://localhost:9999/api/health'),
      fetch('http://localhost:9999/'),
    ]);
    if (!healthRes.ok) return false;
    const html = await rootRes.text();
    // Production build serves hashed JS bundles under /assets/
    return html.includes('src="/assets/');
  } catch {
    return false;
  }
}

async function ensureProdServer(): Promise<void> {
  if (await isProdSpaRunning()) {
    console.log('[globalSetup] Prod server with SPA already running on :9999');
    return;
  }

  // Kill whatever is on 9999 (could be dev server without SPA)
  try {
    execSync('fuser -k 9999/tcp', { stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 1500));
  } catch {
    // nothing was listening, that's fine
  }

  const serverDir = path.join(__dirname, '..', 'apps', 'server');
  const mainJs = path.join(serverDir, 'dist', 'main.js');
  const webDist = path.join(__dirname, '..', 'apps', 'web', 'dist');

  if (!existsSync(mainJs)) {
    throw new Error(
      `Server dist not found at ${mainJs}.\nRun: pnpm --filter @dinopanel/server build`,
    );
  }
  if (!existsSync(webDist)) {
    throw new Error(
      `Web dist not found at ${webDist}.\nRun: pnpm --filter @dinopanel/web build`,
    );
  }

  console.log('[globalSetup] Starting prod server on :9999 …');
  const child = spawn('node', [mainJs], {
    cwd: serverDir,
    env: { ...process.env, ...SERVER_ENV },
    stdio: 'ignore',
    detached: false,
  });
  child.unref();

  await waitForServer('http://localhost:9999/api/health');
  console.log('[globalSetup] Prod server ready');
}

async function globalSetup(_config: FullConfig) {
  await ensureProdServer();

  // Perform login via browser UI and save storage state for other tests to reuse
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: 'http://localhost:9999' });
  const page = await context.newPage();

  await page.goto('/login');
  await page.waitForLoadState('networkidle');

  await page.locator('#username').fill('admin');
  await page.locator('#password').fill('DinoTest1234');
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL('/');

  await context.storageState({ path: STORAGE_STATE_PATH });
  await browser.close();
}

export default globalSetup;
export { STORAGE_STATE_PATH };
