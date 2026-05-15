import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Container } from '@dinopanel/shared';
import { api } from '@/lib/api';
import { createWsClient } from '@/lib/ws';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const containerKeys = {
  all: ['containers'] as const,
  list: () => [...containerKeys.all, 'list'] as const,
  detail: (id: string) => [...containerKeys.all, 'detail', id] as const,
};

// ---------------------------------------------------------------------------
// REST hooks
// ---------------------------------------------------------------------------

/**
 * useContainers — list all containers (running + stopped).
 * Pass refetchInterval (ms) to enable polling; undefined to disable.
 */
export function useContainers(refetchInterval?: number) {
  return useQuery<Container[]>({
    queryKey: containerKeys.list(),
    queryFn: async () => (await api.get<Container[]>('/containers')).data,
    refetchInterval,
  });
}

/**
 * useContainer — get full inspect data for a single container.
 */
export function useContainer(id: string) {
  return useQuery<Container>({
    queryKey: containerKeys.detail(id),
    queryFn: async () => (await api.get<Container>(`/containers/${id}`)).data,
    enabled: !!id,
  });
}

// ---------------------------------------------------------------------------
// Container action types
// ---------------------------------------------------------------------------

export type ContainerActionType =
  | 'start'
  | 'stop'
  | 'restart'
  | 'pause'
  | 'unpause'
  | 'kill'
  | 'remove';

export interface RemoveOptions {
  force?: boolean;
}

/**
 * useContainerAction — mutation factory for container lifecycle operations.
 */
export function useContainerAction(id: string) {
  const qc = useQueryClient();

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: containerKeys.list() });
    void qc.invalidateQueries({ queryKey: containerKeys.detail(id) });
  };

  const actionMut = useMutation({
    mutationFn: async (action: ContainerActionType | { type: 'remove'; force: boolean }) => {
      if (typeof action === 'string') {
        await api.post(`/containers/${id}/${action}`);
      } else {
        await api.delete(`/containers/${id}`, {
          params: { force: action.force ? '1' : '0' },
        });
      }
    },
    onSuccess: invalidate,
  });

  const act = (type: ContainerActionType, opts?: RemoveOptions) => {
    if (type === 'remove') {
      return actionMut.mutateAsync({ type: 'remove', force: opts?.force ?? false });
    }
    return actionMut.mutateAsync(type);
  };

  return { act, ...actionMut };
}

// ---------------------------------------------------------------------------
// WebSocket status type
// ---------------------------------------------------------------------------

export type WsStatus = 'connecting' | 'connected' | 'closed';

// ---------------------------------------------------------------------------
// useContainerLogsWs
// ---------------------------------------------------------------------------

export interface ContainerLogsState {
  chunks: Uint8Array[];
  status: WsStatus;
}

/**
 * useContainerLogsWs — stream raw log bytes from the container log WS.
 * Binary frames are passed directly to xterm.
 *
 * WS URL: /ws/containers/:id/logs?follow=true&tail=200&token=<jwt>
 * Server sends binary ArrayBuffer frames (raw log bytes).
 * No special framing — bytes flow straight into xterm.write().
 */
export function useContainerLogsWs(id: string, enabled: boolean) {
  const [chunks, setChunks] = useState<Uint8Array[]>([]);
  const [status, setStatus] = useState<WsStatus>('connecting');
  // Keep a ref to push raw bytes into xterm directly from callers
  const writeRef = useRef<((data: Uint8Array) => void) | null>(null);

  useEffect(() => {
    if (!enabled || !id) return;
    setChunks([]);
    setStatus('connecting');

    const client = createWsClient<ArrayBuffer>({
      path: `/ws/containers/${id}/logs`,
      query: { follow: 'true', tail: '200' },
      parseBinary: true,
      onOpen: () => setStatus('connected'),
      onClose: () => setStatus('closed'),
      onMessage: (buf) => {
        const chunk = new Uint8Array(buf);
        setChunks((prev) => [...prev, chunk]);
        writeRef.current?.(chunk);
      },
    });

    return () => {
      client.close();
    };
  }, [id, enabled]);

  return { chunks, status, writeRef };
}

