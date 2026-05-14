import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';

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

export interface ApiErrorBody {
  code?: string;
  message?: string;
  statusCode?: number;
  error?: string;
  details?: unknown;
}

export function extractErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as ApiErrorBody | undefined;
    if (data) {
      if (typeof data.message === 'string') return data.message;
      if (data.code) return data.code;
    }
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Unknown error';
}
