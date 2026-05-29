import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppShell } from '@/components/layout/app-shell';
import { AuthGuard } from '@/routes/auth-guard';
import { LoginPage } from '@/routes/login';

const DashboardPage = lazy(() => import('@/routes/dashboard').then((m) => ({ default: m.DashboardPage })));
const TerminalPage = lazy(() => import('@/routes/terminal').then((m) => ({ default: m.TerminalPage })));
const FilesPage = lazy(() => import('@/routes/files').then((m) => ({ default: m.FilesPage })));
const SettingsPage = lazy(() => import('@/routes/settings').then((m) => ({ default: m.SettingsPage })));
const ContainersPage = lazy(() => import('@/routes/containers/containers').then((m) => ({ default: m.ContainersPage })));
const ContainerDetailPage = lazy(() => import('@/routes/containers/container-detail').then((m) => ({ default: m.ContainerDetailPage })));
const ImagesPage = lazy(() => import('@/routes/containers/images').then((m) => ({ default: m.ImagesPage })));
const NetworksPage = lazy(() => import('@/routes/containers/networks').then((m) => ({ default: m.NetworksPage })));
const VolumesPage = lazy(() => import('@/routes/containers/volumes').then((m) => ({ default: m.VolumesPage })));
const ComposePage = lazy(() => import('@/routes/containers/compose').then((m) => ({ default: m.ComposePage })));
const ComposeDetailPage = lazy(() => import('@/routes/containers/compose-detail').then((m) => ({ default: m.ComposeDetailPage })));
const MonitoringPage = lazy(() => import('@/routes/monitoring').then((m) => ({ default: m.MonitoringPage })));
const SystemPage = lazy(() => import('@/routes/system').then((m) => ({ default: m.SystemPage })));
const WebsitesPage = lazy(() => import('@/routes/websites').then((m) => ({ default: m.WebsitesPage })));
const DatabasesPage = lazy(() => import('@/routes/databases').then((m) => ({ default: m.DatabasesPage })));
const BackupsPage = lazy(() => import('@/routes/backups').then((m) => ({ default: m.BackupsPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

export default function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={200}>
          <BrowserRouter>
            <Suspense fallback={<div className="p-8 text-muted-foreground">Loading…</div>}>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route
                  element={
                    <AuthGuard>
                      <AppShell />
                    </AuthGuard>
                  }
                >
                  <Route index element={<DashboardPage />} />
                  <Route path="/terminal" element={<TerminalPage />} />
                  <Route path="/files" element={<FilesPage />} />
                  <Route path="/containers" element={<ContainersPage />} />
                  <Route path="/containers/:id" element={<ContainerDetailPage />} />
                  <Route path="/images" element={<ImagesPage />} />
                  <Route path="/networks" element={<NetworksPage />} />
                  <Route path="/volumes" element={<VolumesPage />} />
                  <Route path="/compose" element={<ComposePage />} />
                  <Route path="/compose/:key" element={<ComposeDetailPage />} />
                  <Route path="/monitoring" element={<MonitoringPage />} />
                  <Route path="/websites" element={<WebsitesPage />} />
                  <Route path="/databases" element={<DatabasesPage />} />
                  <Route path="/backups" element={<BackupsPage />} />
                  <Route path="/system/*" element={<SystemPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
