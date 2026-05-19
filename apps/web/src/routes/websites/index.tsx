import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Plus, RefreshCw, ShieldCheck, ShieldOff, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { SiteResponse } from '@dinopanel/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { extractErrorMessage } from '@/lib/api';
import {
  useAcmeRenew,
  useDeleteWebsite,
  useReconcileWebsites,
  useWebsiteConf,
  useWebsites,
  useWebsitesStatus,
} from '@/hooks/use-websites';
import { AddSiteDialog } from './add-site-dialog';
import { IssueSslDialog } from './issue-ssl-dialog';

const RENEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export function WebsitesPage() {
  const { t } = useTranslation();
  const sites = useWebsites();
  const status = useWebsitesStatus();
  const reconcile = useReconcileWebsites();

  const [addOpen, setAddOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);

  const selected = useMemo(
    () => sites.data?.find((s) => s.id === selectedId) ?? null,
    [sites.data, selectedId],
  );

  return (
    <div className="space-y-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Globe className="h-5 w-5" />
          <h1 className="text-xl font-semibold">{t('websites.title')}</h1>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                const r = await reconcile.mutateAsync();
                toast.success(
                  t('websites.reconciled', {
                    scanned: r.scanned,
                    orphaned: r.orphaned,
                  }),
                );
              } catch (err) {
                toast.error(extractErrorMessage(err));
              }
            }}
            disabled={reconcile.isPending}
          >
            <RefreshCw className="mr-1 h-4 w-4" />
            {t('websites.reconcile')}
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            {t('websites.add')}
          </Button>
        </div>
      </header>

      {status.data?.degraded && (
        <Card className="border-amber-500/50 bg-amber-500/10 p-4 text-sm">
          <div className="font-medium">{t('websites.degraded_title')}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {status.data.reason ?? t('websites.degraded_unknown')}
          </div>
          <div className="mt-2 text-xs">
            {t('websites.degraded_help')}
          </div>
        </Card>
      )}

      {sites.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : sites.error ? (
        <Card className="p-6 text-sm text-destructive">
          {extractErrorMessage(sites.error)}
        </Card>
      ) : !sites.data || sites.data.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">
          {t('websites.empty')}
        </Card>
      ) : (
        <SitesTable
          sites={sites.data}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      )}

      {selected && (
        <SiteDetailPanel
          site={selected}
          onIssueClick={() => setIssueOpen(true)}
          onClose={() => setSelectedId(null)}
        />
      )}

      <AddSiteDialog open={addOpen} onOpenChange={setAddOpen} />
      {selected && (
        <IssueSslDialog
          open={issueOpen}
          onOpenChange={setIssueOpen}
          siteId={selected.id}
          siteName={selected.name}
        />
      )}
    </div>
  );
}

interface TableProps {
  sites: SiteResponse[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}

function SitesTable({ sites, selectedId, onSelect }: TableProps) {
  const { t } = useTranslation();
  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left">
          <tr>
            <th className="p-3 font-medium">{t('websites.col_name')}</th>
            <th className="p-3 font-medium">{t('websites.col_domain')}</th>
            <th className="p-3 font-medium">{t('websites.col_type')}</th>
            <th className="p-3 font-medium">{t('websites.col_ssl')}</th>
            <th className="p-3 font-medium">{t('websites.col_status')}</th>
          </tr>
        </thead>
        <tbody>
          {sites.map((s) => (
            <tr
              key={s.id}
              className={`cursor-pointer border-t hover:bg-muted/20 ${
                selectedId === s.id ? 'bg-muted/30' : ''
              }`}
              onClick={() => onSelect(s.id)}
            >
              <td className="p-3 font-mono text-xs">{s.name}</td>
              <td className="p-3">{s.primaryDomain}</td>
              <td className="p-3 text-xs">
                <Badge variant="outline">{t(`websites.type.${s.type}`)}</Badge>
              </td>
              <td className="p-3 text-xs">
                <SslBadge site={s} />
              </td>
              <td className="p-3 text-xs">
                {s.orphaned ? (
                  <Badge variant="destructive">
                    {t('websites.status_orphaned')}
                  </Badge>
                ) : (
                  <Badge variant="secondary">
                    {t('websites.status_active')}
                  </Badge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function SslBadge({ site }: { site: SiteResponse }) {
  const { t } = useTranslation();
  if (!site.certExpiresAt || !site.certPaths) {
    return <Badge variant="outline">{t('websites.ssl_none')}</Badge>;
  }
  const ms = site.certExpiresAt - Date.now();
  if (ms <= 0) {
    return <Badge variant="destructive">{t('websites.ssl_expired')}</Badge>;
  }
  if (ms < RENEW_WINDOW_MS) {
    const days = Math.max(1, Math.floor(ms / (24 * 60 * 60 * 1000)));
    return (
      <Badge variant="outline" className="border-amber-500/50 text-amber-600">
        {t('websites.ssl_expiring_in', { days })}
      </Badge>
    );
  }
  return (
    <Badge variant="default">
      {t('websites.ssl_valid_until', {
        date: new Date(site.certExpiresAt).toISOString().slice(0, 10),
      })}
    </Badge>
  );
}

interface PanelProps {
  site: SiteResponse;
  onIssueClick: () => void;
  onClose: () => void;
}

function SiteDetailPanel({ site, onIssueClick, onClose }: PanelProps) {
  const { t } = useTranslation();
  const conf = useWebsiteConf(site.id, true);
  const del = useDeleteWebsite();
  const renew = useAcmeRenew();

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">{site.name}</h2>
          <span className="text-xs text-muted-foreground">
            {site.primaryDomain}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onIssueClick}>
            <ShieldCheck className="mr-1 h-4 w-4" />
            {site.certPaths
              ? t('websites.ssl_reissue')
              : t('websites.ssl_issue')}
          </Button>
          {site.certPaths && (
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  await renew.mutateAsync(site.id);
                  toast.success(t('websites.ssl_renewed'));
                } catch (err) {
                  toast.error(extractErrorMessage(err));
                }
              }}
              disabled={renew.isPending}
            >
              <RefreshCw className="mr-1 h-4 w-4" />
              {t('websites.ssl_renew')}
            </Button>
          )}
          <Button
            size="sm"
            variant="destructive"
            onClick={async () => {
              if (!confirm(t('websites.delete_confirm', { name: site.name }))) {
                return;
              }
              try {
                await del.mutateAsync(site.id);
                toast.success(t('websites.deleted'));
                onClose();
              } catch (err) {
                toast.error(extractErrorMessage(err));
              }
            }}
            disabled={del.isPending}
          >
            <Trash2 className="mr-1 h-4 w-4" />
            {t('common.delete')}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            <ShieldOff className="mr-1 h-4 w-4" />
            {t('common.close')}
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">
          {t('websites.raw_conf')}
        </div>
        {conf.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : conf.error ? (
          <div className="text-xs text-destructive">
            {extractErrorMessage(conf.error)}
          </div>
        ) : (
          <pre className="max-h-80 overflow-auto rounded-md border bg-muted/40 p-3 text-xs">
            {conf.data?.content ?? ''}
          </pre>
        )}
      </div>
    </Card>
  );
}
