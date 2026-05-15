import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Loader2, RefreshCw } from 'lucide-react';
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
import { useNetworks, useNetworkActions } from '@/hooks/use-networks';
import type { Network } from '@dinopanel/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Docker's built-in networks that cannot be removed. */
const BUILT_IN_NETWORKS = new Set(['bridge', 'host', 'none']);

// ---------------------------------------------------------------------------
// Create Dialog
// ---------------------------------------------------------------------------

interface CreateNetworkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

function CreateNetworkDialog({ open, onOpenChange, onCreated }: CreateNetworkDialogProps) {
  const { t } = useTranslation();
  const { create, isCreating } = useNetworkActions();
  const [name, setName] = useState('');
  const [driver, setDriver] = useState('bridge');
  const [internal, setInternal] = useState(false);

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    try {
      await create({ name: trimmedName, driver, internal });
      toast.success(t('networks.create_success', { name: trimmedName }));
      onOpenChange(false);
      setName('');
      setDriver('bridge');
      setInternal(false);
      onCreated();
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  const drivers = ['bridge', 'host', 'overlay', 'macvlan'];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('networks.create_dialog.title')}</DialogTitle>
          <DialogDescription>{t('networks.create_dialog.desc')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="net-name">{t('networks.create_dialog.name_label')}</Label>
            <Input
              id="net-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-network"
              onKeyDown={(e) => { if (e.key === 'Enter') void handleSubmit(); }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="net-driver">{t('networks.create_dialog.driver_label')}</Label>
            <select
              id="net-driver"
              value={driver}
              onChange={(e) => setDriver(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {drivers.map((d) => (
                <option key={d} value={d}>
                  {t(`networks.driver.${d}`, { defaultValue: d })}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input
              id="net-internal"
              type="checkbox"
              checked={internal}
              onChange={(e) => setInternal(e.target.checked)}
              className="h-4 w-4 rounded border border-input"
            />
            <Label htmlFor="net-internal" className="cursor-pointer font-normal">
              {t('networks.create_dialog.internal_label')}
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={!name.trim() || isCreating}>
            {isCreating && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('networks.create_dialog.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Row actions
// ---------------------------------------------------------------------------

interface NetworkRowActionsProps {
  network: Network;
  onRemoved: () => void;
}

function NetworkRowActions({ network, onRemoved }: NetworkRowActionsProps) {
  const { t } = useTranslation();
  const { remove, isRemoving } = useNetworkActions();
  const [confirmRemove, setConfirmRemove] = useState(false);

  const isBuiltIn = BUILT_IN_NETWORKS.has(network.name);

  const handleRemove = async () => {
    try {
      await remove(network.id);
      toast.success(t('networks.remove_success', { name: network.name }));
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
          disabled={isRemoving || isBuiltIn}
          title={isBuiltIn ? t('networks.builtin_tooltip') : undefined}
          onClick={(e) => { e.stopPropagation(); setConfirmRemove(true); }}
          aria-label={t('networks.action_remove')}
          className="text-destructive hover:text-destructive disabled:opacity-30"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('networks.remove_confirm_title')}</DialogTitle>
            <DialogDescription>
              {t('networks.remove_confirm_desc', { name: network.name })}
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

export function NetworksPage() {
  const { t } = useTranslation();
  const [showCreate, setShowCreate] = useState(false);
  const { data, isPending, error, refetch } = useNetworks();

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{t('networks.title')}</h1>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void refetch()}>
            <RefreshCw className="h-3.5 w-3.5" />
            {t('networks.refresh')}
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-3.5 w-3.5" />
            {t('networks.create')}
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
                <th className="w-28 px-4 py-2 text-left font-medium">{t('networks.col_id')}</th>
                <th className="px-4 py-2 text-left font-medium">{t('networks.col_name')}</th>
                <th className="w-28 px-4 py-2 text-left font-medium">{t('networks.col_driver')}</th>
                <th className="w-24 px-4 py-2 text-left font-medium">{t('networks.col_scope')}</th>
                <th className="w-20 px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {!data || data.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">
                    {t('networks.empty')}
                  </td>
                </tr>
              ) : (
                data.map((net) => (
                  <tr
                    key={net.id}
                    className="group border-b border-transparent transition-colors hover:bg-accent/50"
                  >
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                      {net.id.slice(0, 12)}
                    </td>
                    <td className="px-4 py-2 font-medium">{net.name}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {t(`networks.driver.${net.driver}`, { defaultValue: net.driver })}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{net.scope}</td>
                    <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                      <NetworkRowActions network={net} onRemoved={() => void refetch()} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      <CreateNetworkDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreated={() => void refetch()}
      />
    </div>
  );
}
