import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, ShieldCheck, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import type {
  FirewallAction,
  FirewallProto,
  FirewallRule,
  StageFirewallRuleBody,
} from '@dinopanel/shared';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { extractErrorMessage } from '@/lib/api';
import {
  useFirewallStatus,
  useFirewallRules,
  useFirewallEnable,
  useFirewallDisable,
  useStageFirewallRule,
  useConfirmFirewallRule,
  useCancelFirewallRule,
  useRemoveFirewallRule,
} from '@/hooks/use-firewall';

const ROLLBACK_SECONDS = 30;

export function FirewallTab() {
  const { t } = useTranslation();
  const status = useFirewallStatus();
  const enabled = status.data?.enabled ?? false;
  const rules = useFirewallRules(!!status.data && status.error === null);

  const enableMut = useFirewallEnable();
  const disableMut = useFirewallDisable();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [rollback, setRollback] = useState<{ stagedId: number; expiresAt: number } | null>(null);

  if (status.isPending) return <Skeleton className="h-32 w-full" />;
  if (status.error) {
    const msg = extractErrorMessage(status.error);
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldAlert className="h-4 w-4" />
          {msg.includes('FIREWALL_NOT_CONFIGURED') || msg.includes('not configured')
            ? t('system.firewall.not_configured')
            : msg}
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          {enabled ? (
            <Badge variant="default" className="gap-1">
              <ShieldCheck className="h-3 w-3" />
              {t('system.firewall.status_enabled')}
            </Badge>
          ) : (
            <Badge variant="secondary">{t('system.firewall.status_disabled')}</Badge>
          )}
          <span className="text-xs text-muted-foreground">
            {t('system.firewall.backend')}: {status.data?.backend}
          </span>
          {status.data?.fail2ban && (
            <Badge variant="outline">{t('system.firewall.fail2ban_present')}</Badge>
          )}
        </div>
        <div className="flex gap-2">
          {enabled ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => disableMut.mutate()}
              disabled={disableMut.isPending}
            >
              {t('system.firewall.disable')}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => enableMut.mutate()}
              disabled={enableMut.isPending}
            >
              {t('system.firewall.enable')}
            </Button>
          )}
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            {t('system.firewall.add')}
          </Button>
        </div>
      </div>

      {rules.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : !rules.data || rules.data.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">{t('system.firewall.empty')}</Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="p-3 font-medium">{t('system.firewall.col_action')}</th>
                <th className="p-3 font-medium">{t('system.firewall.col_port')}</th>
                <th className="p-3 font-medium">{t('system.firewall.col_proto')}</th>
                <th className="p-3 font-medium">{t('system.firewall.col_source')}</th>
                <th className="p-3 font-medium">{t('system.firewall.col_comment')}</th>
                <th className="p-3 font-medium text-right">
                  {t('system.firewall.col_actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rules.data.map((rule, idx) => (
                <RuleRow key={`${rule.id ?? 'ext'}-${idx}`} rule={rule} />
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <AddRuleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onStaged={(staged) => setRollback(staged)}
      />
      <RollbackModal
        rollback={rollback}
        onClose={() => setRollback(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function RuleRow({ rule }: { rule: FirewallRule }) {
  const { t } = useTranslation();
  const remove = useRemoveFirewallRule();

  const handleRemove = async () => {
    if (!rule.id) return;
    if (!confirm(t('system.firewall.remove_confirm', { port: rule.port, proto: rule.proto }))) {
      return;
    }
    try {
      await remove.mutateAsync(rule.id);
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  return (
    <tr className="border-t">
      <td className="p-3">
        <Badge variant={rule.action === 'allow' ? 'default' : 'destructive'}>
          {t(`system.firewall.action.${rule.action}`)}
        </Badge>
      </td>
      <td className="p-3 font-mono">{rule.port}</td>
      <td className="p-3 font-mono">{rule.proto}</td>
      <td className="p-3 font-mono text-xs">{rule.source ?? '—'}</td>
      <td className="p-3 text-muted-foreground">
        <div className="flex items-center gap-2">
          {rule.comment ?? '—'}
          {rule.external && <Badge variant="outline">{t('system.firewall.external_badge')}</Badge>}
        </div>
      </td>
      <td className="p-3">
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            disabled={!rule.id || remove.isPending}
            onClick={handleRemove}
            title={t('system.firewall.remove')}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------

function AddRuleDialog({
  open,
  onOpenChange,
  onStaged,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  onStaged: (s: { stagedId: number; expiresAt: number }) => void;
}) {
  const { t } = useTranslation();
  const stage = useStageFirewallRule();
  const status = useFirewallStatus();
  const panelPort = 9999;
  const sshPort = 22;

  const [action, setAction] = useState<FirewallAction>('allow');
  const [port, setPort] = useState<number>(0);
  const [proto, setProto] = useState<FirewallProto>('tcp');
  const [source, setSource] = useState('');
  const [comment, setComment] = useState('');
  const [ackSelfLockout, setAckSelfLockout] = useState(false);

  const needsAck =
    action === 'deny' && (port === panelPort || port === sshPort);

  const handleSubmit = async () => {
    const body: StageFirewallRuleBody = {
      port,
      proto,
      action,
      source: source.trim() || undefined,
      comment: comment.trim() || undefined,
      acknowledgeSelfLockout: ackSelfLockout || undefined,
    };
    try {
      const result = await stage.mutateAsync(body);
      onStaged(result);
      onOpenChange(false);
      // reset
      setAction('allow');
      setPort(0);
      setProto('tcp');
      setSource('');
      setComment('');
      setAckSelfLockout(false);
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('system.firewall.dialog.title')}</DialogTitle>
          {status.data && (
            <DialogDescription>{status.data.backend}</DialogDescription>
          )}
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>{t('system.firewall.dialog.action_label')}</Label>
            <select
              className="block w-full rounded-md border bg-background p-2 text-sm"
              value={action}
              onChange={(e) => setAction(e.target.value as FirewallAction)}
            >
              <option value="allow">{t('system.firewall.action.allow')}</option>
              <option value="deny">{t('system.firewall.action.deny')}</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label>{t('system.firewall.dialog.port_label')}</Label>
              <Input
                type="number"
                min={0}
                max={65535}
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('system.firewall.dialog.proto_label')}</Label>
              <select
                className="block w-full rounded-md border bg-background p-2 text-sm"
                value={proto}
                onChange={(e) => setProto(e.target.value as FirewallProto)}
              >
                <option value="tcp">tcp</option>
                <option value="udp">udp</option>
                <option value="any">any</option>
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t('system.firewall.dialog.source_label')}</Label>
            <Input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="10.0.0.0/8"
            />
          </div>
          <div className="space-y-2">
            <Label>{t('system.firewall.dialog.comment_label')}</Label>
            <Input value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
          {needsAck && (
            <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={ackSelfLockout}
                  onChange={(e) => setAckSelfLockout(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  {t('system.firewall.dialog.self_lockout_warning')}
                  <br />
                  {t('system.firewall.dialog.ack_self_lockout')}
                </span>
              </label>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={port <= 0 || stage.isPending || (needsAck && !ackSelfLockout)}
          >
            {t('system.firewall.dialog.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

function RollbackModal({
  rollback,
  onClose,
}: {
  rollback: { stagedId: number; expiresAt: number } | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const confirm = useConfirmFirewallRule();
  const cancel = useCancelFirewallRule();
  const [remaining, setRemaining] = useState(ROLLBACK_SECONDS);

  useEffect(() => {
    if (!rollback) return;
    setRemaining(Math.max(0, Math.floor((rollback.expiresAt - Date.now()) / 1000)));
    const id = setInterval(() => {
      const secs = Math.max(0, Math.floor((rollback.expiresAt - Date.now()) / 1000));
      setRemaining(secs);
      if (secs <= 0) {
        clearInterval(id);
        onClose();
      }
    }, 250);
    return () => clearInterval(id);
  }, [rollback, onClose]);

  if (!rollback) return null;

  const handleConfirm = async () => {
    try {
      await confirm.mutateAsync(rollback.stagedId);
      onClose();
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  const handleCancel = async () => {
    try {
      await cancel.mutateAsync(rollback.stagedId);
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      onClose();
    }
  };

  return (
    <Dialog open={true} onOpenChange={(b) => !b && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('system.firewall.rollback.title')}</DialogTitle>
          <DialogDescription>
            {t('system.firewall.rollback.body', { seconds: remaining })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-center py-6">
          <div className="text-5xl font-bold tabular-nums">{remaining}s</div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={cancel.isPending}
          >
            {cancel.isPending
              ? t('system.firewall.rollback.reverting')
              : t('system.firewall.rollback.cancel')}
          </Button>
          <Button onClick={handleConfirm} disabled={confirm.isPending}>
            {t('system.firewall.rollback.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
