import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  CreateDbInstance,
  DbInstanceResponse,
  DbInstanceRevealResponse,
  DbMetricsSummary,
  DbReconcileResponse,
  PatchDbInstance,
  PmmExternalServicesResponse,
  RemoveDbInstance,
  RevealDbPassword,
} from '@dinopanel/shared';
import { api } from '@/lib/api';

export const databaseKeys = {
  all: ['databases'] as const,
  list: () => [...databaseKeys.all, 'list'] as const,
  detail: (id: number) => [...databaseKeys.all, 'detail', id] as const,
  metrics: (id: number) => [...databaseKeys.all, 'metrics', id] as const,
  status: () => [...databaseKeys.all, 'status'] as const,
  externalPmm: () => [...databaseKeys.all, 'external-pmm'] as const,
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

export function useRevealPassword() {
  return useMutation({
    mutationFn: async (args: { id: number; body: RevealDbPassword }) =>
      (
        await api.post<DbInstanceRevealResponse>(
          `/databases/${args.id}/reveal-password`,
          args.body,
        )
      ).data,
    // gcTime=0 evicts the mutation's data from the React Query cache the
    // moment the dialog unmounts, so the plaintext password never
    // outlives the 30s reveal window in devtools / future code that
    // happens to inspect `mutation.data`.
    gcTime: 0,
  });
}

export function useExternalPmm(enabled = true) {
  return useQuery<PmmExternalServicesResponse>({
    queryKey: databaseKeys.externalPmm(),
    queryFn: async () =>
      (
        await api.get<PmmExternalServicesResponse>(
          '/databases/external-pmm',
        )
      ).data,
    enabled,
    retry: 0,
  });
}

export function useRefreshExternalPmm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (
        await api.get<PmmExternalServicesResponse>(
          '/databases/external-pmm?refresh=1',
        )
      ).data,
    onSuccess: (data) => {
      // Drop the cached query under the same key in favour of the
      // freshly-fetched payload so the UI updates immediately and
      // the next observer read returns the new snapshot without an
      // extra round-trip.
      qc.setQueryData(databaseKeys.externalPmm(), data);
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
