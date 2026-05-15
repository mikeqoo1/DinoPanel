import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Play,
  Square,
  RotateCcw,
  Pause,
  Trash2,
  RefreshCw,
  ArrowRight,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { extractErrorMessage } from '@/lib/api';
import { useContainers, useContainerAction } from '@/hooks/use-containers';
import type { Container, ContainerState } from '@dinopanel/shared';

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

function formatPorts(ports: Container['ports']): string {
  if (!ports.length) return '—';
  const mapped = ports.filter((p) => p.publicPort !== undefined);
  if (!mapped.length) return '—';
  return mapped
    .map((p) => `${p.publicPort}:${p.privatePort}/${p.type}`)
    .join(', ');
}

// ---------------------------------------------------------------------------
// Row action buttons (extracted so it can get its own mutation)
// ---------------------------------------------------------------------------

interface RowActionsProps {
  container: Container;
  onDeleted: () => void;
}

function RowActions({ container, onDeleted }: RowActionsProps) {
  const { t } = useTranslation();
  const { act, isPending } = useContainerAction(container.id);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const handle = async (action: Parameters<typeof act>[0]) => {
    setPendingAction(action);
    try {
      await act(action);
      toast.success(t(`containers.actions.${action}_success`, { defaultValue: 'Done' }));
      if (action === 'remove') onDeleted();
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setPendingAction(null);
    }
  };

  const isRunning = container.state === 'running';
  const isPaused = container.state === 'paused';

  return (
    <>
      <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100">
        {!isRunning && !isPaused && (
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={isPending}
            onClick={(e) => { e.stopPropagation(); void handle('start'); }}
            aria-label={t('containers.actions.start')}
          >
            {pendingAction === 'start' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5 text-green-600" />
            )}
          </Button>
        )}
        {isRunning && (
          <>
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={isPending}
              onClick={(e) => { e.stopPropagation(); void handle('pause'); }}
              aria-label={t('containers.actions.pause')}
            >
              {pendingAction === 'pause' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Pause className="h-3.5 w-3.5 text-yellow-600" />
              )}
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={isPending}
              onClick={(e) => { e.stopPropagation(); void handle('stop'); }}
              aria-label={t('containers.actions.stop')}
            >
              {pendingAction === 'stop' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Square className="h-3.5 w-3.5 text-destructive" />
              )}
            </Button>
          </>
        )}
        {isPaused && (
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={isPending}
            onClick={(e) => { e.stopPropagation(); void handle('unpause'); }}
            aria-label={t('containers.actions.unpause')}
          >
            {pendingAction === 'unpause' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5 text-green-600" />
            )}
          </Button>
        )}
        {(isRunning || isPaused) && (
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={isPending}
            onClick={(e) => { e.stopPropagation(); void handle('restart'); }}
            aria-label={t('containers.actions.restart')}
          >
            {pendingAction === 'restart' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
          </Button>
        )}
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={isPending}
          onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
          aria-label={t('containers.actions.remove')}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('containers.actions.remove_confirm_title')}</DialogTitle>
            <DialogDescription>
              {t('containers.actions.remove_confirm_desc', { name: container.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() => {
                setConfirmDelete(false);
                void handle('remove');
              }}
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const AUTO_REFRESH_MS = 10_000;

export function ContainersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [autoRefresh, setAutoRefresh] = useState(true);

  const { data, isPending, error, refetch } = useContainers(
    autoRefresh ? AUTO_REFRESH_MS : undefined,
  );

  const handleRowClick = (c: Container) => {
    void navigate(`/containers/${c.id}`);
  };

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{t('containers.title')}</h1>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={autoRefresh ? 'secondary' : 'ghost'}
            onClick={() => setAutoRefresh((v) => !v)}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', autoRefresh && 'animate-spin')} />
            {t('containers.auto_refresh')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void refetch()}>
            <RefreshCw className="h-3.5 w-3.5" />
            {t('containers.refresh')}
          </Button>
        </div>
      </div>

      {/* Table card */}
      <div className="flex-1 overflow-auto rounded-lg border bg-card">
        {isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
            <p className="text-destructive">{extractErrorMessage(error)}</p>
            <Button size="sm" variant="outline" onClick={() => void refetch()}>
              {t('common.retry')}
            </Button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="w-24 px-4 py-2 text-left font-medium">{t('containers.col_state')}</th>
                <th className="px-4 py-2 text-left font-medium">{t('containers.col_name')}</th>
                <th className="px-4 py-2 text-left font-medium">{t('containers.col_image')}</th>
                <th className="px-4 py-2 text-left font-medium">{t('containers.col_ports')}</th>
                <th className="px-4 py-2 text-left font-medium">{t('containers.col_created')}</th>
                <th className="w-36 px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {!data || data.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    {t('containers.empty')}
                  </td>
                </tr>
              ) : (
                data.map((c) => (
                  <tr
                    key={c.id}
                    className="group cursor-pointer border-b border-transparent transition-colors hover:bg-accent/50"
                    onClick={() => handleRowClick(c)}
                  >
                    <td className="px-4 py-2">
                      <Badge variant={stateBadgeVariant(c.state)}>
                        {t(`containers.state.${c.state}`, { defaultValue: c.state })}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 font-mono font-medium">
                      <div className="flex items-center gap-1.5">
                        <span>{c.name.replace(/^\//, '')}</span>
                        <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
                      </div>
                    </td>
                    <td className="max-w-[200px] truncate px-4 py-2 text-xs text-muted-foreground font-mono">
                      {c.image}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                      {formatPorts(c.ports)}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(c.createdAt * 1000), { addSuffix: true })}
                    </td>
                    <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                      <RowActions container={c} onDeleted={() => void refetch()} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
