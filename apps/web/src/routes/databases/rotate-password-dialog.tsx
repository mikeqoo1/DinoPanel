import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { extractErrorMessage } from '@/lib/api';
import { useRotatePassword } from '@/hooks/use-databases';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instanceId: number;
  instanceName: string;
}

/**
 * Surfaces the brief-downtime contract before letting the operator
 * rotate. Server-side path stops + recreates the container with the
 * same data dir, which drops live connections (decisions Q3
 * Implications + spec.md WARN).
 */
export function RotatePasswordDialog({
  open,
  onOpenChange,
  instanceId,
  instanceName,
}: Props) {
  const { t } = useTranslation();
  const rotate = useRotatePassword();

  const submit = async () => {
    try {
      const result = await rotate.mutateAsync(instanceId);
      toast.success(
        t('databases.rotate.done', {
          name: instanceName,
          // Truncate the new password in the toast — full value lives
          // in the drawer's connection card.
          password: result.password.slice(0, 8) + '…',
        }),
      );
      onOpenChange(false);
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('databases.rotate.title', { name: instanceName })}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p>{t('databases.rotate.body')}</p>
          <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
            <li>{t('databases.rotate.downtime_bullet')}</li>
            <li>{t('databases.rotate.app_configs_bullet')}</li>
            <li>{t('databases.rotate.irreversible_bullet')}</li>
          </ul>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={rotate.isPending}
          >
            {t('databases.rotate.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
