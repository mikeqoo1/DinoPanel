import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import type {
  ToolboxStatus,
  NtpStatus,
  DiskUsage,
  CleanersList,
  CleanResult,
  CleanCategory,
} from '@dinopanel/shared';
import { api } from '@/lib/api';

export const toolboxKeys = {
  all: ['toolbox'] as const,
  status: () => [...toolboxKeys.all, 'status'] as const,
  ntp: () => [...toolboxKeys.all, 'ntp'] as const,
  timezones: () => [...toolboxKeys.all, 'timezones'] as const,
  disk: (path?: string) => [...toolboxKeys.all, 'disk', path ?? 'default'] as const,
  cleaners: () => [...toolboxKeys.all, 'cleaners'] as const,
};

// GET /api/toolbox/status — feature availability (ntp, disk). Always 200.
export function useToolboxStatus() {
  return useQuery<ToolboxStatus>({
    queryKey: toolboxKeys.status(),
    queryFn: async () => (await api.get<ToolboxStatus>('/toolbox/status')).data,
    retry: 0,
  });
}

export function useNtpStatus(enabled = true) {
  return useQuery<NtpStatus>({
    queryKey: toolboxKeys.ntp(),
    queryFn: async () => (await api.get<NtpStatus>('/toolbox/ntp')).data,
    enabled,
    retry: 0,
  });
}

export function useTimezones(enabled = true) {
  return useQuery<string[]>({
    queryKey: toolboxKeys.timezones(),
    queryFn: async () => (await api.get<string[]>('/toolbox/ntp/timezones')).data,
    enabled,
    retry: 0,
    staleTime: 60 * 60 * 1000, // zone list is effectively static
  });
}

export function useSetNtp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean) =>
      (await api.post<NtpStatus>('/toolbox/ntp/set', { enabled })).data,
    onSuccess: (data) => {
      qc.setQueryData(toolboxKeys.ntp(), data);
      qc.invalidateQueries({ queryKey: toolboxKeys.all });
    },
  });
}

export function useSetTimezone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (timezone: string) =>
      (await api.post<NtpStatus>('/toolbox/ntp/timezone', { timezone })).data,
    onSuccess: (data) => {
      qc.setQueryData(toolboxKeys.ntp(), data);
      qc.invalidateQueries({ queryKey: toolboxKeys.all });
    },
  });
}

export function useDiskUsage(path?: string, enabled = true) {
  return useQuery<DiskUsage>({
    queryKey: toolboxKeys.disk(path),
    queryFn: async () =>
      (await api.get<DiskUsage>('/toolbox/disk', { params: path ? { path } : {} })).data,
    enabled,
    retry: 0,
    // Keep the previous path's data on screen while a new breakdown path loads,
    // so the filesystems table + picker don't flash a skeleton on each switch.
    placeholderData: keepPreviousData,
  });
}

export function useCleaners(enabled = true) {
  return useQuery<CleanersList>({
    queryKey: toolboxKeys.cleaners(),
    queryFn: async () => (await api.get<CleanersList>('/toolbox/cleaners')).data,
    enabled,
    retry: 0,
  });
}

export function useRunCleaner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (category: CleanCategory) =>
      (await api.post<CleanResult>('/toolbox/clean', { category })).data,
    // a clean changes both disk usage and per-category availability
    onSuccess: () => qc.invalidateQueries({ queryKey: toolboxKeys.all }),
  });
}
