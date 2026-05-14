import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { ApiExceptionFilter } from '../api-exception.filter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReply() {
  const reply = {
    _status: 0,
    _body: undefined as unknown,
    status(code: number) {
      this._status = code;
      return this;
    },
    send(body: unknown) {
      this._body = body;
      return this;
    },
  };
  return reply;
}

function makeHost(reply: ReturnType<typeof makeReply>): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getResponse: () => reply,
      getRequest: () => ({}),
      getNext: () => ({}),
    }),
    getArgs: () => [],
    getArgByIndex: () => undefined,
    switchToRpc: () => ({ getData: () => ({}), getContext: () => ({}) }),
    switchToWs: () => ({ getData: () => ({}), getClient: () => ({}) }),
    getType: () => 'http' as const,
  } as unknown as ArgumentsHost;
}

function makeFilter() {
  const logger = { error: vi.fn() };
  const filter = new ApiExceptionFilter(logger);
  return { filter, logger };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ApiExceptionFilter', () => {
  let reply: ReturnType<typeof makeReply>;
  let host: ArgumentsHost;

  beforeEach(() => {
    reply = makeReply();
    host = makeHost(reply);
  });

  it('handles HttpException and maps status code to code string', () => {
    const { filter } = makeFilter();
    filter.catch(new HttpException('Not Found', HttpStatus.NOT_FOUND), host);

    expect(reply._status).toBe(404);
    expect(reply._body).toMatchObject({ code: 'NOT_FOUND', message: 'Not Found' });
  });

  it('handles unknown Error as 500 without leaking stack to client', () => {
    const { filter, logger } = makeFilter();
    const err = new Error('db connection refused — secret details here');

    filter.catch(err, host);

    expect(reply._status).toBe(500);
    expect(reply._body).toMatchObject({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
    // stack must NOT appear in the response body
    const bodyStr = JSON.stringify(reply._body);
    expect(bodyStr).not.toContain('secret details');
    expect(bodyStr).not.toContain('stack');
    // but it must be logged
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it('respects custom code from controller (ZodValidationPipe shape)', () => {
    const { filter } = makeFilter();
    const exception = new HttpException(
      { code: 'FILE_NOT_FOUND', message: 'Path does not exist', details: { path: '/etc/ghost' } },
      HttpStatus.NOT_FOUND,
    );

    filter.catch(exception, host);

    expect(reply._status).toBe(404);
    expect(reply._body).toMatchObject({
      code: 'FILE_NOT_FOUND',
      message: 'Path does not exist',
      details: { path: '/etc/ghost' },
    });
  });

  it('flattens class-validator message array into details.errors', () => {
    const { filter } = makeFilter();
    const messages = ['name must be a string', 'email must be an email'];
    // NestJS ValidationPipe sends { statusCode, message: string[], error }
    const exception = new HttpException(
      { statusCode: 400, message: messages, error: 'Bad Request' },
      HttpStatus.BAD_REQUEST,
    );

    filter.catch(exception, host);

    expect(reply._status).toBe(400);
    expect(reply._body).toMatchObject({
      code: 'BAD_REQUEST',
      message: messages.join('; '),
      details: { errors: messages },
    });
  });
});
