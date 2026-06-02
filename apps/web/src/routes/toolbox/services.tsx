import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { type ServiceUnit, type SystemdAction, serviceActionAllowed } from '@dinopanel/shared';
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
import { extractErrorMessage } from '@/lib/api';
import { useToolboxStatus, useServicesList, useServiceAction } from '@/hooks/use-toolbox';

const ACTIONS: SystemdAction[] = ['start', 'stop', 'restart', 'enable', 'disable'];

function activeBadgeVariant(activeState: string): 'success' | 'destructive' | 'muted' {
  if (activeState === 'active') return 'success';
  if (activeState === 'failed') return 'destructive';
  return 'muted';
}

export function ServicesTab() {
  const { t } = useTranslation();
  const status = useToolboxStatus();
  const feature = status.data?.features.find((f) => f.name === 'services');
  const available = feature?.available ?? false;

  const services = useServicesList(!!status.data && available);
  const [pending, setPending] = useState<{ unit: string; action: SystemdAction } | null>(null);
  const [filter, setFilter] = useState('');

  if (status.isPending) return <Skeleton className="h-32 w-full" />;
  if (status.error) {
    return <Card className="p-6 text-sm text-destructive">{extractErrorMessage(status.error)}</Card>;
  }
  if (!available) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">{t('toolbox.services.not_configured')}</Card>
    );
  }
  if (services.isPending) return <Skeleton className="h-32 w-full" />;
  if (services.error) {
    return <Card className="p-6 text-sm text-destructive">{extractErrorMessage(services.error)}</Card>;
  }

  const needle = filter.trim().toLowerCase();
  const rows = needle
    ? services.data!.filter(
        (u) => u.name.toLowerCase().includes(needle) || u.description.toLowerCase().includes(needle),
      )
    : services.data!;

  return (
    <div className="space-y-3">
      <Input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={t('toolbox.services.filter_ph')}
        className="max-w-xs"
      />
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="p-3 font-medium">{t('toolbox.services.col_name')}</th>
              <th className="p-3 font-medium">{t('toolbox.services.col_state')}</th>
              <th className="p-3 font-medium">{t('toolbox.services.col_enabled')}</th>
              <th className="p-3 font-medium">{t('toolbox.services.col_actions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u: ServiceUnit) => (
              <tr key={u.name} className="border-t align-top">
                <td className="p-3">
                  <div className="font-mono text-xs">{u.name}</div>
                  {u.description && (
                    <div className="text-xs text-muted-foreground">{u.description}</div>
                  )}
                </td>
                <td className="p-3">
                  <Badge variant={activeBadgeVariant(u.activeState)}>{u.activeState}</Badge>
                  <span className="ml-1 text-xs text-muted-foreground">{u.subState}</span>
                </td>
                <td className="p-3 text-xs">{u.enabledState ?? '—'}</td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-1">
                    {ACTIONS.map((action) => {
                      const verdict = serviceActionAllowed(u.name, action);
                      return (
                        <Button
                          key={action}
                          size="sm"
                          variant={action === 'stop' || action === 'disable' ? 'destructive' : 'outline'}
                          disabled={!verdict.allowed}
                          title={verdict.allowed ? undefined : verdict.reason}
                          onClick={() => setPending({ unit: u.name, action })}
                        >
                          {t(`toolbox.services.${action}`)}
                        </Button>
                      );
                    })}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="p-3 text-sm text-muted-foreground">
                  {t('toolbox.services.empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <ServiceActionDialog pending={pending} onClose={() => setPending(null)} />
    </div>
  );
}

function ServiceActionDialog({
  pending,
  onClose,
}: {
  pending: { unit: string; action: SystemdAction } | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const run = useServiceAction();
  const open = pending !== null;

  if (!pending) return null;

  const submit = async () => {
    try {
      await run.mutateAsync(pending);
      toast.success(t('toolbox.services.done_toast', { action: pending.action, unit: pending.unit }));
      onClose();
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  const destructive = pending.action === 'stop' || pending.action === 'disable';

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('toolbox.services.confirm_title')}</DialogTitle>
        </DialogHeader>
        <p className="text-sm">
          {t('toolbox.services.confirm_body', {
            action: t(`toolbox.services.${pending.action}`),
            unit: pending.unit,
          })}
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            disabled={run.isPending}
            onClick={submit}
          >
            {t(`toolbox.services.${pending.action}`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
