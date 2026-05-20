import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  CreateDbInstance,
  DbInstanceResponse,
  DbMetricsSummary,
  DbReconcileResponse,
  PatchDbInstance,
  RemoveDbInstance,
} from '@dinopanel/shared';
import { api } from '@/lib/api';

export const databaseKeys = {
  all: ['databases'] as const,
  list: () => [...databaseKeys.all, 'list'] as const,
  detail: (id: number) => [...databaseKeys.all, 'detail', id] as const,
  metrics: (id: number) => [...databaseKeys.all, 'metrics', id] as const,
  status: () => [...databaseKeys.all, 'status'] as const,
};

export interface DatabasesStatusResponse {
  degraded: boolean;
  reason: string | null;
}

export function useDatabases() {
  return useQuery<DbInstanceResponse[]>({
    queryKey: databaseKeys.list(),
    queryFn: async () => (await api.get<DbInstanceResponse[]>('/databases')).data,
    retry: 0,
  });
}

export function useDatabasesStatus() {
  return useQuery<DatabasesStatusResponse>({
    queryKey: databaseKeys.status(),
    queryFn: async () =>
      (await api.get<DatabasesStatusResponse>('/databases/status')).data,
    retry: 0,
  });
}

export function useDbMetrics(id: number, enabled = true) {
  return useQuery<DbMetricsSummary>({
    queryKey: databaseKeys.metrics(id),
    queryFn: async () =>
      (await api.get<DbMetricsSummary>(`/databases/${id}/metrics`)).data,
    enabled,
    // PMM cache TTL is 30s server-side; refetch every minute so the
    // drawer numbers stay roughly fresh without hammering the API.
    refetchInterval: 60_000,
    retry: 0,
  });
}

export function useCreateDatabase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateDbInstance) =>
      (await api.post<DbInstanceResponse>('/databases', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: databaseKeys.list() }),
  });
}

export function usePatchDatabase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: number; body: PatchDbInstance }) =>
      (await api.patch<DbInstanceResponse>(`/databases/${args.id}`, args.body))
        .data,
    onSuccess: (_data, args) => {
      qc.invalidateQueries({ queryKey: databaseKeys.list() });
      qc.invalidateQueries({ queryKey: databaseKeys.detail(args.id) });
    },
  });
}

export function useDeleteDatabase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: number; body: RemoveDbInstance }) =>
      api.delete(`/databases/${args.id}`, { data: args.body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: databaseKeys.list() }),
  });
}

export function useStartDatabase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => api.post(`/databases/${id}/start`),
    onSuccess: () => qc.invalidateQueries({ queryKey: databaseKeys.list() }),
  });
}

export function useStopDatabase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => api.post(`/databases/${id}/stop`),
    onSuccess: () => qc.invalidateQueries({ queryKey: databaseKeys.list() }),
  });
}

export function useRestartDatabase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => api.post(`/databases/${id}/restart`),
    onSuccess: () => qc.invalidateQueries({ queryKey: databaseKeys.list() }),
  });
}

export function useRotatePassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) =>
      (await api.post<DbInstanceResponse>(`/databases/${id}/rotate-password`))
        .data,
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: databaseKeys.list() });
      qc.invalidateQueries({ queryKey: databaseKeys.metrics(id) });
    },
  });
}

export function useReconcileDatabases() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (await api.post<DbReconcileResponse>('/databases/reconcile')).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: databaseKeys.list() }),
  });
}
