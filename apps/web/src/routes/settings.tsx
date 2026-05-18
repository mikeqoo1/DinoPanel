import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Lock, Sun, Moon, Monitor, Activity } from 'lucide-react';
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 py-1">
      <dt className="w-32 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
