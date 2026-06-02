import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';

const NtpTab = lazy(() => import('./ntp').then((m) => ({ default: m.NtpTab })));
const Fail2banTab = lazy(() => import('./fail2ban').then((m) => ({ default: m.Fail2banTab })));
const DiskTab = lazy(() => import('./disk').then((m) => ({ default: m.DiskTab })));
const ServicesTab = lazy(() => import('./services').then((m) => ({ default: m.ServicesTab })));

type TabValue = 'ntp' | 'fail2ban' | 'disk' | 'services';

export function pickTab(pathname: string): TabValue {
  if (pathname.endsWith('/fail2ban')) return 'fail2ban';
  if (pathname.endsWith('/disk')) return 'disk';
  if (pathname.endsWith('/services')) return 'services';
  return 'ntp';
}

export function ToolboxPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const current = pickTab(location.pathname);

  const onChange = (value: string) => {
    navigate(value === 'ntp' ? '/toolbox' : `/toolbox/${value}`);
  };

  const fallback = <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('toolbox.title')}</h1>
      <Tabs value={current} onValueChange={onChange} className="w-full">
        <TabsList>
          <TabsTrigger value="ntp">{t('toolbox.tabs.ntp')}</TabsTrigger>
          <TabsTrigger value="fail2ban">{t('toolbox.tabs.fail2ban')}</TabsTrigger>
          <TabsTrigger value="disk">{t('toolbox.tabs.disk')}</TabsTrigger>
          <TabsTrigger value="services">{t('toolbox.tabs.services')}</TabsTrigger>
        </TabsList>
        <TabsContent value="ntp" className="mt-4">
          <Suspense fallback={fallback}>
            <NtpTab />
          </Suspense>
        </TabsContent>
        <TabsContent value="fail2ban" className="mt-4">
          <Suspense fallback={fallback}>
            <Fail2banTab />
          </Suspense>
        </TabsContent>
        <TabsContent value="disk" className="mt-4">
          <Suspense fallback={fallback}>
            <DiskTab />
          </Suspense>
        </TabsContent>
        <TabsContent value="services" className="mt-4">
          <Suspense fallback={fallback}>
            <ServicesTab />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}
