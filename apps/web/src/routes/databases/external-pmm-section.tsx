import { useTranslation } from 'react-i18next';
import { Database, ExternalLink, RefreshCw } from 'lucide-react';
import type {
  PmmExternalErrorReason,
  PmmExternalService,
} from '@dinopanel/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useExternalPmm, useRefreshExternalPmm } from '@/hooks/use-databases';
import { ENGINE_META } from './engine-meta';

interface Props {
  pmmUrl: string | null;
}

export function ExternalPmmSection({ pmmUrl }: Props) {
  const { t } = useTranslation();
  const query = useExternalPmm(pmmUrl !== null);
  const refresh = useRefreshExternalPmm();

  if (pmmUrl === null) return null;

  const response = query.data;
  // Same gate as pmmUrl=null — server says PMM URL isn't configured
  // (rare given pmmUrl is non-null here, but possible if settings
  // changed mid-flight). Collapse cleanly.
  if (response?.error?.reason === 'not_configured') return null;

  return (
    <Card className="space-y-3 p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">
              {t('databases.external_pmm.section_title')}
            </h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('databases.external_pmm.section_hint')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {response && !response.error && (
            <LastRefreshed fetchedAt={response.fetchedAt} />
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={query.isPending || refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            <RefreshCw
              className={`mr-1 h-4 w-4 ${
                refresh.isPending ? 'animate-spin' : ''
              }`}
            />
            {t('databases.external_pmm.refresh')}
          </Button>
        </div>
      </header>

      <Body
        isPending={query.isPending}
        response={response}
        pmmUrl={pmmUrl}
      />
    </Card>
  );
}

function Body({
  isPending,
  response,
  pmmUrl,
}: {
  isPending: boolean;
  response: ReturnType<typeof useExternalPmm>['data'];
  pmmUrl: string;
}) {
  const { t } = useTranslation();
  if (isPending) return <Skeleton className="h-24 w-full" />;
  if (!response) return null;
  if (response.error) {
    return <ErrorBanner reason={response.error.reason} />;
  }
  if (response.services.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('databases.external_pmm.empty')}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {response.services.map((s) => (
        <ServiceRow key={s.serviceId} service={s} pmmUrl={pmmUrl} />
      ))}
    </div>
  );
}

function ServiceRow({
  service,
  pmmUrl,
}: {
  service: PmmExternalService;
  pmmUrl: string;
}) {
  const { t } = useTranslation();
  const meta =
    service.engine in ENGINE_META
      ? ENGINE_META[service.engine as keyof typeof ENGINE_META]
      : null;
  const hostPort =
    service.address && service.port
      ? `${service.address}:${service.port}`
      : service.address || '—';

  // Inventory metadata only — metrics live in PMM (Option B design:
  // DinoPanel surfaces "what PMM knows about", PMM owns the live data).
  // The Open-in-PMM link drops the operator straight onto PMM's
  // service page where the real metrics already render.
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs">{service.serviceName}</span>
        {meta ? (
          <Badge variant="outline" className={meta.badgeClass}>
            {t(meta.labelKey)}
          </Badge>
        ) : (
          <Badge variant="outline">{service.engine}</Badge>
        )}
        <span className="text-xs text-muted-foreground">{hostPort}</span>
      </div>
      <a
        href={pmmInventoryHref(pmmUrl, service.serviceId)}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
      >
        <ExternalLink className="h-3 w-3" />
        {t('databases.external_pmm.open_in_pmm')}
      </a>
    </div>
  );
}

function ErrorBanner({ reason }: { reason: PmmExternalErrorReason }) {
  const { t } = useTranslation();
  // `not_configured` is handled by the parent (section collapses
  // entirely) — only the three transient failures hit here.
  const key =
    reason === 'auth'
      ? 'databases.external_pmm.error_auth'
      : reason === 'unreachable'
        ? 'databases.external_pmm.error_unreachable'
        : 'databases.external_pmm.error_bad_response';
  return (
    <Card className="border-amber-500/50 bg-amber-500/10 p-3 text-xs">
      {t(key)}
    </Card>
  );
}

function LastRefreshed({ fetchedAt }: { fetchedAt: number }) {
  const { t } = useTranslation();
  const seconds = Math.max(0, Math.round((Date.now() - fetchedAt) / 1000));
  return (
    <span className="text-xs text-muted-foreground">
      {t('databases.external_pmm.last_refreshed', { seconds })}
    </span>
  );
}

function pmmInventoryHref(pmmUrl: string, serviceId: string): string {
  // PMM 3.x SPA route — `/inventory/services/<id>`. NOT under `/graph`
  // (that's Grafana's prefix; PMM owns `/inventory` separately).
  const base = pmmUrl.replace(/\/$/, '');
  return `${base}/inventory/services/${encodeURIComponent(serviceId)}`;
}
