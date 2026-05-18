import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type {
  SystemLogLine,
  SshLogEntry,
  OperationLogEntry,
  LoginLogEntry,
  ScheduledRun,
} from '@dinopanel/shared';
import { api } from '@/lib/api';

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export const logsKeys = {
  all: ['logs'] as const,
  system: () => [...logsKeys.all, 'system'] as const,
  ssh: () => [...logsKeys.all, 'ssh'] as const,
  operation: (filter?: object) => [...logsKeys.all, 'operation', filter ?? {}] as const,
  login: (filter?: object) => [...logsKeys.all, 'login', filter ?? {}] as const,
  task: (taskId?: number) => [...logsKeys.all, 'task', taskId ?? null] as const,
};

export function useSystemLog(opts: { grep?: string; limit?: number } = {}) {
  return useQuery<Page<SystemLogLine>>({
    queryKey: [...logsKeys.system(), opts],
    queryFn: async () =>
      (await api.get<Page<SystemLogLine>>('/logs/system', { params: opts })).data,
  });
}

export function useSshLog(limit = 200) {
  return useQuery<Page<SshLogEntry>>({
    queryKey: [...logsKeys.ssh(), limit],
    queryFn: async () =>
      (await api.get<Page<SshLogEntry>>('/logs/ssh', { params: { limit } })).data,
  });
}

export function useOperationLog(filter: { pathLike?: string; status?: number } = {}) {
  return useInfiniteQuery<Page<OperationLogEntry>>({
    queryKey: logsKeys.operation(filter),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      (
        await api.get<Page<OperationLogEntry>>('/logs/operation', {
          params: {
            cursor: pageParam,
            limit: 50,
            path: filter.pathLike,
            status: filter.status,
          },
        })
      ).data,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useLoginLog(filter: { result?: 'success' | 'fail' } = {}) {
  return useInfiniteQuery<Page<LoginLogEntry>>({
    queryKey: logsKeys.login(filter),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      (
        await api.get<Page<LoginLogEntry>>('/logs/login', {
          params: { cursor: pageParam, limit: 50, result: filter.result },
        })
      ).data,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useTaskLog(taskId?: number) {
  return useInfiniteQuery<Page<ScheduledRun>>({
    queryKey: logsKeys.task(taskId),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      (
        await api.get<Page<ScheduledRun>>('/logs/tasks', {
          params: { cursor: pageParam, limit: 50, taskId },
        })
      ).data,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
