import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getStoredTokens } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useTheme } from '@/components/theme-provider';

interface TerminalViewProps {
  active: boolean;
  fontSize?: number;
}

type Status = 'connecting' | 'connected' | 'closed';

const lightTheme = {
  background: '#ffffff',
  foreground: '#1f2328',
  cursor: '#1f2328',
  selectionBackground: '#0969da33',
  black: '#1f2328',
  red: '#cf222e',
  green: '#1a7f37',
  yellow: '#9a6700',
  blue: '#0969da',
  magenta: '#8250df',
  cyan: '#1b7c83',
  white: '#6e7781',
  brightBlack: '#57606a',
  brightRed: '#a40e26',
  brightGreen: '#116329',
  brightYellow: '#4d2d00',
  brightBlue: '#0550ae',
  brightMagenta: '#6639ba',
  brightCyan: '#3192aa',
  brightWhite: '#8c959f',
} as const;

const darkTheme = {
  background: '#0d1117',
  foreground: '#e6edf3',
  cursor: '#79c0ff',
  selectionBackground: '#3392ff44',
  black: '#484f58',
  red: '#ff7b72',
  green: '#3fb950',
  yellow: '#d29922',
  blue: '#58a6ff',
  magenta: '#bc8cff',
  cyan: '#39c5cf',
  white: '#b1bac4',
  brightBlack: '#6e7681',
  brightRed: '#ffa198',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#79c0ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#56d4dd',
  brightWhite: '#f0f6fc',
} as const;

export function TerminalView({ active, fontSize = 13 }: TerminalViewProps) {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [latency, setLatency] = useState<number | null>(null);

  const connect = useCallback(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;

    fit.fit();
    const { cols, rows } = term;
    const tokens = getStoredTokens();
    if (!tokens?.accessToken) {
      term.writeln('\x1b[31m[error] not authenticated\x1b[0m');
      setStatus('closed');
      return;
    }
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws/terminal?token=${encodeURIComponent(tokens.accessToken)}&cols=${cols}&rows=${rows}`;

    setStatus('connecting');
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('connected');
      // heartbeat
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      heartbeatRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'heartbeat', ts: Date.now() }));
        }
      }, 30_000);
    };

    ws.onmessage = (ev) => {
      const data = ev.data;
      if (typeof data === 'string') {
        if (data.startsWith('{') && /"type"\s*:/.test(data.slice(0, 40))) {
          try {
            const ctrl = JSON.parse(data) as { type: string; code?: number; ts?: number };
            if (ctrl.type === 'pong' && typeof ctrl.ts === 'number') {
              setLatency(Date.now() - ctrl.ts);
              return;
            }
            if (ctrl.type === 'exit') {
              term.writeln(`\r\n\x1b[33m[exited with code ${ctrl.code ?? '?'}]\x1b[0m`);
              return;
            }
          } catch {
            // fall through
          }
        }
        term.write(data);
      } else if (data instanceof ArrayBuffer) {
        term.write(new Uint8Array(data));
      }
    };

    ws.onclose = (ev) => {
      setStatus('closed');
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      if (ev.code !== 1000 && ev.code !== 1005) {
        term.writeln(`\r\n\x1b[31m[connection closed: ${ev.code}]\x1b[0m`);
      }
    };
  }, []);

  // mount xterm once
  useEffect(() => {
    if (!containerRef.current) return;
    const term = new Terminal({
      fontFamily: '"JetBrains Mono", "Fira Code", Monaco, Menlo, Consolas, monospace',
      fontSize,
      cursorBlink: true,
      cursorStyle: 'block',
      allowProposedApi: true,
      scrollback: 5000,
      theme: resolvedTheme === 'dark' ? darkTheme : lightTheme,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    termRef.current = term;
    fitRef.current = fit;

    term.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(data);
      }
    });
    term.onResize(({ cols, rows }) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });

    fit.fit();
    connect();

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        // ignore — terminal may be detached
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      try {
        wsRef.current?.close();
      } catch {
        // ignore
      }
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // theme change
  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options.theme = resolvedTheme === 'dark' ? darkTheme : lightTheme;
  }, [resolvedTheme]);

  // font size change
  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options.fontSize = fontSize;
    try {
      fitRef.current?.fit();
    } catch {
      // ignore
    }
  }, [fontSize]);

  // refit when tab becomes active
  useEffect(() => {
    if (active && termRef.current && fitRef.current) {
      setTimeout(() => {
        try {
          fitRef.current?.fit();
          termRef.current?.focus();
        } catch {
          // ignore
        }
      }, 50);
    }
  }, [active]);

  const handleReconnect = () => {
    try {
      wsRef.current?.close();
    } catch {
      // ignore
    }
    termRef.current?.clear();
    connect();
  };

  return (
    <div className="relative flex h-full w-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'flex items-center gap-1.5',
              status === 'connected' && 'text-green-600 dark:text-green-400',
              status === 'connecting' && 'text-muted-foreground',
              status === 'closed' && 'text-destructive',
            )}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                status === 'connected' && 'bg-green-500',
                status === 'connecting' && 'bg-muted-foreground animate-pulse',
                status === 'closed' && 'bg-destructive',
              )}
            />
            {status === 'connected' && t('terminal.connected')}
            {status === 'connecting' && t('terminal.connecting')}
            {status === 'closed' && t('terminal.disconnected')}
          </span>
          {latency !== null && status === 'connected' && (
            <span className="text-muted-foreground">{latency}ms</span>
          )}
        </div>
        {status === 'closed' && (
          <Button size="sm" variant="ghost" onClick={handleReconnect}>
            <RefreshCw className="h-3.5 w-3.5" />
            {t('terminal.reconnect')}
          </Button>
        )}
      </div>
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden"
        style={{ background: resolvedTheme === 'dark' ? darkTheme.background : lightTheme.background }}
      />
    </div>
  );
}
