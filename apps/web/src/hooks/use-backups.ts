import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import type { BackupResponse } from '@dinopanel/shared';
import { api, extractErrorMessage } from '@/lib/api';
import { toast } from 'sonner';

export const backupsKeys = {
  all: ['backups'] as const,
  list: () => [...backupsKeys.all, 'list'] as const,
  byInstance: (id: number) => [...backupsKeys.all, 'by-instance', id] as const,
};

interface BackupsListPage {
  items: BackupResponse[];
  nextCursor: number | null;
}

export function useBackupsList({ instanceId, limit = 50 }: { instanceId?: number; limit?: number } = {}) {
  return useInfiniteQuery<BackupsListPage, Error, { pages: BackupsListPage[]; pageParams: unknown[] }, readonly (string | number)[], number | undefined>({
    queryKey: [...backupsKeys.list(), instanceId ?? 'all'],
    queryFn: async ({ pageParam }) => {
      const params: Record<string, unknown> = { limit };
      if (pageParam !== undefined) params.cursor = pageParam;
      if (instanceId !== undefined) params.instanceId = instanceId;
      const { data } = await api.get<BackupsListPage>('/backups', { params });
      return data;
    },
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function useInstanceBackups(id: number) {
  return useQuery<BackupsListPage>({
    queryKey: backupsKeys.byInstance(id),
    queryFn: async () => {
      const { data } = await api.get<BackupsListPage>(`/databases/${id}/backups`);
      return data;
    },
    retry: 0,
  });
}

export function useCreateBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: number; body?: { retentionGroup: string; keepLastN: number } }) =>
      (await api.post<BackupResponse>(`/databases/${id}/backups`, body ?? {})).data,
    onSuccess: (_data, args) => {
      qc.invalidateQueries({ queryKey: backupsKeys.byInstance(args.id) });
      qc.invalidateQueries({ queryKey: backupsKeys.list() });
    },
  });
}

export function useDeleteBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ backupId }: { backupId: number }) => {
      await api.delete(`/backups/${backupId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: backupsKeys.list() });
      qc.invalidateQueries({ queryKey: backupsKeys.all });
    },
  });
}

export function useRestoreBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ backupId, body }: { backupId: number; body: { confirm: string } }) =>
      (await api.post<BackupResponse>(`/backups/${backupId}/restore`, body)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: backupsKeys.list() });
      qc.invalidateQueries({ queryKey: backupsKeys.all });
    },
  });
}

export async function downloadBackup(id: number, filename: string): Promise<void> {
  const res = await api.get(`/backups/${id}/download`, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Standalone helper that shows its own error toast. Import `toast` from sonner
// at the call site is not needed; this handles it internally.
export async function downloadBackupWithToast(id: number, filename: string, errorMsg: string): Promise<void> {
  try {
    await downloadBackup(id, filename);
  } catch (err) {
    toast.error(extractErrorMessage(err) || errorMsg);
  }
}
