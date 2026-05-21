import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
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
      <main className="flex-1 overflow-auto bg-background">
        <Outlet />
      </main>
    </div>
  );
}
