import { useEffect, useRef, useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ComposeStack, ComposeFile, ComposeValidation } from '@dinopanel/shared';
import { api } from '@/lib/api';
import { createWsClient } from '@/lib/ws';
import type { WsStatus } from './use-containers';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const composeKeys = {
  all: ['compose'] as const,
  list: () => [...composeKeys.all, 'list'] as const,
  detail: (key: string) => [...composeKeys.all, 'detail', key] as const,
  file: (key: string) => [...composeKeys.all, 'file', key] as const,
};

// ---------------------------------------------------------------------------
// REST query hooks
// ---------------------------------------------------------------------------

/**
 * useComposeStacks — list all compose stacks (registered + discovered).
 */
export function useComposeStacks() {
  return useQuery<ComposeStack[]>({
    queryKey: composeKeys.list(),
    queryFn: async () => (await api.get<ComposeStack[]>('/compose')).data,
  });
}

/**
 * useComposeStack — get a single stack by key (name).
 */
export function useComposeStack(key: string) {
  return useQuery<ComposeStack>({
    queryKey: composeKeys.detail(key),
    queryFn: async () => (await api.get<ComposeStack>(`/compose/${key}`)).data,
    enabled: !!key,
  });
}

/**
 * useComposeFile — get the raw compose YAML content for a stack.
 */
export function useComposeFile(key: string) {
  return useQuery<ComposeFile>({
    queryKey: composeKeys.file(key),
    queryFn: async () => (await api.get<ComposeFile>(`/compose/${key}/file`)).data,
    enabled: !!key,
  });
}

// ---------------------------------------------------------------------------
// Action mutations
// ---------------------------------------------------------------------------

export interface CreateComposeOpts {
  name: string;
  path: string;
  content: string;
}

export function useComposeActions() {
  const qc = useQueryClient();

  const createMut = useMutation({
    mutationFn: async (opts: CreateComposeOpts) => {
      const res = await api.post<ComposeStack>('/compose', opts);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: composeKeys.list() });
    },
  });

  const updateFileMut = useMutation({
    mutationFn: async ({ key, content }: { key: string; content: string }) => {
      await api.put(`/compose/${key}/file`, { content });
    },
    onSuccess: (_data, { key }) => {
      void qc.invalidateQueries({ queryKey: composeKeys.file(key) });
    },
  });

  const unregisterMut = useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/compose/${id}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: composeKeys.list() });
    },
  });

  const validateMut = useMutation({
    mutationFn: async (key: string) => {
      const res = await api.post<ComposeValidation>(`/compose/${key}/validate`);
      return res.data;
    },
  });

  const create = (opts: CreateComposeOpts) => createMut.mutateAsync(opts);
  const updateFile = (key: string, content: string) =>
    updateFileMut.mutateAsync({ key, content });
  const unregister = (id: number) => unregisterMut.mutateAsync(id);
  const validate = (key: string) => validateMut.mutateAsync(key);

  return { create, updateFile, unregister, validate };
}

// ---------------------------------------------------------------------------
// Compose action WebSocket (up / down / restart / pull)
// ---------------------------------------------------------------------------

export type ComposeActionType = 'up' | 'down' | 'restart' | 'pull';

export interface ComposeActionWsHandle {
  status: WsStatus;
  cancel: () => void;
}

/**
 * useComposeActionWs — connect to the compose action WS endpoint.
 *
 * WS URL: /ws/compose/:key/action?type=<action>&token=<jwt>
 *
 * Server → client:
 *   binary ArrayBuffer frames      — stdout/stderr bytes (feed to xterm)
 *   { type: 'exit', code: N }     — process finished (0 = success)
 *   { type: 'error', message: '' }— fatal error before/during spawn
 */
export function useComposeActionWs(
  key: string,
  action: ComposeActionType,
  enabled: boolean,
  onData: (data: Uint8Array) => void,
  onExit?: (code: number) => void,
  onError?: (message: string) => void,
): ComposeActionWsHandle {
  const [status, setStatus] = useState<WsStatus>('connecting');
  const clientRef = useRef<ReturnType<typeof createWsClient> | null>(null);

  useEffect(() => {
    if (!enabled || !key) return;
    setStatus('connecting');

    const client = createWsClient<ArrayBuffer | { type: string; code?: number; message?: string }>({
      path: `/ws/compose/${key}/action`,
      query: { type: action },
      parseBinary: true,
      maxReconnectAttempts: 0,
      onOpen: () => setStatus('connected'),
      onClose: () => setStatus('closed'),
      onMessage: (msg) => {
        if (msg instanceof ArrayBuffer) {
          onData(new Uint8Array(msg));
        } else if (typeof msg === 'object' && msg !== null && 'type' in msg) {
          const ctrl = msg as { type: string; code?: number; message?: string };
          if (ctrl.type === 'exit') {
            onExit?.(ctrl.code ?? 0);
          } else if (ctrl.type === 'error') {
            onError?.(ctrl.message ?? 'Action failed');
          }
        }
      },
    });
    clientRef.current = client;

    return () => {
      client.close();
      clientRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, action, enabled]);

  const cancel = useCallback(() => {
    clientRef.current?.close();
    clientRef.current = null;
    setStatus('closed');
  }, []);

  return { status, cancel };
}
