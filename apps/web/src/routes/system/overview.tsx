import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useSystemInfo } from '@/hooks/use-system';
import { formatDuration, cn } from '@/lib/utils';

export function OverviewTab() {
  const { t } = useTranslation();
  const info = useSystemInfo();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('dashboard.system_info')}</CardTitle>
      </CardHeader>
      <CardContent>
        {info.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : info.data ? (
          <div className="grid gap-x-6 gap-y-2 text-sm md:grid-cols-2">
            <Field label={t('dashboard.hostname')} value={info.data.hostname} />
            <Field
              label={t('dashboard.os')}
              value={`${info.data.os.distro} ${info.data.os.release}`}
            />
            <Field label={t('dashboard.kernel')} value={info.data.os.kernel} />
            <Field label={t('dashboard.arch')} value={info.data.os.arch} />
            <Field
              label={t('dashboard.cpu_model')}
              value={`${info.data.cpu.model} (${info.data.cpu.cores}c)`}
            />
            <Field label={t('dashboard.uptime')} value={formatDuration(info.data.uptime)} />
            <Field
              label={t('dashboard.ip_addresses')}
              value={
                info.data.ips
                  .filter((i) => i.ipv4)
                  .map((i) => `${i.ipv4} (${i.iface})`)
                  .join(', ') || '—'
              }
              full
            />
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('common.loading')}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <div className={cn('flex gap-3 py-1', full && 'md:col-span-2')}>
      <span className="min-w-32 text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
