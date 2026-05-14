import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TerminalView } from '@/components/terminal/terminal-view';
import { cn } from '@/lib/utils';

interface Tab {
  id: string;
  label: string;
}

let nextTabId = 1;

export function TerminalPage() {
  const { t } = useTranslation();
  const [tabs, setTabs] = useState<Tab[]>(() => [{ id: 't1', label: 'shell 1' }]);
  const [activeId, setActiveId] = useState<string>('t1');

  const handleNew = useCallback(() => {
    nextTabId++;
    const id = `t${Date.now()}_${nextTabId}`;
    setTabs((prev) => [...prev, { id, label: `shell ${prev.length + 1}` }]);
    setActiveId(id);
  }, []);

  const handleClose = useCallback(
    (id: string) => {
      setTabs((prev) => {
        if (prev.length === 1) return prev;
        const next = prev.filter((t) => t.id !== id);
        if (id === activeId && next[0]) setActiveId(next[0].id);
        return next;
      });
    },
    [activeId],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b bg-card px-2 py-1.5 overflow-x-auto">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            role="tab"
            tabIndex={0}
            aria-selected={tab.id === activeId}
            onClick={() => setActiveId(tab.id)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setActiveId(tab.id)}
            className={cn(
              'group flex shrink-0 cursor-pointer items-center gap-2 rounded-md px-3 py-1 text-xs font-medium transition-colors',
              tab.id === activeId
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-accent',
            )}
          >
            <span>{tab.label}</span>
            {tabs.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleClose(tab.id);
                }}
                aria-label={t('terminal.close_tab')}
                className="rounded p-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
        <Button size="icon-sm" variant="ghost" onClick={handleNew} aria-label={t('terminal.new_tab')}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="relative flex-1 overflow-hidden">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={cn('absolute inset-0', tab.id !== activeId && 'invisible')}
          >
            <TerminalView active={tab.id === activeId} />
          </div>
        ))}
      </div>
    </div>
  );
}
