import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Download, Trash2, RotateCcw, Plus } from 'lucide-react';
import type { BackupResponse, DbInstanceResponse } from '@dinopanel/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { extractErrorMessage } from '@/lib/api';
import { useInstanceBackups, useCreateBackup, useDeleteBackup, downloadBackupWithToast } from '@/hooks/use-backups';
import { RestoreBackupDialog } from './restore-backup-dialog';

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

interface Props {
  instance: DbInstanceResponse;
}

export function BackupsTabContent({ instance }: Props) {
  const { t } = useTranslation();
  const backups = useInstanceBackups(instance.id);
  const create = useCreateBackup();
  const del = useDeleteBackup();
  const [restoreTarget, setRestoreTarget] = useState<BackupResponse | null>(null);

  const handleCreate = async () => {
    try {
      const result = await create.mutateAsync({ id: instance.id });
      const size = fmtBytes(result.byteSize);
      const duration = (result.durationMs / 1000).toFixed(1) + 's';
      toast.success(t('backups.create_success', { size, duration }));
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  const handleDelete = async (backup: BackupResponse) => {
    if (!confirm(t('backups.delete_confirm'))) return;
    try {
      await del.mutateAsync({ backupId: backup.id });
      toast.success(t('backups.deleted'));
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  const handleDownload = (backup: BackupResponse) => {
    const filename = backup.filePath.split('/').pop() ?? `backup-${backup.id}.sql.gz`;
    void downloadBackupWithToast(backup.id, filename, t('backups.download_failed'));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          {t('backups.tab_backups')}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={create.isPending}
          onClick={handleCreate}
        >
          <Plus className="mr-1 h-4 w-4" />
          {t('backups.create_now')}
        </Button>
      </div>

      {backups.isPending ? (
        <Skeleton className="h-20 w-full" />
      ) : backups.error ? (
        <p className="text-sm text-destructive">{extractErrorMessage(backups.error)}</p>
      ) : !backups.data || backups.data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('backups.empty')}</p>
      ) : (
        <div className="space-y-1">
          {backups.data.items.map((backup) => (
            <div
              key={backup.id}
              className="flex items-center gap-2 rounded-md border p-2 text-xs"
            >
              <div className="flex-1 space-y-0.5">
                <div className="flex items-center gap-2">
                  <Badge
                    variant={backup.status === 'success' ? 'default' : 'destructive'}
                    className="text-[10px]"
                  >
                    {t(`backups.status.${backup.status}`)}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {t(`backups.source.${backup.source}`)}
                  </Badge>
                  <span className="text-muted-foreground">{fmtBytes(backup.byteSize)}</span>
                </div>
                <div className="text-muted-foreground">
                  {new Date(backup.createdAt).toLocaleString()}
                </div>
              </div>
              <div className="flex gap-1">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => handleDownload(backup)}
                  title={t('backups.download')}
                  disabled={backup.status !== 'success'}
                >
                  <Download className="h-3 w-3" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => setRestoreTarget(backup)}
                  title={t('backups.restore_action')}
                  disabled={backup.status !== 'success'}
                >
                  <RotateCcw className="h-3 w-3" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => handleDelete(backup)}
                  title={t('backups.delete')}
                  disabled={del.isPending}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {restoreTarget && (
        <RestoreBackupDialog
          open={restoreTarget !== null}
          onOpenChange={(open) => { if (!open) setRestoreTarget(null); }}
          backup={restoreTarget}
          instanceName={instance.name}
        />
      )}
    </div>
  );
}
