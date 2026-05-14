import { getStoredTokens } from './api';

type Listener<T> = (msg: T) => void;

export interface WsClientOptions<T> {
  path: string;
  query?: Record<string, string | number>;
  onMessage: Listener<T>;
  onOpen?: () => void;
  onClose?: (ev: CloseEvent) => void;
  heartbeatMs?: number;
  reconnectMs?: number;
  maxReconnectAttempts?: number;
  parseBinary?: boolean;
}

export interface WsClient {
  send: (data: string | ArrayBufferLike | Blob | ArrayBufferView) => void;
  close: () => void;
  isOpen: () => boolean;
}

export function createWsClient<T = unknown>(opts: WsClientOptions<T>): WsClient {
  const {
    path,
    query = {},
    onMessage,
    onOpen,
    onClose,
    heartbeatMs = 30_000,
    reconnectMs = 2_000,
    maxReconnectAttempts = 10,
    parseBinary = false,
  } = opts;

  let ws: WebSocket | null = null;
  let closed = false;
  let attempts = 0;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  function buildUrl(): string {
    const tokens = getStoredTokens();
    const params = new URLSearchParams();
    if (tokens?.accessToken) params.set('token', tokens.accessToken);
    for (const [k, v] of Object.entries(query)) params.set(k, String(v));
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${proto}//${host}${path}?${params.toString()}`;
  }

  function connect() {
    if (closed) return;
    ws = new WebSocket(buildUrl());
    if (parseBinary) ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      attempts = 0;
      onOpen?.();
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'heartbeat', ts: Date.now() }));
        }
      }, heartbeatMs);
    };

    ws.onmessage = (ev) => {
      if (parseBinary && ev.data instanceof ArrayBuffer) {
        onMessage(ev.data as unknown as T);
        return;
      }
      if (typeof ev.data === 'string') {
        try {
          onMessage(JSON.parse(ev.data) as T);
        } catch {
          // ignore
        }
      } else {
        onMessage(ev.data as unknown as T);
      }
    };

    ws.onclose = (ev) => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      onClose?.(ev);
      if (closed) return;
      if (ev.code === 4001 || ev.code === 1008) return; // auth failure → don't reconnect
      if (attempts < maxReconnectAttempts) {
        attempts++;
        setTimeout(connect, reconnectMs * Math.min(attempts, 5));
      }
    };

    ws.onerror = () => {
      // close handler will follow
    };
  }

  connect();

  return {
    send: (data) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(data);
    },
    close: () => {
      closed = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      ws?.close();
    },
    isOpen: () => ws?.readyState === WebSocket.OPEN,
  };
}
