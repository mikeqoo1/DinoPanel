import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { BackupResponse } from '@dinopanel/shared';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { extractErrorMessage } from '@/lib/api';
import { useRestoreBackup } from '@/hooks/use-backups';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  backup: BackupResponse;
  instanceName: string;
  onRestored?: () => void;
}

export function RestoreBackupDialog({ open, onOpenChange, backup, instanceName, onRestored }: Props) {
  const { t } = useTranslation();
  const restore = useRestoreBackup();
  const [confirmInput, setConfirmInput] = useState('');

  useEffect(() => {
    if (open) setConfirmInput('');
  }, [open]);

  const submit = async () => {
    try {
      await restore.mutateAsync({ backupId: backup.id, body: { confirm: confirmInput } });
      toast.success(t('backups.restore.done'));
      onRestored?.();
      onOpenChange(false);
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('backups.restore.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive">
            <p>{t('backups.restore.warning')}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              {t('backups.restore.confirm_label', { name: instanceName })}
            </p>
            <Input
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              placeholder={t('backups.restore.confirm_placeholder', { name: instanceName })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={confirmInput !== instanceName || restore.isPending}
          >
            {t('backups.restore.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
