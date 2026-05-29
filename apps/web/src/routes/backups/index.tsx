import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, RefreshCw, Download, Trash2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import type { BackupResponse } from '@dinopanel/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { extractErrorMessage } from '@/lib/api';
import { useBackupsList, useDeleteBackup, downloadBackupWithToast } from '@/hooks/use-backups';
import { ENGINE_META } from '@/routes/databases/engine-meta';
import { RestoreBackupDialog } from '@/routes/databases/restore-backup-dialog';

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function BackupsPage() {
  const { t } = useTranslation();
  const list = useBackupsList({});
  const del = useDeleteBackup();
  const [restoreTarget, setRestoreTarget] = useState<BackupResponse | null>(null);

  const allItems = list.data?.pages.flatMap((p) => p.items) ?? [];

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
    <div className="space-y-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Archive className="h-5 w-5" />
          <h1 className="text-xl font-semibold">{t('backups.title')}</h1>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={list.isFetching}
          onClick={() => list.refetch()}
        >
          <RefreshCw className="mr-1 h-4 w-4" />
          {t('backups.refresh')}
        </Button>
      </header>

      {list.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : list.error ? (
        <Card className="p-6 text-sm text-destructive">
          {extractErrorMessage(list.error)}
        </Card>
      ) : allItems.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">
          {t('backups.empty')}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="p-3 font-medium">{t('backups.col_instance')}</th>
                <th className="p-3 font-medium">{t('backups.col_engine')}</th>
                <th className="p-3 font-medium">{t('backups.col_source')}</th>
                <th className="p-3 font-medium">{t('backups.col_size')}</th>
                <th className="p-3 font-medium">{t('backups.col_created')}</th>
                <th className="p-3 font-medium">{t('backups.col_status')}</th>
                <th className="p-3 font-medium text-right">{t('backups.col_actions')}</th>
              </tr>
            </thead>
            <tbody>
              {allItems.map((backup) => {
                const meta = ENGINE_META[backup.engine];
                return (
                  <tr key={backup.id} className="border-t hover:bg-muted/20">
                    <td className="p-3 font-mono text-xs">{backup.instanceName}</td>
                    <td className="p-3 text-xs">
                      <Badge variant="outline" className={meta.badgeClass}>
                        {t(meta.labelKey)}
                      </Badge>
                    </td>
                    <td className="p-3 text-xs">
                      <Badge variant="secondary">
                        {t(`backups.source.${backup.source}`)}
                      </Badge>
                    </td>
                    <td className="p-3 text-xs">{fmtBytes(backup.byteSize)}</td>
                    <td className="p-3 text-xs">
                      {new Date(backup.createdAt).toLocaleString()}
                    </td>
                    <td className="p-3 text-xs">
                      <Badge variant={backup.status === 'success' ? 'default' : 'destructive'}>
                        {t(`backups.status.${backup.status}`)}
                      </Badge>
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDownload(backup)}
                          title={t('backups.download')}
                          disabled={backup.status !== 'success'}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setRestoreTarget(backup)}
                          title={t('backups.restore_action')}
                          disabled={backup.status !== 'success'}
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDelete(backup)}
                          title={t('backups.delete')}
                          disabled={del.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {list.hasNextPage && (
            <div className="flex justify-center border-t p-3">
              <Button
                size="sm"
                variant="outline"
                onClick={() => list.fetchNextPage()}
                disabled={list.isFetchingNextPage}
              >
                {t('backups.load_more')}
              </Button>
            </div>
          )}
        </Card>
      )}

      {restoreTarget && (
        <RestoreBackupDialog
          open={restoreTarget !== null}
          onOpenChange={(open) => { if (!open) setRestoreTarget(null); }}
          backup={restoreTarget}
          instanceName={restoreTarget.instanceName}
        />
      )}
    </div>
  );
}
