import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Volume } from '@dinopanel/shared';
import { api } from '@/lib/api';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const volumeKeys = {
  all: ['volumes'] as const,
  list: () => [...volumeKeys.all, 'list'] as const,
  detail: (name: string) => [...volumeKeys.all, 'detail', name] as const,
};

// ---------------------------------------------------------------------------
// REST hooks
// ---------------------------------------------------------------------------

/**
 * useVolumes — list all volumes.
 */
export function useVolumes() {
  return useQuery<Volume[]>({
    queryKey: volumeKeys.list(),
    queryFn: async () => (await api.get<Volume[]>('/volumes')).data,
  });
}

/**
 * useVolume — inspect a single volume by name.
 */
export function useVolume(name: string) {
  return useQuery<Volume>({
    queryKey: volumeKeys.detail(name),
    queryFn: async () => (await api.get<Volume>(`/volumes/${name}`)).data,
    enabled: !!name,
  });
}

// ---------------------------------------------------------------------------
// Volume action mutations
// ---------------------------------------------------------------------------

export interface CreateVolumeOptions {
  name: string;
  driver?: string;
}

export interface PruneResult {
  volumesDeleted: string[];
  spaceReclaimed: number;
}

/**
 * useVolumeActions — create / remove / prune.
 */
export function useVolumeActions() {
  const qc = useQueryClient();

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: volumeKeys.list() });
  };

  const createMut = useMutation({
    mutationFn: async (opts: CreateVolumeOptions) =>
      (await api.post<Volume>('/volumes', opts)).data,
    onSuccess: invalidate,
  });

  const removeMut = useMutation({
    mutationFn: async (name: string) => {
      await api.delete(`/volumes/${name}`);
    },
    onSuccess: invalidate,
  });

  const pruneMut = useMutation({
    mutationFn: async () =>
      (await api.post<PruneResult>('/volumes/prune')).data,
    onSuccess: invalidate,
  });

  return {
    create: (opts: CreateVolumeOptions) => createMut.mutateAsync(opts),
    remove: (name: string) => removeMut.mutateAsync(name),
    prune: () => pruneMut.mutateAsync(),
    isCreating: createMut.isPending,
    isRemoving: removeMut.isPending,
    isPruning: pruneMut.isPending,
  };
}
