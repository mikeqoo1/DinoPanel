import { describe, it, expect } from 'vitest';
import axios from 'axios';
import { extractErrorMessage } from '../lib/api';

/**
 * Build a minimal fake AxiosError. We don't import AxiosError class directly
 * because axios.isAxiosError() checks the `isAxiosError` boolean flag rather
 * than instanceof, so we can construct a plain object that passes the guard.
 */
function makeAxiosError(opts: {
  message?: string;
  responseData?: unknown;
  status?: number;
}): unknown {
  const err: Record<string, unknown> = {
    isAxiosError: true,
    message: opts.message ?? 'Request failed',
  };
  if (opts.responseData !== undefined) {
    err['response'] = {
      status: opts.status ?? 400,
      data: opts.responseData,
    };
  }
  return err;
}

describe('extractErrorMessage', () => {
  // Case 1 — New backend format: { code, message } → return message
  it('returns message from ApiErrorResponse shape', () => {
    const err = makeAxiosError({
      responseData: { code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid credentials' },
    });
    expect(extractErrorMessage(err)).toBe('Invalid credentials');
  });

  // Case 2 — New backend format + Zod-style details array → format path + message
  it('formats Zod-style details from ApiErrorResponse', () => {
    const err = makeAxiosError({
      responseData: {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        details: [
          { path: 'username', message: 'required' },
          { path: ['address', 'city'], message: 'too short' },
        ],
      },
    });
    expect(extractErrorMessage(err)).toBe("field 'username': required; field 'address.city': too short");
  });

  // Case 3 — NestJS class-validator message array → join with '; '
  it('joins NestJS class-validator message string array', () => {
    const err = makeAxiosError({
      responseData: {
        statusCode: 400,
        message: ['username must not be empty', 'password is too short'],
        error: 'Bad Request',
      },
    });
    expect(extractErrorMessage(err)).toBe('username must not be empty; password is too short');
  });

  // Case 4 — NestJS default: { message: string } without code field
  it('returns message string from plain NestJS response shape', () => {
    const err = makeAxiosError({
      responseData: { statusCode: 404, message: 'Not Found', error: 'Not Found' },
    });
    expect(extractErrorMessage(err)).toBe('Not Found');
  });

  // Case 5 — AxiosError with no response (network / CORS)
  it('returns axios message when no response is present', () => {
    const err = makeAxiosError({ message: 'Network Error' });
    expect(extractErrorMessage(err)).toBe('Network Error');
  });

  // Case 6 — AxiosError with no response and empty message → fallback 'Network error'
  it('falls back to Network error when axios message is empty', () => {
    const err = makeAxiosError({ message: '' });
    expect(extractErrorMessage(err)).toBe('Network error');
  });

  // Case 7 — Plain Error instance
  it('returns error.message for a plain Error', () => {
    expect(extractErrorMessage(new Error('something went wrong'))).toBe('something went wrong');
  });

  // Case 8 — String thrown directly
  it('returns the string when a string is thrown', () => {
    expect(extractErrorMessage('oops')).toBe('oops');
  });

  // Case 9 — undefined
  it('returns Unknown error for undefined', () => {
    expect(extractErrorMessage(undefined)).toBe('Unknown error');
  });

  // Case 10 — null
  it('returns Unknown error for null', () => {
    expect(extractErrorMessage(null)).toBe('Unknown error');
  });

  // Case 11 — empty plain object {}
  it('returns Unknown error for a plain empty object', () => {
    expect(extractErrorMessage({})).toBe('Unknown error');
  });

  // Case 12 — ApiErrorResponse with empty details array → fall through to message
  it('returns message when details array is empty', () => {
    const err = makeAxiosError({
      responseData: { code: 'VALIDATION_FAILED', message: 'Validation failed', details: [] },
    });
    expect(extractErrorMessage(err)).toBe('Validation failed');
  });

  // Verify axios.isAxiosError still works with real axios errors
  it('handles a real axios cancel error', () => {
    const source = axios.CancelToken.source();
    source.cancel('request cancelled');
    const cancelErr = new axios.Cancel('request cancelled');
    // Cancel is not an AxiosError so falls through to Error branch
    expect(extractErrorMessage(cancelErr)).toBe('request cancelled');
  });
});
