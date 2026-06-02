import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { extractErrorMessage } from '@/lib/api';
import {
  useFirewallStatus,
  useFail2banJails,
  useFail2banBan,
  useFail2banUnban,
} from '@/hooks/use-firewall';

export function Fail2banTab() {
  const { t } = useTranslation();
  const status = useFirewallStatus();
  const present = status.data?.fail2ban ?? false;

  const jails = useFail2banJails(!!status.data && present);
  const ban = useFail2banBan();
  const unban = useFail2banUnban();
  const [jail, setJail] = useState('');
  const [ip, setIp] = useState('');

  if (status.isPending) return <Skeleton className="h-32 w-full" />;
  if (status.error) {
    return <Card className="p-6 text-sm text-destructive">{extractErrorMessage(status.error)}</Card>;
  }

  if (!present) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldAlert className="h-4 w-4" />
          {t('toolbox.fail2ban.not_configured')}
        </div>
      </Card>
    );
  }

  const doBan = async () => {
    try {
      await ban.mutateAsync({ jail, ip });
      toast.success(t('toolbox.fail2ban.banned_toast', { ip }));
      setIp('');
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  const doUnban = async (j: string, addr: string) => {
    try {
      await unban.mutateAsync({ jail: j, ip: addr });
      toast.success(t('toolbox.fail2ban.unbanned_toast', { ip: addr }));
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  const jailNames = (jails.data ?? []).map((j) => j.name);

  return (
    <div className="space-y-4">
      <Card className="space-y-2 p-4">
        <span className="text-sm font-medium">{t('toolbox.fail2ban.ban_title')}</span>
        <div className="flex flex-wrap gap-2">
          <Input
            className="max-w-[12rem]"
            list="fail2ban-jails"
            placeholder={t('toolbox.fail2ban.jail_ph')}
            value={jail}
            onChange={(e) => setJail(e.target.value)}
          />
          <datalist id="fail2ban-jails">
            {jailNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <Input
            className="max-w-[14rem]"
            placeholder={t('toolbox.fail2ban.ip_ph')}
            value={ip}
            onChange={(e) => setIp(e.target.value)}
          />
          <Button size="sm" variant="destructive" disabled={!jail || !ip || ban.isPending} onClick={doBan}>
            {t('toolbox.fail2ban.ban')}
          </Button>
        </div>
      </Card>

      {jails.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : jails.error ? (
        <Card className="p-6 text-sm text-destructive">{extractErrorMessage(jails.error)}</Card>
      ) : !jails.data || jails.data.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">{t('toolbox.fail2ban.empty')}</Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="p-3 font-medium">{t('toolbox.fail2ban.col_jail')}</th>
                <th className="p-3 font-medium">{t('toolbox.fail2ban.col_state')}</th>
                <th className="p-3 font-medium">{t('toolbox.fail2ban.col_failed')}</th>
                <th className="p-3 font-medium">{t('toolbox.fail2ban.col_banned')}</th>
              </tr>
            </thead>
            <tbody>
              {jails.data.map((j) => (
                <tr key={j.name} className="border-t align-top">
                  <td className="p-3 font-mono text-xs">{j.name}</td>
                  <td className="p-3">
                    {/* fail2banJails only lists RUNNING jails, so state is always active. */}
                    <Badge variant="success">{t('toolbox.fail2ban.active')}</Badge>
                  </td>
                  <td className="p-3">
                    {j.currentlyFailed} / {j.totalFailed}
                  </td>
                  <td className="p-3">
                    {j.currentlyBanned} / {j.totalBanned}
                    {j.bannedIps.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {j.bannedIps.map((addr) => (
                          <button
                            key={addr}
                            type="button"
                            className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] hover:bg-destructive/20"
                            title={t('toolbox.fail2ban.unban')}
                            disabled={unban.isPending}
                            onClick={() => doUnban(j.name, addr)}
                          >
                            {addr} ✕
                          </button>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
