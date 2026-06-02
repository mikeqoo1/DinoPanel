import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { extractErrorMessage } from '@/lib/api';
import {
  useToolboxStatus,
  useNtpStatus,
  useTimezones,
  useSetNtp,
  useSetTimezone,
} from '@/hooks/use-toolbox';

export function NtpTab() {
  const { t } = useTranslation();
  const status = useToolboxStatus();
  const feature = status.data?.features.find((f) => f.name === 'ntp');
  const available = feature?.available ?? false;

  const ntp = useNtpStatus(!!status.data && available);
  const timezones = useTimezones(!!status.data && available);
  const setNtp = useSetNtp();
  const setTz = useSetTimezone();
  const [tzDraft, setTzDraft] = useState('');

  if (status.isPending) return <Skeleton className="h-32 w-full" />;
  if (status.error) {
    return <Card className="p-6 text-sm text-destructive">{extractErrorMessage(status.error)}</Card>;
  }

  if (!available) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <AlertTriangle className="h-4 w-4" />
          {t('toolbox.ntp.not_configured')}
        </div>
      </Card>
    );
  }

  if (ntp.isPending) return <Skeleton className="h-32 w-full" />;
  if (ntp.error) {
    return <Card className="p-6 text-sm text-destructive">{extractErrorMessage(ntp.error)}</Card>;
  }

  const data = ntp.data!;
  const degraded = feature?.reason === 'SUDO_UNAVAILABLE';
  const selectedTz = tzDraft || data.timezone;

  const toggle = async () => {
    try {
      await setNtp.mutateAsync(!data.ntpEnabled);
      toast.success(data.ntpEnabled ? t('toolbox.ntp.disabled_toast') : t('toolbox.ntp.enabled_toast'));
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  const applyTz = async () => {
    try {
      await setTz.mutateAsync(selectedTz.trim());
      toast.success(t('toolbox.ntp.timezone_updated'));
      setTzDraft('');
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  return (
    <div className="space-y-4">
      {degraded && (
        <Card className="border-warning/40 bg-warning/5 p-3 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            {t('toolbox.ntp.sudo_warning')}
          </div>
        </Card>
      )}

      <Card className="space-y-3 p-6">
        <div className="flex flex-wrap items-center gap-3">
          {data.synchronized ? (
            <Badge variant="success" className="gap-1">
              <CheckCircle2 className="h-3 w-3" />
              {t('toolbox.ntp.synced')}
            </Badge>
          ) : (
            <Badge variant="warning">{t('toolbox.ntp.not_synced')}</Badge>
          )}
          {data.localTime && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {data.localTime}
            </span>
          )}
          {data.chrony && (
            <span className="text-xs text-muted-foreground">
              chrony · stratum {data.chrony.stratum ?? '—'} · {data.chrony.leapStatus ?? '—'}
            </span>
          )}
        </div>

        {data.rtcInLocalTz && (
          <p className="text-xs text-warning">{t('toolbox.ntp.rtc_local_warning')}</p>
        )}

        <div className="flex items-center justify-between gap-3">
          <div>
            <Label>{t('toolbox.ntp.enable_label')}</Label>
            <p className="text-xs text-muted-foreground">{t('toolbox.ntp.enable_hint')}</p>
          </div>
          <Button
            size="sm"
            variant={data.ntpEnabled ? 'outline' : 'default'}
            disabled={setNtp.isPending}
            onClick={toggle}
          >
            {data.ntpEnabled ? t('toolbox.ntp.disable') : t('toolbox.ntp.enable')}
          </Button>
        </div>
      </Card>

      <Card className="space-y-3 p-6">
        <Label htmlFor="tz-input">{t('toolbox.ntp.timezone_label')}</Label>
        <div className="flex gap-2">
          <Input
            id="tz-input"
            list="tz-zones"
            className="max-w-sm"
            value={selectedTz}
            onChange={(e) => setTzDraft(e.target.value)}
          />
          <datalist id="tz-zones">
            {(timezones.data ?? []).map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
          <Button
            size="sm"
            disabled={setTz.isPending || selectedTz.trim() === data.timezone}
            onClick={applyTz}
          >
            {t('common.save')}
          </Button>
        </div>
      </Card>
    </div>
  );
}
