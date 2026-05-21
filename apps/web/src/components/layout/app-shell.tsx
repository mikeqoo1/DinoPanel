import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { APP_VERSION } from '@/lib/version';
import { Sidebar } from './sidebar';

const SIDEBAR_STORAGE = 'dinopanel.sidebar.collapsed';

export function AppShell() {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 1200px)').matches || localStorage.getItem(SIDEBAR_STORAGE) === '1';
  });

  useEffect(() => {
    localStorage.setItem(SIDEBAR_STORAGE, collapsed ? '1' : '0');
  }, [collapsed]);

  return (
    <div className="flex h-screen w-full overflow-hidden">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      <main className="relative flex-1 overflow-auto bg-background">
        {/* Version badge — fixed top-right, survives sidebar collapse,
            visible on every page without each route needing to opt in. */}
        <div className="pointer-events-none absolute right-4 top-3 z-10">
          <span className="rounded-md border border-border/40 bg-muted/40 px-2 py-0.5 font-mono text-[10px] text-muted-foreground backdrop-blur">
            DinoPanel v{APP_VERSION}
          </span>
        </div>
        <Outlet />
      </main>
    </div>
  );
}
