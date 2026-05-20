import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Lock, Sun, Moon, Monitor, Activity, FileClock, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { changePasswordSchema, type ChangePasswordInput } from '@dinopanel/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useTheme } from '@/components/theme-provider';
import { useAuthStore } from '@/stores/auth';
import { useSystemInfo } from '@/hooks/use-system';
import { api, extractErrorMessage } from '@/lib/api';
import { usePmmConfig, useSetPmmConfig } from '@/hooks/use-monitoring';
import { useAuditRetention, useSetAuditRetention } from '@/hooks/use-audit';
import {
  useAcmeConfig,
  usePhpFpmStatus,
  useSetAcmeConfig,
} from '@/hooks/use-websites';

export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const user = useAuthStore((s) => s.user);
  const info = useSystemInfo();
  const [pwSubmitting, setPwSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ChangePasswordInput>({ resolver: zodResolver(changePasswordSchema) });

  const pmmConfig = usePmmConfig();
  const setPmm = useSetPmmConfig();
  const [pmmUrlInput, setPmmUrlInput] = useState<string | null>(null);
  const effectivePmmUrl = pmmUrlInput ?? pmmConfig.data?.url ?? '';

  const retention = useAuditRetention();
  const setRetention = useSetAuditRetention();
  const [retentionInput, setRetentionInput] = useState<number | null>(null);
  const effectiveRetention = retentionInput ?? retention.data?.days ?? 30;

  const acmeConfig = useAcmeConfig();
  const setAcmeConfig = useSetAcmeConfig();
  const [cfTokenInput, setCfTokenInput] = useState('');
  const [showCfToken, setShowCfToken] = useState(false);
  const [acmeEmailInput, setAcmeEmailInput] = useState<string | null>(null);
  const effectiveAcmeEmail =
    acmeEmailInput ??
    (acmeConfig.data?.emailSource === 'settings' ? acmeConfig.data.email ?? '' : '');

  const onSaveCfToken = async () => {
    try {
      await setAcmeConfig.mutateAsync({ cloudflareApiToken: cfTokenInput });
      setCfTokenInput('');
      toast.success(t('settings.ssl.saved'));
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  const onClearCfToken = async () => {
    try {
      await setAcmeConfig.mutateAsync({ cloudflareApiToken: null });
      setCfTokenInput('');
      toast.success(t('settings.ssl.cleared'));
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  const onSaveAcmeEmail = async () => {
    const value = effectiveAcmeEmail.trim();
    try {
      await setAcmeConfig.mutateAsync({ email: value === '' ? null : value });
      setAcmeEmailInput(null);
      toast.success(t('settings.ssl.email_saved'));
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  const onSaveRetention = async () => {
    try {
      await setRetention.mutateAsync(effectiveRetention);
      setRetentionInput(null);
      toast.success(t('settings.audit.saved'));
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  const onSavePmm = async () => {
    const trimmed = effectivePmmUrl.trim();
    try {
      await setPmm.mutateAsync(trimmed === '' ? null : trimmed);
      setPmmUrlInput(null);
      toast.success(t('settings.external_monitoring.saved'));
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  const onChangePassword = async (data: ChangePasswordInput) => {
    setPwSubmitting(true);
    try {
      await api.post('/auth/change-password', data);
      toast.success(t('settings.saved'));
      reset();
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setPwSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('settings.title')}</h1>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.general')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>{t('settings.language')}</Label>
            <div className="flex gap-2">
              <Button
                variant={i18n.language === 'zh-TW' ? 'default' : 'outline'}
                size="sm"
                onClick={() => i18n.changeLanguage('zh-TW')}
              >
                繁體中文
              </Button>
              <Button
                variant={i18n.language === 'en' ? 'default' : 'outline'}
                size="sm"
                onClick={() => i18n.changeLanguage('en')}
              >
                English
              </Button>
            </div>
          </div>
          <Separator />
          <div className="space-y-2">
            <Label>{t('settings.theme')}</Label>
            <div className="flex gap-2">
              <Button
                variant={theme === 'light' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTheme('light')}
              >
                <Sun className="h-4 w-4" />
                {t('settings.theme_light')}
              </Button>
              <Button
                variant={theme === 'dark' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTheme('dark')}
              >
                <Moon className="h-4 w-4" />
                {t('settings.theme_dark')}
              </Button>
              <Button
                variant={theme === 'system' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTheme('system')}
              >
                <Monitor className="h-4 w-4" />
                {t('settings.theme_system')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4" />
            {t('settings.change_password')}
          </CardTitle>
          <CardDescription className="font-mono text-xs">{user?.username}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onChangePassword)} className="max-w-md space-y-4">
            <div className="space-y-2">
              <Label htmlFor="oldPassword">{t('settings.old_password')}</Label>
              <Input
                id="oldPassword"
                type="password"
                autoComplete="current-password"
                {...register('oldPassword')}
              />
              {errors.oldPassword && (
                <p className="text-xs text-destructive">{errors.oldPassword.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="newPassword">{t('settings.new_password')}</Label>
              <Input
                id="newPassword"
                type="password"
                autoComplete="new-password"
                {...register('newPassword')}
              />
              {errors.newPassword && (
                <p className="text-xs text-destructive">{errors.newPassword.message}</p>
              )}
            </div>
            <Button type="submit" disabled={pwSubmitting}>
              {pwSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('settings.save_changes')}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            {t('settings.external_monitoring.section_title')}
          </CardTitle>
          <CardDescription>{t('settings.external_monitoring.section_desc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex max-w-md flex-col gap-3">
            <div className="space-y-2">
              <Label htmlFor="pmm-url">{t('settings.external_monitoring.url_label')}</Label>
              <Input
                id="pmm-url"
                type="url"
                placeholder={t('settings.external_monitoring.url_placeholder')}
                value={effectivePmmUrl}
                onChange={(e) => setPmmUrlInput(e.target.value)}
                disabled={pmmConfig.isPending}
              />
            </div>
            <Button onClick={onSavePmm} disabled={setPmm.isPending} className="w-fit">
              {setPmm.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('settings.save_changes')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileClock className="h-4 w-4" />
            {t('settings.audit.section_title')}
          </CardTitle>
          <CardDescription>{t('settings.audit.section_desc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex max-w-md flex-col gap-3">
            <div className="space-y-2">
              <Label htmlFor="audit-retention">{t('settings.audit.days_label')}</Label>
              <Input
                id="audit-retention"
                type="number"
                min={1}
                max={365}
                value={effectiveRetention}
                onChange={(e) => setRetentionInput(Number(e.target.value))}
                disabled={retention.isPending}
              />
            </div>
            <Button onClick={onSaveRetention} disabled={setRetention.isPending} className="w-fit">
              {setRetention.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('settings.save_changes')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            {t('settings.ssl.section_title')}
          </CardTitle>
          <CardDescription>{t('settings.ssl.section_desc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex max-w-md flex-col gap-6">
            {/* ACME email — v0.4 carry-over (env wins, settings fallback). */}
            <div className="space-y-2">
              <Label htmlFor="acme-email">
                {t('settings.ssl.email_label')}
              </Label>
              <Input
                id="acme-email"
                type="email"
                placeholder="ops@example.com"
                value={effectiveAcmeEmail}
                onChange={(e) => setAcmeEmailInput(e.target.value)}
                disabled={
                  acmeConfig.isPending ||
                  acmeConfig.data?.emailSource === 'env'
                }
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                {acmeConfig.data?.emailSource === 'env'
                  ? t('settings.ssl.email_env_locked', {
                      value: acmeConfig.data.email ?? '',
                    })
                  : t('settings.ssl.email_hint')}
              </p>
              {acmeConfig.data?.emailSource !== 'env' && (
                <Button
                  onClick={onSaveAcmeEmail}
                  disabled={setAcmeConfig.isPending || acmeEmailInput === null}
                  className="w-fit"
                >
                  {setAcmeConfig.isPending && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  {t('settings.save_changes')}
                </Button>
              )}
            </div>

            <Separator />

            <div className="space-y-2">
              <Label htmlFor="cf-token">
                {t('settings.ssl.cf_token_label')}
              </Label>
              <div className="flex gap-2">
                <Input
                  id="cf-token"
                  type={showCfToken ? 'text' : 'password'}
                  placeholder={
                    acmeConfig.data?.cloudflareTokenSet
                      ? t('settings.ssl.cf_token_set_placeholder')
                      : t('settings.ssl.cf_token_unset_placeholder')
                  }
                  value={cfTokenInput}
                  onChange={(e) => setCfTokenInput(e.target.value)}
                  disabled={acmeConfig.isPending}
                  autoComplete="off"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCfToken((v) => !v)}
                >
                  {showCfToken
                    ? t('settings.ssl.hide')
                    : t('settings.ssl.show')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('settings.ssl.cf_token_hint')}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={onSaveCfToken}
                disabled={setAcmeConfig.isPending || !cfTokenInput.trim()}
                className="w-fit"
              >
                {setAcmeConfig.isPending && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                {t('settings.save_changes')}
              </Button>
              {acmeConfig.data?.cloudflareTokenSet && (
                <Button
                  variant="outline"
                  onClick={onClearCfToken}
                  disabled={setAcmeConfig.isPending}
                  className="w-fit"
                >
                  {t('settings.ssl.clear')}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <PhpFpmStatusCard />


      <Card>
        <CardHeader>
          <CardTitle>{t('settings.about')}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {info.isPending ? (
            <Skeleton className="h-20 w-full" />
          ) : info.data ? (
            <dl className="grid gap-x-6 gap-y-2 md:grid-cols-2">
              <Row label={t('settings.version')} value="0.1.0-dev" />
              <Row label={t('dashboard.hostname')} value={info.data.hostname} />
              <Row label={t('dashboard.os')} value={`${info.data.os.distro} ${info.data.os.release}`} />
              <Row label={t('dashboard.kernel')} value={info.data.os.kernel} />
              <Row label={t('dashboard.arch')} value={info.data.os.arch} />
              <Row label={t('settings.license')} value="Apache-2.0" />
            </dl>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function PhpFpmStatusCard() {
  const { t } = useTranslation();
  const status = usePhpFpmStatus();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" />
          {t('settings.phpfpm.section_title')}
        </CardTitle>
        <CardDescription>{t('settings.phpfpm.section_desc')}</CardDescription>
      </CardHeader>
      <CardContent>
        {status.isPending ? (
          <Skeleton className="h-12 w-full" />
        ) : status.data ? (
          <dl className="grid max-w-md gap-x-6 gap-y-2 text-sm md:grid-cols-2">
            <Row
              label={t('settings.phpfpm.mode_label')}
              value={t(`settings.phpfpm.mode.${status.data.mode}`)}
            />
            <Row
              label={t('settings.phpfpm.upstream_label')}
              value={status.data.upstream}
            />
            {status.data.containerName && (
              <Row
                label={t('settings.phpfpm.container_label')}
                value={status.data.containerName}
              />
            )}
            {status.data.containerRunning !== null && (
              <Row
                label={t('settings.phpfpm.running_label')}
                value={
                  status.data.containerRunning
                    ? t('common.yes')
                    : t('common.no')
                }
              />
            )}
          </dl>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 py-1">
      <dt className="w-32 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
