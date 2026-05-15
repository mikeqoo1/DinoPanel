import { useQuery } from '@tanstack/react-query';
import type { ProcessInfo } from '@dinopanel/shared';
import { api } from '@/lib/api';

export function useProcessInfo() {
  return useQuery<ProcessInfo>({
    queryKey: ['system', 'process-info'],
    queryFn: async () => (await api.get<ProcessInfo>('/system/process-info')).data,
    staleTime: Infinity,
  });
}
