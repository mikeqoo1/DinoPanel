import { Home, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BreadcrumbProps {
  path: string;
  onNavigate: (path: string) => void;
}

export function PathBreadcrumb({ path, onNavigate }: BreadcrumbProps) {
  const parts = path.split('/').filter(Boolean);
  const segments = [
    { label: '/', path: '/' },
    ...parts.map((part, idx) => ({
      label: part,
      path: '/' + parts.slice(0, idx + 1).join('/'),
    })),
  ];

  return (
    <nav className="flex items-center gap-1 overflow-x-auto whitespace-nowrap text-sm">
      {segments.map((seg, idx) => (
        <div key={seg.path} className="flex items-center gap-1">
          {idx > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
          <button
            onClick={() => onNavigate(seg.path)}
            className={cn(
              'rounded px-2 py-1 transition-colors hover:bg-accent',
              idx === segments.length - 1 && 'font-medium text-foreground',
              idx !== segments.length - 1 && 'text-muted-foreground',
            )}
          >
            {idx === 0 ? <Home className="h-3.5 w-3.5" /> : seg.label}
          </button>
        </div>
      ))}
    </nav>
  );
}
