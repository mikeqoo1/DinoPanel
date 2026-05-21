import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LayoutDashboard, Terminal, FolderOpen, Settings, Settings2, ChevronLeft, Container, Layers, Network, HardDrive, Workflow, Activity, Globe, Database } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { UserMenu } from './user-menu';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { t } = useTranslation();

  const items = [
    { to: '/', icon: LayoutDashboard, label: t('nav.dashboard'), end: true },
    { to: '/terminal', icon: Terminal, label: t('nav.terminal') },
    { to: '/files', icon: FolderOpen, label: t('nav.files') },
    { to: '/containers', icon: Container, label: t('nav.containers') },
    { to: '/images', icon: Layers, label: t('nav.images') },
    { to: '/networks', icon: Network, label: t('nav.networks') },
    { to: '/volumes', icon: HardDrive, label: t('nav.volumes') },
    { to: '/compose', icon: Workflow, label: t('nav.compose') },
    { to: '/monitoring', icon: Activity, label: t('nav.monitoring') },
    { to: '/websites', icon: Globe, label: t('nav.websites') },
    { to: '/databases', icon: Database, label: t('nav.databases') },
    { to: '/system', icon: Settings2, label: t('nav.system') },
    { to: '/settings', icon: Settings, label: t('nav.settings') },
  ];

  return (
    <aside
      className={cn(
        'flex h-full flex-col border-r bg-sidebar text-sidebar-foreground transition-[width] duration-200',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      <div className="flex h-14 items-center gap-2 px-3">
        <img src="/logo.png" alt="DinoPanel" className="h-8 w-8 rounded-md object-cover" />
        {!collapsed && (
          <div className="flex flex-col leading-tight">
            <span className="font-semibold">DinoPanel</span>
            <span className="text-[10px] text-muted-foreground">v0.4.6</span>
          </div>
        )}
      </div>
      <Separator />
      <nav className="flex-1 space-y-1 p-2">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                isActive && 'bg-sidebar-accent text-sidebar-accent-foreground',
                collapsed && 'justify-center px-0',
              )
            }
            title={collapsed ? item.label : undefined}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </NavLink>
        ))}
      </nav>
      <Separator />
      <div className="p-2">
        <UserMenu collapsed={collapsed} />
      </div>
      <div className="flex items-center justify-end p-2">
        <Button variant="ghost" size="icon-sm" onClick={onToggle} aria-label="Toggle sidebar">
          <ChevronLeft className={cn('h-4 w-4 transition-transform', collapsed && 'rotate-180')} />
        </Button>
      </div>
    </aside>
  );
}
