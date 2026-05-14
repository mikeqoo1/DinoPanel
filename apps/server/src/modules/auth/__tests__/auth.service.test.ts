import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import type { User } from '../../../database/schema';

// ---------------------------------------------------------------------------
// Mocks for heavy deps — declared before service import
// ---------------------------------------------------------------------------

// We build the mock objects first, then reference them in the factory
const mockJwt = {
  signAsync: vi.fn(),
  verifyAsync: vi.fn(),
};

const mockUsers = {
  findByUsername: vi.fn(),
  findById: vi.fn(),
  verifyPassword: vi.fn(),
};

const mockConfig = {
  get: vi.fn().mockReturnValue({
    env: {
      JWT_SECRET: 'test-secret',
      JWT_ACCESS_TTL: '15m',
      JWT_REFRESH_TTL: '7d',
    },
  }),
};

// Chainable Drizzle query builder mock
const mockDbDeleteWhere = vi.fn().mockResolvedValue(undefined);
const mockDbDeleteInstance = { where: vi.fn(() => mockDbDeleteWhere()) };
const mockDbInsertValues = vi.fn().mockResolvedValue(undefined);
const mockDbInsertInstance = { values: vi.fn(() => mockDbInsertValues()) };
const mockSessionsQuery = { findFirst: vi.fn() };

const mockDb = {
  query: { sessions: mockSessionsQuery },
  delete: vi.fn(() => mockDbDeleteInstance),
  insert: vi.fn(() => mockDbInsertInstance),
};

