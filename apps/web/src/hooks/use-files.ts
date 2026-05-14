import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FileEntry, ListResponse } from '@dinopanel/shared';
import { api } from '@/lib/api';

interface ListParams {
  path: string;
  showHidden: boolean;
}

export function useFileList({ path, showHidden }: ListParams) {
  return useQuery<ListResponse>({
    queryKey: ['files', 'list', path, showHidden],
    queryFn: async () => {
      const { data } = await api.get<ListResponse>('/files/list', {
        params: { path, showHidden: showHidden ? 'true' : 'false' },
      });
      return data;
    },
    staleTime: 10_000,
  });
}

export function useReadFile(path: string | null) {
  return useQuery({
    queryKey: ['files', 'read', path],
    enabled: !!path,
    queryFn: async () => {
      const { data } = await api.get<{ content: string; size: number }>('/files/read', {
        params: { path },
      });
      return data;
    },
    retry: false,
  });
}

export function useFileMutations(currentPath: string, showHidden: boolean) {
  const qc = useQueryClient();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['files', 'list', currentPath, showHidden] });

  const writeFile = useMutation({
    mutationFn: async ({ path, content }: { path: string; content: string }) => {
      await api.post('/files/write', { path, content });
    },
    onSuccess: () => invalidate(),
  });

  const mkdir = useMutation({
    mutationFn: async (path: string) => {
      await api.post('/files/mkdir', { path });
    },
    onSuccess: () => invalidate(),
  });

  const rename = useMutation({
    mutationFn: async ({ from, to }: { from: string; to: string }) => {
      await api.post('/files/rename', { from, to });
    },
    onSuccess: () => invalidate(),
  });

  const remove = useMutation({
    mutationFn: async (path: string) => {
      await api.delete('/files', { data: { path } });
    },
    onSuccess: () => invalidate(),
  });

  const upload = useMutation({
    mutationFn: async ({ targetDir, file }: { targetDir: string; file: File }) => {
      const buffer = await file.arrayBuffer();
      await api.post('/files/upload', buffer, {
        params: { path: targetDir },
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Filename': file.name,
        },
        maxContentLength: 100 * 1024 * 1024,
        maxBodyLength: 100 * 1024 * 1024,
      });
    },
    onSuccess: () => invalidate(),
  });

  return { writeFile, mkdir, rename, remove, upload, invalidate };
}

export function downloadFileUrl(path: string): string {
  // Caller should fetch with auth header (api client handles this when used).
  // For direct browser download we'll use a signed approach later; for MVP we
  // open via fetch+blob in the component.
  return `/api/files/download?path=${encodeURIComponent(path)}`;
}

export function entrySortBy(entries: FileEntry[]): FileEntry[] {
  return [...entries];
}
