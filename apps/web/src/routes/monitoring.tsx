import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ExternalLink, Settings as SettingsIcon, Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { usePmmConfig, usePmmStatus } from '@/hooks/use-monitoring';

export function MonitoringPage() {
  const { t } = useTranslation();
  const config = usePmmConfig();
  const status = usePmmStatus(!!config.data?.url);

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{t('monitoring.title')}</h1>
      </div>

      {config.isPending ? (
        <Skeleton className="h-40 w-full max-w-2xl" />
      ) : !config.data?.url ? (
        <Card className="flex max-w-2xl flex-col gap-3 p-6">
          <h2 className="font-semibold">{t('monitoring.empty.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('monitoring.empty.body')}</p>
          <Button asChild size="sm" variant="outline" className="w-fit">
            <Link to="/settings">
              <SettingsIcon className="h-4 w-4" />
              {t('monitoring.empty.cta')}
            </Link>
          </Button>
        </Card>
      ) : (
        <Card className="flex max-w-2xl flex-col gap-4 p-6">
          <div className="flex items-center gap-3">
            <span
              className={cn(
                'h-2.5 w-2.5 shrink-0 rounded-full',
                status.isPending && 'animate-pulse bg-yellow-500',
                !status.isPending && status.data?.ok && 'bg-green-500',
                !status.isPending && status.data && !status.data.ok && 'bg-red-500',
                !status.isPending && !status.data && 'bg-muted-foreground',
              )}
            />
            <span className="font-medium">
              {status.isPending
                ? t('monitoring.status.checking')
                : status.data?.ok
                  ? t('monitoring.status.up')
                  : t('monitoring.status.down')}
            </span>
            {status.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>

          <div className="space-y-1 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">URL:</span>
              <code className="font-mono text-xs">{config.data.url}</code>
            </div>
            {status.data?.latencyMs !== null && status.data?.latencyMs !== undefined && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">{t('monitoring.status.latency_ms')}:</span>
                <span className="font-mono text-xs">{status.data.latencyMs} ms</span>
              </div>
            )}
            {status.data?.lastChecked && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">{t('monitoring.status.last_checked')}:</span>
                <span className="text-xs">
                  {formatDistanceToNow(new Date(status.data.lastChecked), { addSuffix: true })}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button asChild size="sm">
              <a href={config.data.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
                {t('monitoring.actions.open_pmm')}
              </a>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/settings">
                <SettingsIcon className="h-4 w-4" />
                {t('monitoring.actions.configure')}
              </Link>
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
