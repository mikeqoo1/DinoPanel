import axios, { type InternalAxiosRequestConfig } from 'axios';
import type { AxiosError } from 'axios';
import type { ApiErrorResponse } from '@dinopanel/shared';

const TOKEN_STORAGE_KEY = 'dinopanel.tokens';

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

export function getStoredTokens(): StoredTokens | null {
  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredTokens) : null;
  } catch {
    return null;
  }
}

export function setStoredTokens(tokens: StoredTokens | null) {
  if (tokens) {
    localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens));
  } else {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

export const api = axios.create({
  baseURL: '/api',
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

let refreshPromise: Promise<StoredTokens> | null = null;

async function refresh(): Promise<StoredTokens> {
  if (refreshPromise) return refreshPromise;
  const current = getStoredTokens();
  if (!current?.refreshToken) throw new Error('No refresh token');

  refreshPromise = axios
    .post<StoredTokens>('/api/auth/refresh', { refreshToken: current.refreshToken })
    .then((r) => {
      setStoredTokens(r.data);
      return r.data;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const tokens = getStoredTokens();
  if (tokens?.accessToken) {
    config.headers.set('Authorization', `Bearer ${tokens.accessToken}`);
  }
  return config;
});

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retried?: boolean };
    if (
      error.response?.status === 401 &&
      original &&
      !original._retried &&
      !original.url?.includes('/auth/login') &&
      !original.url?.includes('/auth/refresh')
    ) {
      original._retried = true;
      try {
        const { accessToken } = await refresh();
        original.headers.set('Authorization', `Bearer ${accessToken}`);
        return api(original);
      } catch {
        setStoredTokens(null);
        // hard redirect to login so guards re-run cleanly
        if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
          window.location.href = '/login';
        }
      }
    }
    return Promise.reject(error);
  },
);

/** Type guard: checks if value is the unified ApiErrorResponse from the backend. */
function isApiErrorResponse(data: unknown): data is ApiErrorResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as Record<string, unknown>)['code'] === 'string' &&
    typeof (data as Record<string, unknown>)['message'] === 'string'
  );
}

/** Zod-style detail item as produced by ZodValidationPipe. */
interface ZodDetailItem {
  path?: string | string[];
  message?: string;
}

function formatZodDetails(details: unknown): string | null {
  if (!Array.isArray(details) || details.length === 0) return null;
  const items = details as ZodDetailItem[];
  const lines = items
    .map((item) => {
      const path = Array.isArray(item.path)
        ? item.path.join('.')
        : typeof item.path === 'string'
          ? item.path
          : '';
      const msg = item.message ?? '';
      return path ? `field '${path}': ${msg}` : msg;
    })
    .filter(Boolean);
  return lines.length > 0 ? lines.join('; ') : null;
}

/** Extract the backend error `code` from an AxiosError, or null if absent. */
export function getApiErrorCode(err: unknown): string | null {
  if (!axios.isAxiosError(err)) return null;
  const data: unknown = (err as AxiosError).response?.data;
  return isApiErrorResponse(data) ? data.code : null;
}

export function extractErrorMessage(err: unknown): string {
  // 1. AxiosError
  if (axios.isAxiosError(err)) {
    const axiosErr = err as AxiosError;
    const data: unknown = axiosErr.response?.data;

    if (data !== undefined && data !== null) {
      // 1a. New backend format: { code, message, details? }
      if (isApiErrorResponse(data)) {
        const zodFormatted = formatZodDetails(data.details);
        if (zodFormatted) return zodFormatted;
        return data.message;
      }

      // 1b. NestJS class-validator: { message: string[] }
      const dataObj = data as Record<string, unknown>;
      if (Array.isArray(dataObj['message'])) {
        const msgs = (dataObj['message'] as unknown[]).filter((m) => typeof m === 'string');
        if (msgs.length > 0) return (msgs as string[]).join('; ');
      }

      // 1c. NestJS default: { message: string }
      if (typeof dataObj['message'] === 'string') return dataObj['message'];
    }

    // 1d. No response (network/CORS error)
    return axiosErr.message || 'Network error';
  }

  // 2. Plain Error
  if (err instanceof Error) return err.message;

  // 3. String
  if (typeof err === 'string') return err;

  // 4. Unknown — best-effort stringify (treat null/undefined as unknown)
  if (err === null || err === undefined) return 'Unknown error';
  try {
    const s = String(err);
    return s !== '[object Object]' ? s : 'Unknown error';
  } catch {
    return 'Unknown error';
  }
}
