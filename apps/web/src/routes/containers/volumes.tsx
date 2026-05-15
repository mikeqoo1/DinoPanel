import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Loader2, RefreshCw, Scissors } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { extractErrorMessage } from '@/lib/api';
import { useVolumes, useVolumeActions } from '@/hooks/use-volumes';
import type { PruneResult } from '@/hooks/use-volumes';
import type { Volume } from '@dinopanel/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

// ---------------------------------------------------------------------------
// Create Dialog
// ---------------------------------------------------------------------------

interface CreateVolumeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

function CreateVolumeDialog({ open, onOpenChange, onCreated }: CreateVolumeDialogProps) {
  const { t } = useTranslation();
  const { create, isCreating } = useVolumeActions();
  const [name, setName] = useState('');
  const [driver, setDriver] = useState('local');

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    try {
      await create({ name: trimmedName, driver: driver.trim() || 'local' });
      toast.success(t('volumes.create_success', { name: trimmedName }));
      onOpenChange(false);
      setName('');
      setDriver('local');
      onCreated();
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('volumes.create_dialog.title')}</DialogTitle>
          <DialogDescription>{t('volumes.create_dialog.desc')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="vol-name">{t('volumes.create_dialog.name_label')}</Label>
            <Input
              id="vol-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-volume"
              onKeyDown={(e) => { if (e.key === 'Enter') void handleSubmit(); }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vol-driver">{t('volumes.create_dialog.driver_label')}</Label>
            <Input
              id="vol-driver"
              value={driver}
              onChange={(e) => setDriver(e.target.value)}
              placeholder="local"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={!name.trim() || isCreating}>
            {isCreating && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('volumes.create_dialog.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Prune Dialog
// ---------------------------------------------------------------------------

interface PruneDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPruned: () => void;
}

function PruneDialog({ open, onOpenChange, onPruned }: PruneDialogProps) {
  const { t } = useTranslation();
  const { prune, isPruning } = useVolumeActions();
  const [result, setResult] = useState<PruneResult | null>(null);

  const handlePrune = async () => {
    try {
      const res = await prune();
      setResult(res);
      toast.success(
        t('volumes.prune_success', {
          count: res.volumesDeleted.length,
          space: formatBytes(res.spaceReclaimed),
        }),
      );
      onPruned();
    } catch (err) {
      toast.error(extractErrorMessage(err));
      onOpenChange(false);
    }
  };

  const handleClose = () => {
    setResult(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('volumes.prune_dialog.title')}</DialogTitle>
          <DialogDescription>{t('volumes.prune_dialog.desc')}</DialogDescription>
        </DialogHeader>

        {result && (
          <div className="rounded-md border bg-muted/50 p-3 text-sm">
            <p>
              {t('volumes.prune_dialog.result_count', { count: result.volumesDeleted.length })}
            </p>
            <p className="text-muted-foreground">
              {t('volumes.prune_dialog.result_space', {
                space: formatBytes(result.spaceReclaimed),
              })}
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {result ? t('common.close') : t('common.cancel')}
          </Button>
          {!result && (
            <Button variant="destructive" onClick={() => void handlePrune()} disabled={isPruning}>
              {isPruning && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('volumes.prune_dialog.submit')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Row actions
// ---------------------------------------------------------------------------

interface VolumeRowActionsProps {
  volume: Volume;
  onRemoved: () => void;
}

function VolumeRowActions({ volume, onRemoved }: VolumeRowActionsProps) {
  const { t } = useTranslation();
  const { remove, isRemoving } = useVolumeActions();
  const [confirmRemove, setConfirmRemove] = useState(false);

  const handleRemove = async () => {
    try {
      await remove(volume.name);
      toast.success(t('volumes.remove_success', { name: volume.name }));
      setConfirmRemove(false);
      onRemoved();
    } catch (err) {
      toast.error(extractErrorMessage(err));
      setConfirmRemove(false);
    }
  };

  return (
    <>
      <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100">
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={isRemoving}
          onClick={(e) => { e.stopPropagation(); setConfirmRemove(true); }}
          aria-label={t('volumes.action_remove')}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('volumes.remove_confirm_title')}</DialogTitle>
            <DialogDescription>
              {t('volumes.remove_confirm_desc', { name: volume.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRemove(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={isRemoving}
              onClick={() => void handleRemove()}
            >
              {isRemoving && <Loader2 className="h-4 w-4 animate-spin" />}
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

export function VolumesPage() {
  const { t } = useTranslation();
  const [showCreate, setShowCreate] = useState(false);
  const [showPrune, setShowPrune] = useState(false);
  const { data, isPending, error, refetch } = useVolumes();

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{t('volumes.title')}</h1>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void refetch()}>
            <RefreshCw className="h-3.5 w-3.5" />
            {t('volumes.refresh')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowPrune(true)}>
            <Scissors className="h-3.5 w-3.5" />
            {t('volumes.prune')}
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-3.5 w-3.5" />
            {t('volumes.create')}
          </Button>
        </div>
      </div>

      {/* Table card */}
      <div className="flex-1 overflow-auto rounded-lg border bg-card">
        {isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
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
                <th className="px-4 py-2 text-left font-medium">{t('volumes.col_name')}</th>
                <th className="w-24 px-4 py-2 text-left font-medium">{t('volumes.col_driver')}</th>
                <th className="px-4 py-2 text-left font-medium">{t('volumes.col_mountpoint')}</th>
                <th className="w-20 px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {!data || data.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center text-muted-foreground">
                    {t('volumes.empty')}
                  </td>
                </tr>
              ) : (
                data.map((vol) => (
                  <tr
                    key={vol.name}
                    className="group border-b border-transparent transition-colors hover:bg-accent/50"
                  >
                    <td className="px-4 py-2 font-medium">{vol.name}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{vol.driver}</td>
                    <td className="max-w-[280px] truncate px-4 py-2 font-mono text-xs text-muted-foreground">
                      {vol.mountpoint}
                    </td>
                    <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                      <VolumeRowActions volume={vol} onRemoved={() => void refetch()} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      <CreateVolumeDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreated={() => void refetch()}
      />
      <PruneDialog
        open={showPrune}
        onOpenChange={setShowPrune}
        onPruned={() => void refetch()}
      />
    </div>
  );
}
