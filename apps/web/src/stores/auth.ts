import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthUser } from '@dinopanel/shared';
import { api, getStoredTokens, setStoredTokens } from '@/lib/api';

interface AuthState {
  user: AuthUser | null;
  hydrated: boolean;
  setUser: (user: AuthUser | null) => void;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<AuthUser | null>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      hydrated: false,
      setUser: (user) => set({ user }),

      login: async (username, password) => {
        const { data } = await api.post('/auth/login', { username, password });
        setStoredTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
        set({ user: data.user });
      },

      logout: async () => {
        const tokens = getStoredTokens();
        if (tokens?.refreshToken) {
          try {
            await api.post('/auth/logout', { refreshToken: tokens.refreshToken });
          } catch {
            // ignore
          }
        }
        setStoredTokens(null);
        set({ user: null });
      },

      refreshMe: async () => {
        const tokens = getStoredTokens();
        if (!tokens?.accessToken) {
          set({ user: null });
          return null;
        }
        try {
          const { data } = await api.get('/auth/me');
          set({ user: data });
          return data;
        } catch {
          set({ user: null });
          setStoredTokens(null);
          return null;
        }
      },
    }),
    {
      name: 'dinopanel.user',
      partialize: (state) => ({ user: state.user }),
      onRehydrateStorage: () => (state) => {
        state?.refreshMe().finally(() => {
          useAuthStore.setState({ hydrated: true });
        });
      },
    },
  ),
);
