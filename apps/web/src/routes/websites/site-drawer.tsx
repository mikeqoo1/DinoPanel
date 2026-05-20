import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Copy, ExternalLink, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import type { SiteResponse } from '@dinopanel/shared';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { extractErrorMessage } from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';
import {
  useAcmeRenew,
  useDeleteWebsite,
  useWebsiteConf,
} from '@/hooks/use-websites';

interface Props {
  site: SiteResponse | null;
  onOpenChange: (open: boolean) => void;
  onIssueClick: (site: SiteResponse) => void;
}

/**
 * v0.4 Sheet drawer for /websites. Replaces the v0.3 inline detail
 * panel — same actions, sliding from the right so the list stays
 * visible. External rows (managed_by_dinopanel=false) get a
 * read-only treatment with the source path surfaced + Copy button.
 */
export function SiteDrawer({ site, onOpenChange, onIssueClick }: Props) {
  const { t } = useTranslation();

  return (
    <Sheet
      open={site !== null}
      onOpenChange={(open) => {
        if (!open) onOpenChange(false);
      }}
    >
      <SheetContent closeLabel={t('common.close')}>
        {site && <DrawerBody site={site} onIssueClick={onIssueClick} onClose={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  );
}

function DrawerBody({
  site,
  onIssueClick,
  onClose,
}: {
  site: SiteResponse;
  onIssueClick: (site: SiteResponse) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // External rows have no managed conf; skip the conf fetch entirely
  // (the /api/websites/:id/conf endpoint only knows the managed path).
  const conf = useWebsiteConf(site.id, site.managedByDinopanel);
  const del = useDeleteWebsite();
  const renew = useAcmeRenew();

  const isExternal = !site.managedByDinopanel;
  const externalPath = site.externalConfPath ?? null;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          {isExternal && (
            <Badge
              variant="outline"
              className="border-amber-500/50 text-amber-600"
            >
              {t('websites.external_badge')}
            </Badge>
          )}
          <span>{site.name}</span>
        </SheetTitle>
        <SheetDescription>{site.primaryDomain}</SheetDescription>
      </SheetHeader>

      {/* Action row — disabled in external mode */}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => onIssueClick(site)}
          disabled={isExternal}
          title={isExternal ? t('websites.external_disabled_hint') : undefined}
        >
          <ShieldCheck className="mr-1 h-4 w-4" />
          {site.certPaths
            ? t('websites.ssl_reissue')
            : t('websites.ssl_issue')}
        </Button>
        {site.certPaths && !isExternal && (
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
          disabled={isExternal || del.isPending}
          title={isExternal ? t('websites.external_disabled_hint') : undefined}
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
        >
          <Trash2 className="mr-1 h-4 w-4" />
          {t('common.delete')}
        </Button>
      </div>

      {isExternal && externalPath && (
        <section className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="text-xs font-medium text-muted-foreground">
            {t('websites.external_path_label')}
          </div>
          <div className="flex items-center gap-2 text-sm">
            <code className="flex-1 truncate rounded bg-muted/40 px-2 py-1 text-xs">
              {externalPath}
            </code>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Copy path"
              onClick={async () => {
                const ok = await copyToClipboard(externalPath);
                if (ok) {
                  toast.success(
                    t('databases.drawer.copied', {
                      label: t('websites.external_path_label'),
                    }),
                  );
                } else {
                  toast.error(t('databases.drawer.copy_failed'));
                }
              }}
            >
              <Copy className="h-3 w-3" />
            </Button>
            <a
              href={`file://${externalPath}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-7 items-center justify-center rounded-md border px-2 text-xs hover:bg-muted"
            >
              <ExternalLink className="mr-1 h-3 w-3" />
              {t('websites.external_open')}
            </a>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('websites.external_help')}
          </p>
        </section>
      )}

      {!isExternal && (
        <section className="space-y-2">
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
        </section>
      )}
    </div>
  );
}
