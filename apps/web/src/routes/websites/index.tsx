import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import type { SiteResponse } from '@dinopanel/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { extractErrorMessage } from '@/lib/api';
import {
  useReconcileWebsites,
  useWebsites,
  useWebsitesStatus,
} from '@/hooks/use-websites';
import { AddSiteDialog } from './add-site-dialog';
import { IssueSslDialog } from './issue-ssl-dialog';
import { SiteDrawer } from './site-drawer';

const RENEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export function WebsitesPage() {
  const { t } = useTranslation();
  const sites = useWebsites();
  const status = useWebsitesStatus();
  const reconcile = useReconcileWebsites();

  const [addOpen, setAddOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueTarget, setIssueTarget] = useState<SiteResponse | null>(null);

  const selected =
    sites.data?.find((s) => s.id === selectedId) ?? null;

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
                if (r.serverNameConflicts.length > 0) {
                  toast.warning(
                    t('websites.server_name_conflicts', {
                      count: r.serverNameConflicts.length,
                    }),
                  );
                }
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

      <AddSiteDialog open={addOpen} onOpenChange={setAddOpen} />
      <SiteDrawer
        site={selected}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
        onIssueClick={(s) => {
          setIssueTarget(s);
          setIssueOpen(true);
        }}
      />
      {issueTarget && (
        <IssueSslDialog
          open={issueOpen}
          onOpenChange={setIssueOpen}
          siteId={issueTarget.id}
          siteName={issueTarget.name}
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
                <StatusBadge site={s} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function StatusBadge({ site }: { site: SiteResponse }) {
  const { t } = useTranslation();
  if (!site.managedByDinopanel) {
    return (
      <Badge
        variant="outline"
        className="border-amber-500/50 text-amber-600"
      >
        {t('websites.external_badge')}
      </Badge>
    );
  }
  if (site.orphaned) {
    return (
      <Badge variant="destructive">{t('websites.status_orphaned')}</Badge>
    );
  }
  return <Badge variant="secondary">{t('websites.status_active')}</Badge>;
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
