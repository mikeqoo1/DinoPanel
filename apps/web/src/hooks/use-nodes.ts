import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { RemoteNode, RemoteNodeMetrics, RemoteContainersResponse } from '@dinopanel/shared';
import { api } from '@/lib/api';

export const nodeKeys = {
  all: ['nodes'] as const,
  list: () => [...nodeKeys.all, 'list'] as const,
  metrics: (id: string) => [...nodeKeys.all, 'metrics', id] as const,
  containers: (id: string) => [...nodeKeys.all, 'containers', id] as const,
};

export function useNodes() {
  return useQuery<RemoteNode[]>({
    queryKey: nodeKeys.list(),
    queryFn: async () => (await api.get<RemoteNode[]>('/nodes')).data,
    retry: false,
  });
}

export function useAddNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { name: string; host: string; user: string; port?: number }) =>
      (await api.post<RemoteNode[]>('/nodes', vars)).data,
    onSuccess: (data) => {
      // setQueryData stores the fresh list returned by POST — no further
      // invalidation needed. Invalidating nodeKeys.all would also prefix-match
      // metrics/containers queries and trigger extra ssh sessions per action.
      qc.setQueryData(nodeKeys.list(), data);
    },
  });
}

export function useRemoveNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/nodes/${id}`);
    },
    // Narrow to list only — avoids triggering metrics/containers refetches on remove.
    onSuccess: () => qc.invalidateQueries({ queryKey: nodeKeys.list() }),
  });
}

export function useTestNode() {
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.post<{ ok: true; latencyMs: number }>(`/nodes/${id}/test`)).data,
  });
}

// refetchInterval: 10_000, retry: false — AC12
export function useNodeMetrics(id: string) {
  return useQuery<RemoteNodeMetrics>({
    queryKey: nodeKeys.metrics(id),
    queryFn: async () => (await api.get<RemoteNodeMetrics>(`/nodes/${id}/metrics`)).data,
    enabled: !!id,
    refetchInterval: 10_000,
    retry: false,
  });
}

// refetchInterval: 30_000, retry: false — AC12
export function useNodeContainers(id: string) {
  return useQuery<RemoteContainersResponse>({
    queryKey: nodeKeys.containers(id),
    queryFn: async () =>
      (await api.get<RemoteContainersResponse>(`/nodes/${id}/containers`)).data,
    enabled: !!id,
    refetchInterval: 30_000,
    retry: false,
  });
}
