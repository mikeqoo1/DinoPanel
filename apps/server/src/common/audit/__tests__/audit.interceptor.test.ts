import { describe, it, expect, vi, beforeEach } from 'vitest';
import { lastValueFrom, of, throwError } from 'rxjs';
import type { ExecutionContext, CallHandler } from '@nestjs/common';
import { AuditInterceptor, summarizeBody } from '../audit.interceptor';

// ---------------------------------------------------------------------------
// Drizzle insert chain mock — captures the row passed to .values()
// ---------------------------------------------------------------------------

const insertedRows: Array<Record<string, unknown>> = [];
const insertValues = vi.fn((row: Record<string, unknown>) => {
  insertedRows.push(row);
  return Promise.resolve();
});
const insertInstance = { values: insertValues };
const mockDb = {
  insert: vi.fn(() => insertInstance),
};

const loggerWarn = vi.fn();
const mockLogger = { warn: loggerWarn, debug: vi.fn(), info: vi.fn() };

function makeContext(
  req: Partial<{
    method: string;
    url: string;
    routeOptions?: { url?: string };
    body?: unknown;
    user?: { id: number; username: string };
    ip?: string;
    headers?: Record<string, string>;
  }>,
  reply: { statusCode?: number } = {},
): ExecutionContext {
  const fullReq = {
    method: 'POST',
    url: '/api/x',
    routeOptions: req.routeOptions ?? { url: req.url ?? '/api/x' },
    body: undefined,
    headers: {},
    ip: '127.0.0.1',
    ...req,
  };
  const fullReply = { statusCode: 200, ...reply };
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => fullReq,
      getResponse: () => fullReply,
    }),
  } as unknown as ExecutionContext;
}

function makeNext(value: unknown = { ok: true }): CallHandler {
  return { handle: () => of(value) };
}

function makeInterceptor(): AuditInterceptor {
  return new AuditInterceptor(mockDb as never, mockLogger as never);
}

beforeEach(() => {
  insertedRows.length = 0;
  insertValues.mockClear();
  mockDb.insert.mockClear();
  loggerWarn.mockClear();
});

// ---------------------------------------------------------------------------

describe('AuditInterceptor', () => {
  it('writes a row for non-GET requests under /api/*', async () => {
    const interceptor = makeInterceptor();
    const ctx = makeContext({ method: 'POST', url: '/api/users' });
    await lastValueFrom(interceptor.intercept(ctx, makeNext()));
    await Promise.resolve();
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toMatchObject({
      method: 'POST',
      path: '/api/users',
      statusCode: 200,
    });
  });

  it('does NOT write for GET requests', async () => {
    const interceptor = makeInterceptor();
    const ctx = makeContext({ method: 'GET', url: '/api/users' });
    await lastValueFrom(interceptor.intercept(ctx, makeNext()));
    expect(insertedRows).toHaveLength(0);
  });

  it('skips /api/auth/* even on non-GET', async () => {
    const interceptor = makeInterceptor();
    const ctx = makeContext({ method: 'POST', url: '/api/auth/login' });
    await lastValueFrom(interceptor.intercept(ctx, makeNext()));
    expect(insertedRows).toHaveLength(0);
  });

  it('redacts every SENSITIVE_BODY_FIELDS entry in bodySummary', async () => {
    const interceptor = makeInterceptor();
    const ctx = makeContext({
      method: 'POST',
      url: '/api/auth/password',
      body: {
        password: 'secret',
        oldPassword: 'old',
        newPassword: 'new',
        refreshToken: 'tok',
        username: 'mike',
      },
    });
    // Use a non-auth path so the interceptor actually runs:
    const ctx2 = makeContext({
      method: 'POST',
      url: '/api/users/change-password',
      body: {
        password: 'secret',
        oldPassword: 'old',
        newPassword: 'new',
        refreshToken: 'tok',
        username: 'mike',
      },
    });
    await lastValueFrom(interceptor.intercept(ctx2, makeNext()));
    await Promise.resolve();
    const summary = insertedRows[0]?.bodySummary as string;
    expect(summary).toContain('[redacted]');
    expect(summary).not.toContain('"secret"');
    expect(summary).not.toContain('"old"');
    expect(summary).not.toContain('"new"');
    expect(summary).not.toContain('"tok"');
    expect(summary).toContain('"username":"mike"');
    expect(ctx).toBeDefined();
  });

  it('uses request.routeOptions.url for path, falling back to url when undefined', async () => {
    const interceptor = makeInterceptor();
    // Case A: routeOptions.url set (template)
    const ctxA = makeContext({
      method: 'POST',
      url: '/api/containers/abc123/stop',
      routeOptions: { url: '/api/containers/:id/stop' },
    });
    await lastValueFrom(interceptor.intercept(ctxA, makeNext()));
    await Promise.resolve();
    expect(insertedRows[0]?.path).toBe('/api/containers/:id/stop');

    insertedRows.length = 0;

    // Case B: routeOptions.url undefined → fallback to req.url
    const ctxB = makeContext({
      method: 'POST',
      url: '/api/whatever',
      routeOptions: { url: undefined },
    });
    await lastValueFrom(interceptor.intercept(ctxB, makeNext()));
    await Promise.resolve();
    expect(insertedRows[0]?.path).toBe('/api/whatever');
  });

  it('caps bodySummary at 1 KB and marks with [truncated]', () => {
    const big = { huge: 'x'.repeat(5000) };
    const out = summarizeBody(big);
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(1024);
    expect(out!.endsWith('[truncated]')).toBe(true);
  });

  it('does not fail the response when audit write throws', async () => {
    mockDb.insert.mockImplementationOnce(() => {
      throw new Error('db down');
    });
    const interceptor = makeInterceptor();
    const ctx = makeContext({ method: 'POST', url: '/api/users' });
    const value = await lastValueFrom(interceptor.intercept(ctx, makeNext('handler-result')));
    expect(value).toBe('handler-result');
    expect(loggerWarn).toHaveBeenCalled();
  });

  it('still writes an audit row on handler errors with the error status', async () => {
    const interceptor = makeInterceptor();
    const ctx = makeContext({ method: 'POST', url: '/api/users' });
    const failingNext: CallHandler = {
      handle: () => throwError(() => ({ status: 403, message: 'forbidden' })),
    };
    await expect(lastValueFrom(interceptor.intercept(ctx, failingNext))).rejects.toBeDefined();
    await Promise.resolve();
    expect(insertedRows[0]?.statusCode).toBe(403);
  });
});
