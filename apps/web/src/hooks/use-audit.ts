import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export const auditKeys = {
  retention: ['audit', 'retention'] as const,
};

export function useAuditRetention() {
  return useQuery<{ days: number }>({
    queryKey: auditKeys.retention,
    queryFn: async () => (await api.get<{ days: number }>('/audit/retention')).data,
  });
}

export function useSetAuditRetention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (days: number) =>
      (await api.put<{ days: number }>('/audit/retention', { days })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: auditKeys.retention }),
  });
}