// ---------------------------------------------------------------------------
// useContainerStatsWs
// ---------------------------------------------------------------------------

export interface ContainerStats {
  cpuPct: number;
  memPct: number;
  memUsed: number;
  memLimit: number;
  netRx: number;
  netTx: number;
  blockRead: number;
  blockWrite: number;
  ts: number;
}

const STATS_HISTORY = 60;

export interface ContainerStatsState {
  latest: ContainerStats | null;
  history: ContainerStats[];
  status: WsStatus;
}

/**
 * useContainerStatsWs — stream docker stats JSON.
 *
 * WS URL: /ws/containers/:id/stats?token=<jwt>
 * Server sends JSON text frames matching ContainerStatsServerMessage:
 * { type: 'stats', payload: ContainerStats }
 */
export function useContainerStatsWs(id: string, enabled: boolean): ContainerStatsState {
  const [latest, setLatest] = useState<ContainerStats | null>(null);
  const [history, setHistory] = useState<ContainerStats[]>([]);
  const [status, setStatus] = useState<WsStatus>('connecting');
  const historyRef = useRef<ContainerStats[]>([]);

  useEffect(() => {
    if (!enabled || !id) return;
    historyRef.current = [];
    setHistory([]);
    setLatest(null);
    setStatus('connecting');

    type StatsMsg = { type: 'stats'; payload: ContainerStats };

    const client = createWsClient<StatsMsg>({
      path: `/ws/containers/${id}/stats`,
      onOpen: () => setStatus('connected'),
      onClose: () => setStatus('closed'),
      onMessage: (msg) => {
        if (msg.type !== 'stats') return;
        const s = msg.payload;
        setLatest(s);
        const h = historyRef.current;
        h.push(s);
        if (h.length > STATS_HISTORY) h.shift();
        setHistory([...h]);
      },
    });

    return () => {
      client.close();
    };
  }, [id, enabled]);

  return { latest, history, status };
}

// ---------------------------------------------------------------------------
// useContainerExecWs
// ---------------------------------------------------------------------------

export interface ExecWsHandle {
  send: (data: string | Uint8Array) => void;
  sendResize: (cols: number, rows: number) => void;
  close: () => void;
  status: WsStatus;
}

/**
 * useContainerExecWs — bidirectional exec shell WS.
 *
 * WS URL: /ws/containers/:id/exec?cmd=/bin/sh&token=<jwt>
 *
 * Client → server text frames:
 *   { type: 'resize', cols: N, rows: N }   — terminal resize
 *   raw stdin string or binary             — keystroke data
 *
 * Server → client:
 *   binary ArrayBuffer frames              — stdout/stderr bytes
 *   { type: 'exit', code: N }             — process exited
 */
export function useContainerExecWs(
  id: string,
  cmd: string,
  enabled: boolean,
  onData: (data: Uint8Array) => void,
  onExit?: (code: number) => void,
) {
  const [status, setStatus] = useState<WsStatus>('connecting');
  const clientRef = useRef<ReturnType<typeof createWsClient> | null>(null);

  useEffect(() => {
    if (!enabled || !id) return;
    setStatus('connecting');

    const client = createWsClient<ArrayBuffer | { type: string; code?: number }>({
      path: `/ws/containers/${id}/exec`,
      query: { cmd },
      parseBinary: true,
      onOpen: () => setStatus('connected'),
      onClose: () => setStatus('closed'),
      onMessage: (msg) => {
        if (msg instanceof ArrayBuffer) {
          onData(new Uint8Array(msg));
        } else if (typeof msg === 'object' && msg !== null && 'type' in msg) {
          const ctrl = msg as { type: string; code?: number };
          if (ctrl.type === 'exit') {
            onExit?.(ctrl.code ?? 0);
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
  }, [id, cmd, enabled]);

  const send = (data: string | Uint8Array) => {
    clientRef.current?.send(data);
  };

  const sendResize = (cols: number, rows: number) => {
    clientRef.current?.send(JSON.stringify({ type: 'resize', cols, rows }));
  };

  const close = () => {
    clientRef.current?.close();
  };

  return { send, sendResize, close, status };
}
