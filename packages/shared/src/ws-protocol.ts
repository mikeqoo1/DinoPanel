import type { MetricsSnapshot } from './schemas/system.js';

// =====================================================================
// /ws/metrics — Live system metrics (1Hz broadcast)
// =====================================================================

export type MetricsServerMessage =
  | { type: 'metrics'; payload: MetricsSnapshot }
  | { type: 'pong'; ts: number }
  | { type: 'error'; code: string; message: string };

export type MetricsClientMessage = { type: 'heartbeat'; ts: number };

// =====================================================================
// /ws/terminal — Web SSH terminal (binary + control frames)
// =====================================================================

// Binary frames: raw pty stdin/stdout pass-through.
// Text frames (JSON) for control:

export type TerminalClientMessage =
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'heartbeat'; ts: number };

export type TerminalServerMessage =
  | { type: 'pong'; ts: number }
  | { type: 'exit'; code: number | null; signal?: string | null }
  | { type: 'error'; code: string; message: string };

// =====================================================================
// Endpoint paths
// =====================================================================

export const WS_PATHS = {
  metrics: '/ws/metrics',
  terminal: '/ws/terminal',
} as const;
