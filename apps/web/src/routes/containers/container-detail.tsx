import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import Editor from '@monaco-editor/react';
import {
  Play,
  Square,
  RotateCcw,
  Pause,
  ArrowLeft,
  Loader2,
  Terminal as TermIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { MetricChart } from '@/components/charts/metric-chart';
import { useTheme } from '@/components/theme-provider';
import { cn } from '@/lib/utils';
import { extractErrorMessage } from '@/lib/api';
import {
  useContainer,
  useContainerAction,
  useContainerLogsWs,
  useContainerStatsWs,
  useContainerExecWs,
} from '@/hooks/use-containers';
import type { Container, ContainerState } from '@dinopanel/shared';

// ---------------------------------------------------------------------------
// Theme constants (mirrors terminal-view.tsx)
// ---------------------------------------------------------------------------

const lightTheme = {
  background: '#ffffff',
  foreground: '#1f2328',
  cursor: '#1f2328',
  selectionBackground: '#0969da33',
} as const;

const darkTheme = {
  background: '#0d1117',
  foreground: '#e6edf3',
  cursor: '#79c0ff',
  selectionBackground: '#3392ff44',
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stateBadgeVariant(
  state: ContainerState,
): 'success' | 'warning' | 'muted' | 'destructive' {
  switch (state) {
    case 'running':
      return 'success';
    case 'paused':
    case 'restarting':
      return 'warning';
    case 'exited':
    case 'dead':
      return 'destructive';
    default:
      return 'muted';
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function WsStatusDot({ status }: { status: 'connecting' | 'connected' | 'closed' }) {
  return (
    <span
      className={cn(
        'h-2 w-2 rounded-full',
        status === 'connected' && 'bg-green-500',
        status === 'connecting' && 'animate-pulse bg-yellow-500',
        status === 'closed' && 'bg-destructive',
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Logs Tab
// ---------------------------------------------------------------------------

interface LogsTabProps {
  containerId: string;
  active: boolean;
}

function LogsTab({ containerId, active }: LogsTabProps) {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  const { status, writeRef } = useContainerLogsWs(containerId, active);

  // Wire the xterm write callback
  useEffect(() => {
    writeRef.current = (chunk: Uint8Array) => {
      termRef.current?.write(chunk);
    };
    return () => {
      writeRef.current = null;
    };
  }, [writeRef]);

  // Mount xterm once
  useEffect(() => {
    if (!containerRef.current) return;
    const term = new Terminal({
      fontFamily: '"JetBrains Mono", "Fira Code", Monaco, Menlo, Consolas, monospace',
      fontSize: 12,
      disableStdin: true,
      cursorBlink: false,
      scrollback: 10_000,
      theme: resolvedTheme === 'dark' ? darkTheme : lightTheme,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    termRef.current = term;
    fitRef.current = fit;
    fit.fit();

    const ro = new ResizeObserver(() => { try { fit.fit(); } catch { /* ignore */ } });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme sync
  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options.theme = resolvedTheme === 'dark' ? darkTheme : lightTheme;
  }, [resolvedTheme]);

  // Refit when tab becomes active
  useEffect(() => {
    if (active) {
      setTimeout(() => { try { fitRef.current?.fit(); } catch { /* ignore */ } }, 50);
    }
  }, [active]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
        <WsStatusDot status={status} />
        <span>
          {status === 'connected' && t('containers.logs.streaming')}
          {status === 'connecting' && t('containers.logs.connecting')}
          {status === 'closed' && t('containers.logs.disconnected')}
        </span>
      </div>
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden"
        style={{ background: resolvedTheme === 'dark' ? darkTheme.background : lightTheme.background }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stats Tab
// ---------------------------------------------------------------------------

interface StatsTabProps {
  containerId: string;
  active: boolean;
}

function StatsTab({ containerId, active }: StatsTabProps) {
  const { t } = useTranslation();
  const { latest, history, status } = useContainerStatsWs(containerId, active);

  const cpuHistory = history.map((s) => s.cpuPct);
  const memHistory = history.map((s) => s.memPct);
  const netRxHistory = history.map((s) => s.netRx);
  const netTxHistory = history.map((s) => s.netTx);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <WsStatusDot status={status} />
        <span>
          {status === 'connected' && t('containers.stats.live')}
          {status === 'connecting' && t('containers.stats.connecting')}
          {status === 'closed' && t('containers.stats.disconnected')}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* CPU */}
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-sm font-medium">{t('containers.stats.cpu')}</span>
            <span className="font-mono text-lg font-semibold">
              {latest ? `${latest.cpuPct.toFixed(1)}%` : '—'}
            </span>
          </div>
          <MetricChart data={cpuHistory} color="var(--color-chart-1)" yMax={100} format={(v) => `${v.toFixed(1)}%`} height={72} />
        </div>

        {/* Memory */}
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-sm font-medium">{t('containers.stats.memory')}</span>
            <span className="font-mono text-lg font-semibold">
              {latest ? `${latest.memPct.toFixed(1)}%` : '—'}
            </span>
          </div>
          {latest && (
            <p className="mb-1 text-xs text-muted-foreground">
              {formatBytes(latest.memUsed)} / {formatBytes(latest.memLimit)}
            </p>
          )}
          <MetricChart data={memHistory} color="var(--color-chart-2)" yMax={100} format={(v) => `${v.toFixed(1)}%`} height={72} />
        </div>

        {/* Net I/O */}
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-sm font-medium">{t('containers.stats.network')}</span>
            {latest && (
              <span className="font-mono text-xs text-muted-foreground">
                ↑ {formatBytes(latest.netTx)}/s ↓ {formatBytes(latest.netRx)}/s
              </span>
            )}
          </div>
          <div className="flex gap-1">
            <div className="flex-1">
              <p className="mb-0.5 text-[10px] text-muted-foreground">↑ TX</p>
              <MetricChart data={netTxHistory} color="var(--color-chart-3)" format={(v) => `${formatBytes(v)}/s`} height={56} />
            </div>
            <div className="flex-1">
              <p className="mb-0.5 text-[10px] text-muted-foreground">↓ RX</p>
              <MetricChart data={netRxHistory} color="var(--color-chart-4)" format={(v) => `${formatBytes(v)}/s`} height={56} />
            </div>
          </div>
        </div>

        {/* Block I/O */}
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-sm font-medium">{t('containers.stats.block_io')}</span>
            {latest && (
              <span className="font-mono text-xs text-muted-foreground">
                R {formatBytes(latest.blockRead)} W {formatBytes(latest.blockWrite)}
              </span>
            )}
          </div>
          <MetricChart data={history.map((s) => s.blockRead)} color="var(--color-chart-4)" format={(v) => formatBytes(v)} height={72} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inspect Tab
// ---------------------------------------------------------------------------

interface InspectTabProps {
  container: Container;
}

function InspectTab({ container }: InspectTabProps) {
  const { resolvedTheme } = useTheme();

  const json = JSON.stringify(container, null, 2);

  return (
    <div className="h-full">
      <Editor
        height="100%"
        defaultLanguage="json"
        value={json}
        theme={resolvedTheme === 'dark' ? 'vs-dark' : 'vs'}
        options={{
          readOnly: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 12,
          wordWrap: 'on',
          lineNumbers: 'on',
          folding: true,
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exec Tab
// ---------------------------------------------------------------------------

interface ExecTabProps {
  containerId: string;
  active: boolean;
}

function ExecTabInner({ containerId, cmd }: { containerId: string; cmd: string }) {
  const { resolvedTheme } = useTheme();
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [exited, setExited] = useState(false);

  const handleData = useCallback((data: Uint8Array) => {
    termRef.current?.write(data);
  }, []);

  const handleExit = useCallback((code: number) => {
    termRef.current?.writeln(`\r\n\x1b[33m[exited with code ${code}]\x1b[0m`);
    setExited(true);
  }, []);

  const { send, sendResize, status } = useContainerExecWs(
    containerId,
    cmd,
    true,
    handleData,
    handleExit,
  );

  // Mount xterm
  useEffect(() => {
    if (!containerRef.current) return;
    const term = new Terminal({
      fontFamily: '"JetBrains Mono", "Fira Code", Monaco, Menlo, Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 5000,
      theme: resolvedTheme === 'dark' ? darkTheme : lightTheme,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    termRef.current = term;
    fitRef.current = fit;
    fit.fit();

    term.onData((data) => { send(data); });
    term.onResize(({ cols, rows }) => { sendResize(cols, rows); });

    const ro = new ResizeObserver(() => { try { fit.fit(); } catch { /* ignore */ } });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme sync
  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options.theme = resolvedTheme === 'dark' ? darkTheme : lightTheme;
  }, [resolvedTheme]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
        <WsStatusDot status={status} />
        <span>
          {!exited && status === 'connected' && t('containers.exec.connected')}
          {!exited && status === 'connecting' && t('containers.exec.connecting')}
          {(exited || status === 'closed') && t('containers.exec.disconnected')}
        </span>
        <span className="font-mono opacity-60">{cmd}</span>
      </div>
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden"
        style={{ background: resolvedTheme === 'dark' ? darkTheme.background : lightTheme.background }}
      />
    </div>
  );
}

function ExecTab({ containerId, active }: ExecTabProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [cmdInput, setCmdInput] = useState('/bin/sh');
  const [execCmd, setExecCmd] = useState<string | null>(null);

  const handleOpen = () => {
    setExecCmd(cmdInput.trim() || '/bin/sh');
    setOpen(true);
  };

  if (!active) return null;

  return (
    <div className="flex flex-col items-center justify-center gap-4 p-8">
      <TermIcon className="h-12 w-12 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{t('containers.exec.hint')}</p>
      <div className="flex w-full max-w-sm items-center gap-2">
        <label className="shrink-0 text-sm font-medium">{t('containers.exec.cmd_label')}</label>
        <Input
          value={cmdInput}
          onChange={(e) => setCmdInput(e.target.value)}
          placeholder="/bin/sh"
          className="font-mono text-sm"
          onKeyDown={(e) => e.key === 'Enter' && handleOpen()}
        />
      </div>
      <Button onClick={handleOpen}>
        <TermIcon className="h-4 w-4" />
        {t('containers.exec.open')}
      </Button>

      <Dialog open={open} onOpenChange={(o) => { if (!o) { setOpen(false); setExecCmd(null); } }}>
        <DialogContent className="max-w-4xl h-[600px] flex flex-col p-0">
          <DialogHeader className="px-4 pt-4 pb-2">
            <DialogTitle>{t('containers.exec.shell_title')}</DialogTitle>
            <DialogDescription className="font-mono text-xs">{execCmd}</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-hidden rounded-b-lg">
            {execCmd && open && (
              <ExecTabInner containerId={containerId} cmd={execCmd} />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header actions
// ---------------------------------------------------------------------------

interface HeaderActionsProps {
  container: Container;
  onRefresh: () => void;
}

function HeaderActions({ container, onRefresh }: HeaderActionsProps) {
  const { t } = useTranslation();
  const { act, isPending } = useContainerAction(container.id);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const handle = async (action: Parameters<typeof act>[0]) => {
    setPendingAction(action);
    try {
      await act(action);
      toast.success(t(`containers.actions.${action}_success`, { defaultValue: 'Done' }));
      onRefresh();
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setPendingAction(null);
    }
  };

  const isRunning = container.state === 'running';
  const isPaused = container.state === 'paused';

  return (
    <div className="flex items-center gap-2">
      {!isRunning && !isPaused && (
        <Button size="sm" variant="outline" disabled={isPending} onClick={() => void handle('start')}>
          {pendingAction === 'start' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {t('containers.actions.start')}
        </Button>
      )}
      {isRunning && (
        <>
          <Button size="sm" variant="outline" disabled={isPending} onClick={() => void handle('pause')}>
            {pendingAction === 'pause' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pause className="h-4 w-4" />}
            {t('containers.actions.pause')}
          </Button>
          <Button size="sm" variant="outline" disabled={isPending} onClick={() => void handle('stop')}>
            {pendingAction === 'stop' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
            {t('containers.actions.stop')}
          </Button>
        </>
      )}
      {isPaused && (
        <Button size="sm" variant="outline" disabled={isPending} onClick={() => void handle('unpause')}>
          {pendingAction === 'unpause' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {t('containers.actions.unpause')}
        </Button>
      )}
      {(isRunning || isPaused) && (
        <Button size="sm" variant="outline" disabled={isPending} onClick={() => void handle('restart')}>
          {pendingAction === 'restart' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
          {t('containers.actions.restart')}
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main detail page
// ---------------------------------------------------------------------------

export function ContainerDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('logs');

  const { data: container, isPending, error, refetch } = useContainer(id);

  if (isPending) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error || !container) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-sm text-muted-foreground">
        <p className="text-destructive">{extractErrorMessage(error)}</p>
        <Button size="sm" variant="outline" onClick={() => void refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Top header */}
      <div className="flex flex-col gap-3 border-b bg-card px-6 py-4">
        <div className="flex items-center gap-2">
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => void navigate('/containers')}
            aria-label={t('common.back')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="font-mono text-lg font-semibold">
            {container.name.replace(/^\//, '')}
          </h1>
          <Badge variant={stateBadgeVariant(container.state)}>
            {t(`containers.state.${container.state}`, { defaultValue: container.state })}
          </Badge>
        </div>
        <div className="flex items-center justify-between gap-4">
          <p className="font-mono text-xs text-muted-foreground">{container.image}</p>
          <HeaderActions container={container} onRefresh={() => void refetch()} />
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <div className="border-b bg-card px-4">
          <TabsList className="h-10 rounded-none bg-transparent p-0">
            {(['logs', 'stats', 'inspect', 'exec'] as const).map((tab) => (
              <TabsTrigger
                key={tab}
                value={tab}
                className="rounded-none border-b-2 border-transparent px-4 py-2 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              >
                {t(`containers.tabs.${tab}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="flex-1 overflow-hidden">
          <TabsContent value="logs" className="m-0 h-full">
            <LogsTab containerId={id} active={activeTab === 'logs'} />
          </TabsContent>

          <TabsContent value="stats" className="m-0 h-full overflow-auto">
            <StatsTab containerId={id} active={activeTab === 'stats'} />
          </TabsContent>

          <TabsContent value="inspect" className="m-0 h-full">
            <InspectTab container={container} />
          </TabsContent>

          <TabsContent value="exec" className="m-0 h-full">
            <ExecTab containerId={id} active={activeTab === 'exec'} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
