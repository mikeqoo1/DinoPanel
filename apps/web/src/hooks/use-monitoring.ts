import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface PmmConfig {
  url: string | null;
}

export interface PmmStatus {
  ok: boolean;
  latencyMs: number | null;
  lastChecked: string;
}

const keys = {
  config: ['monitoring', 'pmm', 'config'] as const,
  status: ['monitoring', 'pmm', 'status'] as const,
};

export function usePmmConfig() {
  return useQuery<PmmConfig>({
    queryKey: keys.config,
    queryFn: async () => (await api.get<PmmConfig>('/monitoring/pmm/config')).data,
  });
}

export function useSetPmmConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (url: string | null) => {
      const res = await api.put<PmmConfig>('/monitoring/pmm/config', { url });
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.config });
      void qc.invalidateQueries({ queryKey: keys.status });
    },
  });
}

export function usePmmStatus(enabled: boolean) {
  return useQuery<PmmStatus>({
    queryKey: keys.status,
    queryFn: async () => (await api.get<PmmStatus>('/monitoring/pmm/status')).data,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    enabled,
  });
}
