import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  ScheduledTask,
  ScheduledRun,
  CreateScheduledTaskBody,
  UpdateScheduledTaskBody,
} from '@dinopanel/shared';
import { api } from '@/lib/api';

export const schedulerKeys = {
  all: ['scheduler'] as const,
  tasks: () => [...schedulerKeys.all, 'tasks'] as const,
  runs: (taskId: number) => [...schedulerKeys.all, 'runs', taskId] as const,
};

export function useScheduledTasks(opts: { includeBuiltin?: boolean } = {}) {
  return useQuery<ScheduledTask[]>({
    queryKey: [...schedulerKeys.tasks(), opts.includeBuiltin ?? false],
    queryFn: async () => {
      const params = opts.includeBuiltin ? { includeBuiltin: 'true' } : undefined;
      const { data } = await api.get<ScheduledTask[]>('/scheduler/tasks', { params });
      return data;
    },
  });
}

export function useTaskRuns(taskId: number | null) {
  return useQuery<{ items: ScheduledRun[]; nextCursor: string | null }>({
    queryKey: taskId !== null ? schedulerKeys.runs(taskId) : ['scheduler', 'runs', 'none'],
    queryFn: async () => {
      const { data } = await api.get<{ items: ScheduledRun[]; nextCursor: string | null }>(
        `/scheduler/tasks/${taskId}/runs`,
        { params: { limit: 20 } },
      );
      return data;
    },
    enabled: taskId !== null,
  });
}

export function useCreateScheduledTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateScheduledTaskBody) =>
      (await api.post<ScheduledTask>('/scheduler/tasks', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: schedulerKeys.tasks() }),
  });
}

export function useUpdateScheduledTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: number; body: UpdateScheduledTaskBody }) =>
      (await api.patch<ScheduledTask>(`/scheduler/tasks/${id}`, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: schedulerKeys.tasks() }),
  });
}

export function useDeleteScheduledTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) =>
      (await api.delete<{ ok: true }>(`/scheduler/tasks/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: schedulerKeys.tasks() }),
  });
}

export function useRunTaskNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) =>
      (await api.post<{ runId: number }>(`/scheduler/tasks/${id}/run`)).data,
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: schedulerKeys.runs(id) });
      qc.invalidateQueries({ queryKey: schedulerKeys.tasks() });
    },
  });
}
