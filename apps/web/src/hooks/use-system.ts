import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { MetricsSnapshot, SystemInfo, MetricsServerMessage } from '@dinopanel/shared';
import { WS_PATHS } from '@dinopanel/shared';
import { api } from '@/lib/api';
import { createWsClient } from '@/lib/ws';

const HISTORY_LENGTH = 60;

export function useSystemInfo() {
  return useQuery<SystemInfo>({
    queryKey: ['system', 'info'],
    queryFn: async () => (await api.get<SystemInfo>('/system/info')).data,
    staleTime: 5 * 60_000,
  });
}

export interface MetricsHistory {
  cpu: number[];
  memPct: number[];
  netRx: number[];
  netTx: number[];
  ts: number[];
}

const emptyHistory = (): MetricsHistory => ({
  cpu: [],
  memPct: [],
  netRx: [],
  netTx: [],
  ts: [],
});

export function useMetricsStream() {
  const [latest, setLatest] = useState<MetricsSnapshot | null>(null);
  const [history, setHistory] = useState<MetricsHistory>(emptyHistory);
  const [connected, setConnected] = useState(false);
  const historyRef = useRef<MetricsHistory>(emptyHistory());

  useEffect(() => {
    const client = createWsClient<MetricsServerMessage>({
      path: WS_PATHS.metrics,
      onOpen: () => setConnected(true),
      onClose: () => setConnected(false),
      onMessage: (msg) => {
        if (msg.type !== 'metrics') return;
        const s = msg.payload;
        setLatest(s);

        const h = historyRef.current;
        h.cpu.push(s.cpu.usage);
        h.memPct.push(s.mem.total > 0 ? (s.mem.used / s.mem.total) * 100 : 0);
        h.netRx.push(s.net.rxRate);
        h.netTx.push(s.net.txRate);
        h.ts.push(s.ts);
        if (h.cpu.length > HISTORY_LENGTH) {
          h.cpu.shift();
          h.memPct.shift();
          h.netRx.shift();
          h.netTx.shift();
          h.ts.shift();
        }
        setHistory({ ...h });
      },
    });

    return () => {
      client.close();
    };
  }, []);

  return { latest, history, connected };
}
