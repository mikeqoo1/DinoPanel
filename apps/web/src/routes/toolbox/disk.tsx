import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { CleanCategory } from '@dinopanel/shared';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatBytes } from '@/lib/utils';
import { extractErrorMessage } from '@/lib/api';
import { useToolboxStatus, useDiskUsage, useCleaners, useRunCleaner } from '@/hooks/use-toolbox';

export function DiskTab() {
  const { t } = useTranslation();
  const status = useToolboxStatus();
  const feature = status.data?.features.find((f) => f.name === 'disk');
  const available = feature?.available ?? false;

  const [breakdownPath, setBreakdownPath] = useState<string | undefined>(undefined);
  const disk = useDiskUsage(breakdownPath, !!status.data && available);
  const cleaners = useCleaners(!!status.data);
  const [cleanTarget, setCleanTarget] = useState<CleanCategory | null>(null);

  if (status.isPending) return <Skeleton className="h-32 w-full" />;
  if (status.error) {
    return <Card className="p-6 text-sm text-destructive">{extractErrorMessage(status.error)}</Card>;
  }

  return (
    <div className="space-y-6">
      {/* Filesystems */}
      {!available ? (
        <Card className="p-6 text-sm text-muted-foreground">{t('toolbox.disk.not_configured')}</Card>
      ) : disk.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : disk.error ? (
        <Card className="p-6 text-sm text-destructive">{extractErrorMessage(disk.error)}</Card>
      ) : (
        <>
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="p-3 font-medium">{t('toolbox.disk.col_source')}</th>
                  <th className="p-3 font-medium">{t('toolbox.disk.col_mount')}</th>
                  <th className="p-3 font-medium">{t('toolbox.disk.col_used')}</th>
                  <th className="p-3 font-medium">{t('toolbox.disk.col_total')}</th>
                  <th className="p-3 font-medium">{t('toolbox.disk.col_pct')}</th>
                </tr>
              </thead>
              <tbody>
                {disk.data!.filesystems.map((fs) => (
                  <tr key={`${fs.source}-${fs.mount}`} className="border-t">
                    <td className="p-3 font-mono text-xs">{fs.source}</td>
                    <td className="p-3 font-mono text-xs">{fs.mount}</td>
                    <td className="p-3">{formatBytes(fs.used)}</td>
                    <td className="p-3">{formatBytes(fs.total)}</td>
                    <td className="p-3">{fs.usePercent === null ? '—' : `${fs.usePercent}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* Per-directory breakdown */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-muted-foreground">
                {t('toolbox.disk.breakdown_title')}
              </span>
              <select
                className="rounded-md border bg-background p-1.5 text-sm"
                value={breakdownPath ?? ''}
                onChange={(e) => setBreakdownPath(e.target.value || undefined)}
              >
                <option value="">{t('toolbox.disk.breakdown_pick')}</option>
                {(disk.data!.safeRoots ?? []).map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            {disk.data!.breakdown && (
              <Card className="overflow-hidden">
                <table className="w-full text-sm">
                  <tbody>
                    {disk.data!.breakdown.entries.map((e) => (
                      <tr key={e.path} className="border-t">
                        <td className="p-3 font-mono text-xs">{e.path}</td>
                        <td className="p-3 text-right">{formatBytes(e.bytes)}</td>
                      </tr>
                    ))}
                    {disk.data!.breakdown.entries.length === 0 && (
                      <tr>
                        <td className="p-3 text-sm text-muted-foreground">
                          {t('toolbox.disk.breakdown_empty')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </Card>
            )}
          </div>
        </>
      )}

      {/* Cleaners */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">
          {t('toolbox.disk.cleaners_title')}
        </h2>
        {cleaners.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : cleaners.error ? (
          <Card className="p-6 text-sm text-destructive">{extractErrorMessage(cleaners.error)}</Card>
        ) : (
          <div className="grid gap-2 md:grid-cols-3">
            {cleaners.data?.cleaners.map((c) => (
              <Card key={c.category} className="space-y-2 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{t(`toolbox.disk.category.${c.category}`)}</span>
                  {c.available ? (
                    <Badge variant="success">{t('toolbox.disk.ready')}</Badge>
                  ) : (
                    <Badge variant="muted">{t('toolbox.disk.unavailable')}</Badge>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={!c.available}
                  onClick={() => setCleanTarget(c.category)}
                >
                  {t('toolbox.disk.clean')}
                </Button>
              </Card>
            ))}
          </div>
        )}
      </div>

      <CleanConfirmDialog
        category={cleanTarget}
        onClose={() => setCleanTarget(null)}
      />
    </div>
  );
}

// Type-to-confirm: the destructive action is gated on typing the category name
// (mirrors routes/databases/restore-backup-dialog.tsx).
function CleanConfirmDialog({
  category,
  onClose,
}: {
  category: CleanCategory | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const run = useRunCleaner();
  const [confirmInput, setConfirmInput] = useState('');
  const open = category !== null;

  useEffect(() => {
    if (open) setConfirmInput('');
  }, [open]);

  if (!category) return null;

  const submit = async () => {
    try {
      const res = await run.mutateAsync(category);
      toast.success(
        t('toolbox.disk.cleaned_toast', {
          detail: res.freedBytes != null ? formatBytes(res.freedBytes) : res.detail,
        }),
      );
      onClose();
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('toolbox.disk.confirm_title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive">
            {t('toolbox.disk.confirm_warning')}
          </div>
          <p className="text-xs text-muted-foreground">
            {t('toolbox.disk.confirm_label', { category })}
          </p>
          <Input
            value={confirmInput}
            onChange={(e) => setConfirmInput(e.target.value)}
            placeholder={category}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={confirmInput !== category || run.isPending}
            onClick={submit}
          >
            {t('toolbox.disk.clean')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
