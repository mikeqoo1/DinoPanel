import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Database, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import type { DbInstanceResponse } from '@dinopanel/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { extractErrorMessage } from '@/lib/api';
import { useDatabases, useDatabasesStatus, useReconcileDatabases } from '@/hooks/use-databases';
import { usePmmConfig } from '@/hooks/use-monitoring';
import { CreateDatabaseDialog } from './create-database-dialog';
import { DatabaseDrawer } from './database-drawer';
import { ENGINE_META } from './engine-meta';

export function DatabasesPage() {
  const { t } = useTranslation();
  const list = useDatabases();
  const status = useDatabasesStatus();
  const reconcile = useReconcileDatabases();
  const pmm = usePmmConfig();

  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const selected =
    list.data?.find((d) => d.id === selectedId) ?? null;

  return (
    <div className="space-y-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5" />
          <h1 className="text-xl font-semibold">{t('databases.title')}</h1>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={reconcile.isPending}
            onClick={async () => {
              try {
                const r = await reconcile.mutateAsync();
                toast.success(
                  t('databases.reconciled', {
                    matched: r.matched,
                    missing: r.missingContainer,
                    orphan: r.orphanContainer,
                  }),
                );
              } catch (err) {
                toast.error(extractErrorMessage(err));
              }
            }}
          >
            <RefreshCw className="mr-1 h-4 w-4" />
            {t('databases.reconcile')}
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            {t('databases.add')}
          </Button>
        </div>
      </header>

      {status.data?.degraded && (
        <Card className="border-amber-500/50 bg-amber-500/10 p-4 text-sm">
          <div className="font-medium">{t('databases.degraded_title')}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {status.data.reason ?? t('databases.degraded_unknown')}
          </div>
        </Card>
      )}

      {list.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : list.error ? (
        <Card className="p-6 text-sm text-destructive">
          {extractErrorMessage(list.error)}
        </Card>
      ) : !list.data || list.data.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">
          {t('databases.empty')}
        </Card>
      ) : (
        <DatabasesTable
          rows={list.data}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      )}

      <CreateDatabaseDialog open={createOpen} onOpenChange={setCreateOpen} />
      <DatabaseDrawer
        instance={selected}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
        pmmUrl={pmm.data?.url ?? null}
      />
    </div>
  );
}

interface TableProps {
  rows: DbInstanceResponse[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}

function DatabasesTable({ rows, selectedId, onSelect }: TableProps) {
  const { t } = useTranslation();
  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left">
          <tr>
            <th className="p-3 font-medium">{t('databases.col_name')}</th>
            <th className="p-3 font-medium">{t('databases.col_engine')}</th>
            <th className="p-3 font-medium">{t('databases.col_port')}</th>
            <th className="p-3 font-medium">{t('databases.col_user')}</th>
            <th className="p-3 font-medium">{t('databases.col_status')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const meta = ENGINE_META[r.engine];
            return (
              <tr
                key={r.id}
                className={`cursor-pointer border-t hover:bg-muted/20 ${
                  selectedId === r.id ? 'bg-muted/30' : ''
                }`}
                onClick={() => onSelect(r.id)}
              >
                <td className="p-3 font-mono text-xs">{r.name}</td>
                <td className="p-3 text-xs">
                  <Badge variant="outline" className={meta.badgeClass}>
                    {t(meta.labelKey)}
                  </Badge>
                </td>
                <td className="p-3 text-xs">{r.port}</td>
                <td className="p-3 text-xs">{r.username}</td>
                <td className="p-3 text-xs">
                  <StatusBadge status={r.status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

function StatusBadge({ status }: { status: DbInstanceResponse['status'] }) {
  const { t } = useTranslation();
  const variant: Record<
    DbInstanceResponse['status'],
    'default' | 'destructive' | 'secondary' | 'outline'
  > = {
    running: 'default',
    stopped: 'secondary',
    restarting: 'outline',
    creating: 'outline',
    removing: 'outline',
    error: 'destructive',
  };
  return (
    <Badge variant={variant[status]}>
      {t(`databases.status.${status}`)}
    </Badge>
  );
}
