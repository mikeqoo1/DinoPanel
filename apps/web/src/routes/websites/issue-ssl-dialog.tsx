import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { AcmeChallenge, AcmeDnsProvider } from '@dinopanel/shared';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { extractErrorMessage } from '@/lib/api';
import { useAcmeIssue, useAcmeStatus } from '@/hooks/use-websites';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteId: number;
  siteName: string;
}

export function IssueSslDialog({ open, onOpenChange, siteId, siteName }: Props) {
  const { t } = useTranslation();
  const [challenge, setChallenge] = useState<AcmeChallenge>('http-01');
  const [dnsProvider, setDnsProvider] = useState<AcmeDnsProvider>('cloudflare');
  const issue = useAcmeIssue();
  // Poll status while the dialog is open so the user sees progress
  // after kicking off issuance.
  const status = useAcmeStatus(siteId, { enabled: open, pollMs: 3000 });

  const submit = async () => {
    try {
      await issue.mutateAsync({
        id: siteId,
        body: {
          challenge,
          dnsProvider: challenge === 'dns-01' ? dnsProvider : undefined,
        },
      });
      toast.success(t('websites.ssl.issued'));
      onOpenChange(false);
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('websites.ssl.dialog_title')}</DialogTitle>
          <DialogDescription>{siteName}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>{t('websites.ssl.challenge')}</Label>
            <select
              className="block w-full rounded-md border bg-background p-2 text-sm"
              value={challenge}
              onChange={(e) => setChallenge(e.target.value as AcmeChallenge)}
            >
              <option value="http-01">HTTP-01</option>
              <option value="dns-01">DNS-01</option>
            </select>
            <p className="text-xs text-muted-foreground">
              {challenge === 'http-01'
                ? t('websites.ssl.http01_hint')
                : t('websites.ssl.dns01_hint')}
            </p>
          </div>
          {challenge === 'dns-01' && (
            <div className="space-y-2">
              <Label>{t('websites.ssl.dns_provider')}</Label>
              <select
                className="block w-full rounded-md border bg-background p-2 text-sm"
                value={dnsProvider}
                onChange={(e) =>
                  setDnsProvider(e.target.value as AcmeDnsProvider)
                }
              >
                <option value="cloudflare">Cloudflare</option>
              </select>
              <p className="text-xs text-muted-foreground">
                {t('websites.ssl.cf_token_required')}
              </p>
            </div>
          )}
          {status.data && (
            <div className="rounded-md border bg-muted/40 p-3 text-xs">
              <div>
                {t('websites.ssl.has_cert')}:{' '}
                {status.data.hasCert ? '✓' : '✗'}
              </div>
              {status.data.expiresAt && (
                <div>
                  {t('websites.ssl.expires_at')}:{' '}
                  {new Date(status.data.expiresAt).toISOString()}
                </div>
              )}
              {status.data.lastError && (
                <div className="mt-1 text-destructive">
                  {t('websites.ssl.last_error')}: {status.data.lastError}
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} disabled={issue.isPending}>
            {issue.isPending
              ? t('websites.ssl.issuing')
              : t('websites.ssl.issue')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
