import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Network } from '@dinopanel/shared';
import { api } from '@/lib/api';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const networkKeys = {
  all: ['networks'] as const,
  list: () => [...networkKeys.all, 'list'] as const,
  detail: (id: string) => [...networkKeys.all, 'detail', id] as const,
};

// ---------------------------------------------------------------------------
// REST hooks
// ---------------------------------------------------------------------------

/**
 * useNetworks — list all networks.
 */
export function useNetworks() {
  return useQuery<Network[]>({
    queryKey: networkKeys.list(),
    queryFn: async () => (await api.get<Network[]>('/networks')).data,
  });
}

/**
 * useNetwork — inspect a single network by id.
 */
export function useNetwork(id: string) {
  return useQuery<Network>({
    queryKey: networkKeys.detail(id),
    queryFn: async () => (await api.get<Network>(`/networks/${id}`)).data,
    enabled: !!id,
  });
}

// ---------------------------------------------------------------------------
// Network action mutations
// ---------------------------------------------------------------------------

export interface CreateNetworkOptions {
  name: string;
  driver?: string;
  internal?: boolean;
}

export interface ConnectOptions {
  networkId: string;
  containerId: string;
}

export interface DisconnectOptions {
  networkId: string;
  containerId: string;
}

/**
 * useNetworkActions — create / remove / connect / disconnect.
 */
export function useNetworkActions() {
  const qc = useQueryClient();

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: networkKeys.list() });
  };

  const createMut = useMutation({
    mutationFn: async (opts: CreateNetworkOptions) =>
      (await api.post<Network>('/networks', opts)).data,
    onSuccess: invalidate,
  });

  const removeMut = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/networks/${id}`);
    },
    onSuccess: invalidate,
  });

  const connectMut = useMutation({
    mutationFn: async ({ networkId, containerId }: ConnectOptions) => {
      await api.post(`/networks/${networkId}/connect`, { containerId });
    },
    onSuccess: invalidate,
  });

  const disconnectMut = useMutation({
    mutationFn: async ({ networkId, containerId }: DisconnectOptions) => {
      await api.post(`/networks/${networkId}/disconnect`, { containerId });
    },
    onSuccess: invalidate,
  });

  return {
    create: (opts: CreateNetworkOptions) => createMut.mutateAsync(opts),
    remove: (id: string) => removeMut.mutateAsync(id),
    connect: (opts: ConnectOptions) => connectMut.mutateAsync(opts),
    disconnect: (opts: DisconnectOptions) => disconnectMut.mutateAsync(opts),
    isCreating: createMut.isPending,
    isRemoving: removeMut.isPending,
  };
}
