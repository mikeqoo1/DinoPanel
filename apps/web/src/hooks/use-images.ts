import { useEffect, useRef, useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Image } from '@dinopanel/shared';
import { api } from '@/lib/api';
import { createWsClient } from '@/lib/ws';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const imageKeys = {
  all: ['images'] as const,
  list: () => [...imageKeys.all, 'list'] as const,
  detail: (id: string) => [...imageKeys.all, 'detail', id] as const,
};

// ---------------------------------------------------------------------------
// REST hooks
// ---------------------------------------------------------------------------

/**
 * useImages — list all local images.
 */
export function useImages() {
  return useQuery<Image[]>({
    queryKey: imageKeys.list(),
    queryFn: async () => (await api.get<Image[]>('/images')).data,
  });
}

/**
 * useImage — inspect a single image by id.
 */
export function useImage(id: string) {
  return useQuery<Image>({
    queryKey: imageKeys.detail(id),
    queryFn: async () => (await api.get<Image>(`/images/${id}`)).data,
    enabled: !!id,
  });
}

// ---------------------------------------------------------------------------
// Image action mutations
// ---------------------------------------------------------------------------

export type ImageActionType = 'remove' | 'remove-force' | 'tag';

export interface TagOptions {
  repo: string;
  tag?: string;
}

/**
 * useImageAction — remove or tag an image.
 */
export function useImageAction(id: string) {
  const qc = useQueryClient();

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: imageKeys.list() });
    void qc.invalidateQueries({ queryKey: imageKeys.detail(id) });
  };

  const mut = useMutation({
    mutationFn: async (
      action:
        | { type: 'remove'; force?: boolean }
        | { type: 'tag'; repo: string; tag?: string },
    ) => {
      if (action.type === 'remove') {
        await api.delete(`/images/${id}`, {
          params: action.force ? { force: '1' } : undefined,
        });
      } else {
        await api.post(`/images/${id}/tag`, {
          repo: action.repo,
          tag: action.tag ?? 'latest',
        });
      }
    },
    onSuccess: invalidate,
  });

  const remove = (force = false) =>
    mut.mutateAsync({ type: 'remove', force });

  const tag = (repo: string, tagName?: string) =>
    mut.mutateAsync({ type: 'tag', repo, tag: tagName });

  return { remove, tag, ...mut };
}

// ---------------------------------------------------------------------------
// Pull progress WS
// ---------------------------------------------------------------------------

export interface LayerProgress {
  layerId: string;
  status: string;
  current: number;
  total: number;
}

export type PullWsStatus = 'idle' | 'connecting' | 'connected' | 'done' | 'error' | 'closed';

export interface PullProgressState {
  layers: Map<string, LayerProgress>;
  status: PullWsStatus;
  error: string | null;
}

/**
 * Raw event from dockerode forwarded over WS.
 * Examples:
 *   { status: "Pulling fs layer", progressDetail: {}, id: "abc123" }
 *   { status: "Downloading", progressDetail: { current: 1024, total: 8192 }, id: "abc123" }
 *   { status: "Pull complete", progressDetail: {}, id: "abc123" }
 *   { type: "end" }
 *   { type: "error", code: "...", message: "..." }
 */
interface RawPullEvent {
  type?: 'end' | 'error';
  status?: string;
  id?: string;
  progressDetail?: { current?: number; total?: number };
  error?: string;
  message?: string;
  code?: string;
}

/**
 * useImagePullWs — connect/disconnect controlled pull WS hook.
 *
 * WS URL: /ws/images/pull?ref=<encoded>&token=<jwt>
 * Server forwards raw dockerode JSON events.
 */
export function useImagePullWs(
  ref: string,
  onComplete: () => void,
  onError: (msg: string) => void,
) {
  const [layers, setLayers] = useState<Map<string, LayerProgress>>(new Map());
  const [status, setStatus] = useState<PullWsStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<ReturnType<typeof createWsClient> | null>(null);
  const layersRef = useRef<Map<string, LayerProgress>>(new Map());

  const connect = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.close();
      clientRef.current = null;
    }

    // Reset state
    layersRef.current = new Map();
    setLayers(new Map());
    setError(null);
    setStatus('connecting');

    const client = createWsClient<RawPullEvent>({
      path: '/ws/images/pull',
      query: { ref: encodeURIComponent(ref) },
      // pull WS sends JSON lines only — no binary
      onOpen: () => setStatus('connected'),
      onClose: () => {
        setStatus((prev) => (prev === 'done' || prev === 'error' ? prev : 'closed'));
      },
      onMessage: (msg) => {
        // end signal
        if (msg.type === 'end') {
          setStatus('done');
          clientRef.current?.close();
          onComplete();
          return;
        }

        // error signal
        if (msg.type === 'error') {
          const errMsg = msg.message ?? msg.code ?? 'Pull failed';
          setError(errMsg);
          setStatus('error');
          clientRef.current?.close();
          onError(errMsg);
          return;
        }

        // layer progress event
        const layerId = msg.id;
        if (!layerId || !msg.status) return;

        const detail = msg.progressDetail ?? {};
        const current = detail.current ?? 0;
        const total = detail.total ?? 0;

        const prev = layersRef.current;
        const updated = new Map(prev);
        updated.set(layerId, {
          layerId,
          status: msg.status,
          current,
          total,
        });
        layersRef.current = updated;
        setLayers(updated);
      },
      // Don't auto-reconnect for pull — user controls it
      maxReconnectAttempts: 0,
    });

    clientRef.current = client;
  }, [ref, onComplete, onError]);

  const disconnect = useCallback(() => {
    clientRef.current?.close();
    clientRef.current = null;
    setStatus('closed');
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      clientRef.current?.close();
      clientRef.current = null;
    };
  }, []);

  return { layers, status, error, connect, disconnect };
}
