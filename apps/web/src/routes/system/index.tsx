import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { OverviewTab } from './overview';

const FirewallTab = lazy(() => import('./firewall').then((m) => ({ default: m.FirewallTab })));
const SchedulerTab = lazy(() => import('./scheduler').then((m) => ({ default: m.SchedulerTab })));
const LogsTab = lazy(() => import('./logs').then((m) => ({ default: m.LogsTab })));

type TabValue = 'overview' | 'firewall' | 'scheduler' | 'logs';

function pickTab(pathname: string): TabValue {
  if (pathname.endsWith('/firewall')) return 'firewall';
  if (pathname.endsWith('/scheduler')) return 'scheduler';
  if (pathname.endsWith('/logs')) return 'logs';
  return 'overview';
}

export function SystemPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const current = pickTab(location.pathname);

  const onChange = (value: string) => {
    const next = value === 'overview' ? '/system' : `/system/${value}`;
    navigate(next, { replace: false });
  };

  const tabFallback = <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('system.title')}</h1>
      <Tabs value={current} onValueChange={onChange} className="w-full">
        <TabsList>
          <TabsTrigger value="overview">{t('system.tabs.overview')}</TabsTrigger>
          <TabsTrigger value="firewall">{t('system.tabs.firewall')}</TabsTrigger>
          <TabsTrigger value="scheduler">{t('system.tabs.scheduler')}</TabsTrigger>
          <TabsTrigger value="logs">{t('system.tabs.logs')}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-4">
          <OverviewTab />
        </TabsContent>
        <TabsContent value="firewall" className="mt-4">
          <Suspense fallback={tabFallback}>
            <FirewallTab />
          </Suspense>
        </TabsContent>
        <TabsContent value="scheduler" className="mt-4">
          <Suspense fallback={tabFallback}>
            <SchedulerTab />
          </Suspense>
        </TabsContent>
        <TabsContent value="logs" className="mt-4">
          <Suspense fallback={tabFallback}>
            <LogsTab />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}
