import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import * as schema from '../../../database/schema';
import { settings } from '../../../database/schema';
import { AcmeOrchestratorService } from '../acme-orchestrator.service';

// Phase 4.3 — ACME_EMAIL env-first + settings fallback.
// Drives getEmail() directly; the orchestrator's other deps don't
// participate in this path so we feed minimal stubs.

function setupDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
  `);
  return drizzle(sqlite, { schema });
}

function makeOrchestrator(envEmail: string): AcmeOrchestratorService {
  const db = setupDb();
  const config = {
    get: () => ({
      env: {
        ACME_DIRECTORY_URL: 'https://acme.example/',
        ACME_EMAIL: envEmail,
      },
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  const logger = {
    debug: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  // The 5 service deps after `accounts` aren't touched by getEmail().
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stub = {} as any;
  return new AcmeOrchestratorService(
    db,
    config,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    logger,
  );
}

describe('AcmeOrchestratorService.getEmail', () => {
  it('env wins over settings', async () => {
    const orch = makeOrchestrator('env@example.com');
    // Write a settings value too — env should still win.
    const db = (orch as unknown as { db: ReturnType<typeof setupDb> }).db;
    await db
      .insert(settings)
      .values({ key: 'acme.email', value: 'settings@example.com', updatedAt: 0 });
    expect(await orch.getEmail()).toBe('env@example.com');
  });

  it('falls back to settings when env is empty', async () => {
    const orch = makeOrchestrator('');
    const db = (orch as unknown as { db: ReturnType<typeof setupDb> }).db;
    await db
      .insert(settings)
      .values({ key: 'acme.email', value: 'me@example.com', updatedAt: 0 });
    expect(await orch.getEmail()).toBe('me@example.com');
  });

  it('throws ACME_EMAIL_MISSING when neither env nor settings is set', async () => {
    const orch = makeOrchestrator('');
    await expect(orch.getEmail()).rejects.toMatchObject({
      response: { code: 'ACME_EMAIL_MISSING' },
    });
  });

  it('trims whitespace and treats whitespace-only env as unset', async () => {
    const orch = makeOrchestrator('   ');
    const db = (orch as unknown as { db: ReturnType<typeof setupDb> }).db;
    await db
      .insert(settings)
      .values({ key: 'acme.email', value: '  ops@example.com  ', updatedAt: 0 });
    expect(await orch.getEmail()).toBe('ops@example.com');
    // Verify env value not used.
    await db.delete(settings).where(eq(settings.key, 'acme.email'));
    await expect(orch.getEmail()).rejects.toMatchObject({
      response: { code: 'ACME_EMAIL_MISSING' },
    });
  });
});
