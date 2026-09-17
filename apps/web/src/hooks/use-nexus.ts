import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  CreateNexusInstanceInput,
  NexusInstance,
  NexusMetrics,
  NexusRange,
  NexusRepository,
  NexusSeries,
  UpdateNexusLimits,
} from '@dinopanel/shared';
import { api } from '@/lib/api';

export const nexusKeys = {
  all: ['nexus'] as const,
  list: () => [...nexusKeys.all, 'list'] as const,
  series: (id: string, range: NexusRange) => [...nexusKeys.all, 'series', id, range] as const,
  repositories: (id: string) => [...nexusKeys.all, 'repositories', id] as const,
};

export function useNexusInstances() {
  return useQuery<NexusInstance[]>({
    queryKey: nexusKeys.list(),
    queryFn: async () => (await api.get<NexusInstance[]>('/nexus')).data,
    retry: false,
  });
}

export function useAddNexusInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: CreateNexusInstanceInput) =>
      (await api.post<NexusInstance[]>('/nexus', vars)).data,
    onSuccess: (data) => qc.setQueryData(nexusKeys.list(), data),
  });
}

export function useRemoveNexusInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/nexus/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: nexusKeys.list() }),
  });
}

export function useUpdateNexusLimits() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: string } & UpdateNexusLimits) =>
      (await api.patch<NexusInstance>(`/nexus/${vars.id}/limits`, {
        requestsPerDayLimit: vars.requestsPerDayLimit,
        componentsLimit: vars.componentsLimit,
      })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: nexusKeys.list() }),
  });
}

export function useTestNexusInstance() {
  return useMutation({
    mutationFn: async (id: string) => (await api.post<NexusMetrics>(`/nexus/${id}/test`)).data,
  });
}

/** The server samples every 60s, so polling faster than that only re-reads the same rows. */
export function useNexusSeries(id: string, range: NexusRange) {
  return useQuery<NexusSeries>({
    queryKey: nexusKeys.series(id, range),
    queryFn: async () => (await api.get<NexusSeries>(`/nexus/${id}/series?range=${range}`)).data,
    enabled: !!id,
    refetchInterval: 60_000,
    retry: false,
  });
}

export function useNexusRepositories(id: string) {
  return useQuery<NexusRepository[]>({
    queryKey: nexusKeys.repositories(id),
    queryFn: async () => (await api.get<NexusRepository[]>(`/nexus/${id}/repositories`)).data,
    enabled: !!id,
    staleTime: 300_000,
    retry: false,
  });
}
