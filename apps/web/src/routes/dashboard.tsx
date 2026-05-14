import { useTranslation } from 'react-i18next';
import { Cpu, MemoryStick, HardDrive, Network, Loader2, CircleCheck, CircleAlert } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { MetricChart } from '@/components/charts/metric-chart';
import { useSystemInfo, useMetricsStream } from '@/hooks/use-system';
import { formatBytes, formatRate, formatPercent, formatDuration, cn } from '@/lib/utils';

export function DashboardPage() {
  const { t } = useTranslation();
  const info = useSystemInfo();
  const { latest, history, connected } = useMetricsStream();

  const memPct = latest && latest.mem.total > 0 ? (latest.mem.used / latest.mem.total) * 100 : 0;
  const primaryDisk = latest?.disks.find((d) => d.mount === '/') ?? latest?.disks[0];
  const diskPct = primaryDisk && primaryDisk.total > 0 ? (primaryDisk.used / primaryDisk.total) * 100 : 0;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t('dashboard.title')}</h1>
        <div
          className={cn(
            'flex items-center gap-2 text-xs',
            connected ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground',
          )}
        >
          {connected ? (
            <>
              <CircleCheck className="h-3.5 w-3.5" />
              <span>live</span>
            </>
          ) : (
            <>
              <CircleAlert className="h-3.5 w-3.5" />
              <span>{t('terminal.connecting')}</span>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={<Cpu className="h-4 w-4 text-muted-foreground" />}
          label={t('dashboard.cpu_usage')}
          value={latest ? formatPercent(latest.cpu.usage) : '—'}
          sub={latest ? `Load: ${latest.cpu.loadAvg[0].toFixed(2)}` : null}
          data={history.cpu}
          color="var(--color-chart-1)"
          yMax={100}
          format={(v) => `${v.toFixed(1)}%`}
        />
        <MetricCard
          icon={<MemoryStick className="h-4 w-4 text-muted-foreground" />}
          label={t('dashboard.memory')}
          value={latest ? formatPercent(memPct) : '—'}
          sub={latest ? `${formatBytes(latest.mem.used)} / ${formatBytes(latest.mem.total)}` : null}
          data={history.memPct}
          color="var(--color-chart-2)"
          yMax={100}
          format={(v) => `${v.toFixed(1)}%`}
        />
        <MetricCard
          icon={<HardDrive className="h-4 w-4 text-muted-foreground" />}
          label={t('dashboard.disk')}
          value={primaryDisk ? formatPercent(diskPct) : '—'}
          sub={primaryDisk ? `${formatBytes(primaryDisk.used)} / ${formatBytes(primaryDisk.total)}` : null}
        />
        <MetricCard
          icon={<Network className="h-4 w-4 text-muted-foreground" />}
          label={t('dashboard.network')}
          value={latest ? formatRate(latest.net.rxRate + latest.net.txRate) : '—'}
          sub={latest ? `↓ ${formatRate(latest.net.rxRate)}  ↑ ${formatRate(latest.net.txRate)}` : null}
          data={history.netRx.map((v, i) => v + (history.netTx[i] ?? 0))}
          color="var(--color-chart-4)"
          format={(v) => formatRate(v)}
        />
      </div>

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
              <Field
                label={t('dashboard.uptime')}
                value={formatDuration(latest ? Math.floor((Date.now() - info.data.bootTime * 1000) / 1000) : info.data.uptime)}
              />
              <Field
                label={t('dashboard.ip_addresses')}
                value={info.data.ips
                  .filter((i) => i.ipv4)
                  .map((i) => `${i.ipv4} (${i.iface})`)
                  .join(', ') || '—'}
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
    </div>
  );
}

function Field({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <div className={cn('flex gap-3 py-1', full && 'md:col-span-2')}>
      <span className="w-32 shrink-0 text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

interface MetricCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string | null;
  data?: number[];
  color?: string;
  yMax?: number;
  format?: (v: number) => string;
}

function MetricCard({ icon, label, value, sub, data, color, yMax, format }: MetricCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent className="space-y-1">
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        {data && data.length > 0 && (
          <div className="mt-2">
            <MetricChart data={data} color={color} yMax={yMax} format={format} height={56} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
