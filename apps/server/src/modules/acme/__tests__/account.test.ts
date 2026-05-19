import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../database/schema';
import { AcmeAccountService } from '../acme-account.service';
import type {
  AcmeClient,
  AcmeClientFactory,
  AcmeCrypto,
} from '../acme-client.factory';

const fakeLogger = {
  debug: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

function setupDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE acme_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      directory_url TEXT NOT NULL,
      email TEXT NOT NULL,
      key_pem TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE (directory_url, email)
    );
  `);
  return drizzle(sqlite, { schema });
}

function makeClient(): AcmeClient {
  return {
    createAccount: vi.fn().mockResolvedValue({ status: 'valid' }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function makeCrypto(): AcmeCrypto {
  return {
    createPrivateRsaKey: vi
      .fn()
      .mockResolvedValue(Buffer.from('-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----\n')),
    createCsr: vi.fn(),
    readCertificateInfo: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('AcmeAccountService', () => {
  let db: ReturnType<typeof setupDb>;
  let client: AcmeClient;
  let cryptoApi: AcmeCrypto;
  let factory: AcmeClientFactory;

  beforeEach(() => {
    db = setupDb();
    client = makeClient();
    cryptoApi = makeCrypto();
    factory = {
      createClient: vi.fn().mockReturnValue(client),
      crypto: vi.fn().mockReturnValue(cryptoApi),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  });

  it('throws ACME_EMAIL_NOT_SET when email is empty', async () => {
    const svc = new AcmeAccountService(db, factory, fakeLogger);
    await expect(svc.ensureAccount('https://acme.example/', '')).rejects.toMatchObject({
      response: { code: 'ACME_EMAIL_NOT_SET' },
    });
  });

  it('creates an account on first call and stores the key', async () => {
    const svc = new AcmeAccountService(db, factory, fakeLogger);
    const row = await svc.ensureAccount('https://acme.example/', 'me@example.com');
    expect(row.id).toBeGreaterThan(0);
    expect(row.email).toBe('me@example.com');
    expect(row.keyPem).toContain('BEGIN RSA PRIVATE KEY');
    expect(cryptoApi.createPrivateRsaKey).toHaveBeenCalledOnce();
    expect(client.createAccount).toHaveBeenCalledOnce();
  });

  it('returns the cached row on subsequent calls (no new key)', async () => {
    const svc = new AcmeAccountService(db, factory, fakeLogger);
    const first = await svc.ensureAccount('https://acme.example/', 'me@example.com');
    const second = await svc.ensureAccount('https://acme.example/', 'me@example.com');
    expect(second.id).toBe(first.id);
    expect(second.keyPem).toBe(first.keyPem);
    // RSA key creation happened ONCE despite the second call
    expect(cryptoApi.createPrivateRsaKey).toHaveBeenCalledOnce();
    expect(client.createAccount).toHaveBeenCalledOnce();
  });
});
