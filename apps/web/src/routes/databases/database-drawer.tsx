import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Copy, ExternalLink, KeyRound, Play, RefreshCw, RotateCcw, Square, Trash2 } from 'lucide-react';
import type { DbInstanceResponse } from '@dinopanel/shared';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { extractErrorMessage } from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';
import {
  useDbMetrics,
  useDeleteDatabase,
  useRestartDatabase,
  useStartDatabase,
  useStopDatabase,
} from '@/hooks/use-databases';
import { ENGINE_META } from './engine-meta';
import { pmmCardState } from './pmm-card-state';
import { RotatePasswordDialog } from './rotate-password-dialog';

interface Props {
  instance: DbInstanceResponse | null;
  onOpenChange: (open: boolean) => void;
  pmmUrl: string | null;
}

export function DatabaseDrawer({ instance, onOpenChange, pmmUrl }: Props) {
  const { t } = useTranslation();
  const [rotateOpen, setRotateOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <Sheet
      open={instance !== null}
      onOpenChange={(open) => {
        if (!open) onOpenChange(false);
      }}
    >
      <SheetContent closeLabel={t('common.close')}>
        {instance && (
          <DrawerBody
            instance={instance}
            pmmUrl={pmmUrl}
            onRotate={() => setRotateOpen(true)}
            confirmDelete={confirmDelete}
            setConfirmDelete={setConfirmDelete}
            onDeleted={() => onOpenChange(false)}
          />
        )}
        {instance && (
          <RotatePasswordDialog
            open={rotateOpen}
            onOpenChange={setRotateOpen}
            instanceId={instance.id}
            instanceName={instance.name}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

interface BodyProps {
  instance: DbInstanceResponse;
  pmmUrl: string | null;
  onRotate: () => void;
  confirmDelete: boolean;
  setConfirmDelete: (v: boolean) => void;
  onDeleted: () => void;
}

function DrawerBody({
  instance,
  pmmUrl,
  onRotate,
  confirmDelete,
  setConfirmDelete,
  onDeleted,
}: BodyProps) {
  const { t } = useTranslation();
  const meta = ENGINE_META[instance.engine];
  const metrics = useDbMetrics(instance.id);
  const start = useStartDatabase();
  const stop = useStopDatabase();
  const restart = useRestartDatabase();
  const del = useDeleteDatabase();

  const [dropData, setDropData] = useState(false);

  const copyText = async (value: string, label: string) => {
    // copyToClipboard handles the navigator.clipboard / execCommand
    // fallback chain for non-secure contexts (HTTP + non-localhost).
    const ok = await copyToClipboard(value);
    if (ok) {
      toast.success(t('databases.drawer.copied', { label }));
    } else {
      toast.error(t('databases.drawer.copy_failed'));
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <Badge variant="outline" className={meta.badgeClass}>
            {t(meta.labelKey)}
          </Badge>
          <span>{instance.name}</span>
        </SheetTitle>
        <SheetDescription>
          {instance.containerName}
          {instance.status !== 'running' && (
            <span className="ml-2 text-amber-500">
              · {t(`databases.status.${instance.status}`)}
            </span>
          )}
        </SheetDescription>
      </SheetHeader>

      {/* Connection card */}
      <section className="space-y-2 rounded-md border p-3">
        <div className="text-xs font-medium text-muted-foreground">
          {t('databases.drawer.connection')}
        </div>
        <Field label="Host" value="127.0.0.1" onCopy={copyText} />
        <Field label="Port" value={String(instance.port)} onCopy={copyText} />
        <Field
          label={t('databases.drawer.username')}
          value={instance.username}
          onCopy={copyText}
        />
        <Field
          label={t('databases.drawer.password')}
          value={instance.password}
          onCopy={copyText}
          mono
        />
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          onClick={onRotate}
        >
          <KeyRound className="mr-1 h-4 w-4" />
          {t('databases.drawer.rotate_password')}
        </Button>
      </section>

      {/* PMM summary */}
      {pmmUrl ? (
        <section className="space-y-2 rounded-md border p-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-muted-foreground">
              {t('databases.drawer.pmm_summary')}
            </div>
            <a
              href={pmmUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              {t('databases.drawer.open_in_pmm')}
            </a>
          </div>
          {(() => {
            const state = pmmCardState({
              isPending: metrics.isPending,
              data: metrics.data,
              pmmRegistered: instance.pmmRegistered,
            });
            if (state === 'pending') {
              return <Skeleton className="h-16 w-full" />;
            }
            if (state === 'not-configured') {
              return (
                <p className="text-xs text-muted-foreground">
                  {t('databases.drawer.pmm_not_configured')}
                </p>
              );
            }
            if (state === 'not-registered') {
              return (
                <p className="text-xs text-muted-foreground">
                  {t('databases.drawer.pmm_not_registered')}
                </p>
              );
            }
            if (state === 'exporter-unhealthy') {
              return (
                <p className="text-xs text-muted-foreground">
                  {t('databases.drawer.pmm_exporter_unhealthy')}
                </p>
              );
            }
            return (
              <div className="grid grid-cols-2 gap-2">
                <MetricCard
                  label={t('databases.metrics.qps')}
                  value={metrics.data?.qps}
                  fmt={(v) => v.toFixed(1)}
                />
                <MetricCard
                  label={t('databases.metrics.connections')}
                  value={metrics.data?.connections}
                  fmt={(v) => v.toFixed(0)}
                />
                <MetricCard
                  label={t('databases.metrics.uptime')}
                  value={metrics.data?.uptimeSeconds}
                  fmt={fmtDuration}
                />
                <MetricCard
                  label={t('databases.metrics.replication_lag')}
                  value={metrics.data?.replicationLagSeconds}
                  fmt={(v) => `${v.toFixed(2)} s`}
                />
              </div>
            );
          })()}
        </section>
      ) : null}

      {/* Lifecycle */}
      <section className="space-y-2 rounded-md border p-3">
        <div className="text-xs font-medium text-muted-foreground">
          {t('databases.drawer.lifecycle')}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={instance.status === 'running' || start.isPending}
            onClick={() =>
              start.mutateAsync(instance.id).catch((err) =>
                toast.error(extractErrorMessage(err)),
              )
            }
          >
            <Play className="mr-1 h-4 w-4" />
            {t('common.start')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={instance.status !== 'running' || stop.isPending}
            onClick={() =>
              stop.mutateAsync(instance.id).catch((err) =>
                toast.error(extractErrorMessage(err)),
              )
            }
          >
            <Square className="mr-1 h-4 w-4" />
            {t('common.stop')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={restart.isPending}
            onClick={() =>
              restart.mutateAsync(instance.id).catch((err) =>
                toast.error(extractErrorMessage(err)),
              )
            }
          >
            <RotateCcw className="mr-1 h-4 w-4" />
            {t('common.restart')}
          </Button>
        </div>
        <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs">
          <p className="mb-2 font-medium text-destructive">
            {t('databases.drawer.delete_warning_title')}
          </p>
          <label className="mb-2 flex items-start gap-2">
            <input
              type="checkbox"
              checked={dropData}
              onChange={(e) => setDropData(e.target.checked)}
              className="mt-1"
            />
            <span>{t('databases.drawer.drop_data_checkbox')}</span>
          </label>
          {confirmDelete ? (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                disabled={del.isPending}
                onClick={async () => {
                  try {
                    await del.mutateAsync({
                      id: instance.id,
                      body: { dropData },
                    });
                    toast.success(t('databases.drawer.deleted'));
                    onDeleted();
                  } catch (err) {
                    toast.error(extractErrorMessage(err));
                  }
                }}
              >
                <Trash2 className="mr-1 h-4 w-4" />
                {t('databases.drawer.confirm_delete')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirmDelete(false)}
              >
                {t('common.cancel')}
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="mr-1 h-4 w-4" />
              {t('databases.drawer.delete_instance')}
            </Button>
          )}
        </div>
      </section>

      <p className="mt-auto text-xs text-muted-foreground">
        {t('databases.drawer.data_dir', { path: instance.dataDir })}
      </p>
    </div>
  );
}

function Field({
  label,
  value,
  onCopy,
  mono,
}: {
  label: string;
  value: string;
  onCopy: (v: string, label: string) => void;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-24 shrink-0 text-xs text-muted-foreground">{label}</span>
      <code
        className={`flex-1 truncate rounded bg-muted/40 px-2 py-1 ${
          mono ? 'font-mono text-xs' : 'text-xs'
        }`}
      >
        {value}
      </code>
      <Button
        size="icon-sm"
        variant="ghost"
        onClick={() => onCopy(value, label)}
        aria-label={`Copy ${label}`}
      >
        <Copy className="h-3 w-3" />
      </Button>
    </div>
  );
}

function MetricCard({
  label,
  value,
  fmt,
}: {
  label: string;
  value: number | null | undefined;
  fmt: (v: number) => string;
}) {
  return (
    <div className="rounded-md border bg-muted/20 p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">
        {value === null || value === undefined ? '—' : fmt(value)}
      </div>
    </div>
  );
}

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} m`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86_400)} d`;
}

// Silence unused-import for icons referenced via lucide-react import.
void RefreshCw;