// Mock nestjs-pino Logger
const mockLogger = {
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

vi.mock('nestjs-pino', () => ({
  Logger: vi.fn().mockImplementation(() => mockLogger),
  InjectPinoLogger: () => () => {},
}));

import { AuthService } from '../auth.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FAKE_USER: User = {
  id: 1,
  username: 'admin',
  passwordHash: '$2a$12$hashedpassword',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

function makeService(): AuthService {
  return new AuthService(
    mockDb as never,
    mockUsers as never,
    mockJwt as never,
    mockConfig as never,
    mockLogger as never,
  );
}

// Helper: set up JWT sign to return predictable tokens
function setupJwtSign() {
  mockJwt.signAsync
    .mockResolvedValueOnce('access-token-abc')
    .mockResolvedValueOnce('refresh-token-xyz');
}

// ---------------------------------------------------------------------------
// login — cases 1-3
// ---------------------------------------------------------------------------

describe('AuthService.login', () => {
  let svc: AuthService;

  beforeEach(() => {
    svc = makeService();
    vi.clearAllMocks();
    // Re-apply config mock after clearAllMocks
    mockConfig.get.mockReturnValue({
      env: {
        JWT_SECRET: 'test-secret',
        JWT_ACCESS_TTL: '15m',
        JWT_REFRESH_TTL: '7d',
      },
    });
    // insert().values() chain
    mockDbInsertInstance.values.mockReturnValue(mockDbInsertValues());
    mockDb.insert.mockReturnValue(mockDbInsertInstance);
    // delete().where() chain — used for cleanup in issueTokens
    mockDbDeleteInstance.where.mockReturnValue(Promise.resolve(undefined));
    mockDb.delete.mockReturnValue(mockDbDeleteInstance);
  });

  // case 1 — correct credentials → returns access + refresh token pair
  it('1: returns token pair and user object for valid credentials', async () => {
    mockUsers.findByUsername.mockResolvedValue(FAKE_USER);
    mockUsers.verifyPassword.mockResolvedValue(true);
    setupJwtSign();

    const result = await svc.login('admin', 'correct-pass');

    expect(result.tokens.accessToken).toBe('access-token-abc');
    expect(result.tokens.refreshToken).toBe('refresh-token-xyz');
    expect(result.user).toMatchObject({ id: 1, username: 'admin' });
    expect(mockJwt.signAsync).toHaveBeenCalledTimes(2);
  });

  // case 2 — wrong password → throws UnauthorizedException with generic message
  it('2: throws UnauthorizedException for wrong password', async () => {
    mockUsers.findByUsername.mockResolvedValue(FAKE_USER);
    mockUsers.verifyPassword.mockResolvedValue(false);

    await expect(svc.login('admin', 'wrong-pass')).rejects.toThrow(UnauthorizedException);
    await expect(svc.login('admin', 'wrong-pass')).rejects.toMatchObject({
      message: 'Invalid credentials',
    });
  });

  // case 3 — non-existent user → same UnauthorizedException message as wrong password
  // (prevents user enumeration: attacker cannot distinguish "no such user" from "bad password")
  it('3: throws same UnauthorizedException for unknown username (anti-enumeration)', async () => {
    mockUsers.findByUsername.mockResolvedValue(undefined);

    await expect(svc.login('ghost', 'any-pass')).rejects.toThrow(UnauthorizedException);
    await expect(svc.login('ghost', 'any-pass')).rejects.toMatchObject({
      message: 'Invalid credentials',
    });
  });
});

// ---------------------------------------------------------------------------
// refresh — cases 4-5
// ---------------------------------------------------------------------------

describe('AuthService.refresh', () => {
  let svc: AuthService;

  beforeEach(() => {
    svc = makeService();
    vi.clearAllMocks();
    mockConfig.get.mockReturnValue({
      env: {
        JWT_SECRET: 'test-secret',
        JWT_ACCESS_TTL: '15m',
        JWT_REFRESH_TTL: '7d',
      },
    });
    mockDb.insert.mockReturnValue(mockDbInsertInstance);
    mockDbInsertInstance.values.mockReturnValue(Promise.resolve(undefined));
    mockDb.delete.mockReturnValue(mockDbDeleteInstance);
    mockDbDeleteInstance.where.mockReturnValue(Promise.resolve(undefined));
  });

  // case 4 — valid refresh token → rotates session and returns new token pair
  it('4: returns new token pair for a valid refresh token', async () => {
    const jti = 'session-jti-abc123';
    const futureExpiry = Date.now() + 7 * 86_400_000;

    mockJwt.verifyAsync.mockResolvedValue({ sub: 1, jti });
    mockSessionsQuery.findFirst.mockResolvedValue({
      id: jti,
      userId: 1,
      expiresAt: futureExpiry,
    });
    mockUsers.findById.mockResolvedValue(FAKE_USER);
    setupJwtSign();

    const tokens = await svc.refresh('valid-refresh-token');

    expect(tokens.accessToken).toBe('access-token-abc');
    expect(tokens.refreshToken).toBe('refresh-token-xyz');
    // old session must be deleted (rotation)
    expect(mockDb.delete).toHaveBeenCalled();
  });

  // case 5a — expired refresh token: session exists but expiresAt is in the past
  it('5a: throws UnauthorizedException when session is expired', async () => {
    const jti = 'expired-jti';
    const pastExpiry = Date.now() - 1000;

    mockJwt.verifyAsync.mockResolvedValue({ sub: 1, jti });
    mockSessionsQuery.findFirst.mockResolvedValue({
      id: jti,
      userId: 1,
      expiresAt: pastExpiry,
    });

    await expect(svc.refresh('expired-refresh-token')).rejects.toThrow(UnauthorizedException);
    await expect(svc.refresh('expired-refresh-token')).rejects.toMatchObject({
      message: 'Session expired or revoked',
    });
  });

  // case 5b — forged / invalid JWT signature → jwt.verifyAsync throws, service re-throws
  it('5b: throws UnauthorizedException for a forged/invalid refresh token', async () => {
    mockJwt.verifyAsync.mockRejectedValue(new Error('invalid signature'));

    await expect(svc.refresh('forged-token')).rejects.toThrow(UnauthorizedException);
    await expect(svc.refresh('forged-token')).rejects.toMatchObject({
      message: 'Invalid refresh token',
    });
  });

  // case 5c — refresh token valid JWT but session not found (revoked)
  it('5c: throws UnauthorizedException when session has been revoked (not in DB)', async () => {
    mockJwt.verifyAsync.mockResolvedValue({ sub: 1, jti: 'revoked-jti' });
    mockSessionsQuery.findFirst.mockResolvedValue(undefined);

    await expect(svc.refresh('revoked-refresh-token')).rejects.toThrow(UnauthorizedException);
    await expect(svc.refresh('revoked-refresh-token')).rejects.toMatchObject({
      message: 'Session expired or revoked',
    });
  });
});
