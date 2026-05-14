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
