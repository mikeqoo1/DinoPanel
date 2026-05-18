import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  useSystemLog,
  useSshLog,
  useOperationLog,
  useLoginLog,
  useTaskLog,
} from '@/hooks/use-logs';

type LogSubTab = 'system' | 'ssh' | 'operation' | 'login' | 'task' | 'website';

export function LogsTab() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<LogSubTab>('system');

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as LogSubTab)}>
      <TabsList>
        <TabsTrigger value="system">{t('system.logs.sub.system')}</TabsTrigger>
        <TabsTrigger value="ssh">{t('system.logs.sub.ssh')}</TabsTrigger>
        <TabsTrigger value="operation">{t('system.logs.sub.operation')}</TabsTrigger>
        <TabsTrigger value="login">{t('system.logs.sub.login')}</TabsTrigger>
        <TabsTrigger value="task">{t('system.logs.sub.task')}</TabsTrigger>
        <TabsTrigger value="website" disabled>
          {t('system.logs.sub.website')}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="system" className="mt-4">
        <SystemPanel />
      </TabsContent>
      <TabsContent value="ssh" className="mt-4">
        <SshPanel />
      </TabsContent>
      <TabsContent value="operation" className="mt-4">
        <OperationPanel />
      </TabsContent>
      <TabsContent value="login" className="mt-4">
        <LoginPanel />
      </TabsContent>
      <TabsContent value="task" className="mt-4">
        <TaskPanel />
      </TabsContent>
      <TabsContent value="website" className="mt-4">
        <Card className="p-6 text-sm text-muted-foreground">
          {t('system.logs.website_disabled')}
        </Card>
      </TabsContent>
    </Tabs>
  );
}

// ---------------------------------------------------------------------------
// System log
// ---------------------------------------------------------------------------

function SystemPanel() {
  const { t } = useTranslation();
  const [grep, setGrep] = useState('');
  const q = useSystemLog({ grep: grep || undefined, limit: 300 });

  return (
    <div className="space-y-3">
      <Input
        placeholder={t('system.logs.filter.grep')}
        value={grep}
        onChange={(e) => setGrep(e.target.value)}
      />
      {q.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : !q.data || q.data.items.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">{t('system.logs.empty')}</Card>
      ) : (
        <Card className="max-h-[60vh] overflow-auto p-0">
          <ul className="divide-y font-mono text-xs">
            {q.data.items.map((line, i) => (
              <li key={i} className="px-3 py-1.5 whitespace-pre-wrap break-all">
                <span className="text-muted-foreground">
                  {new Date(line.ts).toLocaleTimeString()}
                </span>{' '}
                {line.line}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SSH log
// ---------------------------------------------------------------------------

function SshPanel() {
  const { t } = useTranslation();
  const q = useSshLog();
  if (q.isPending) return <Skeleton className="h-64 w-full" />;
  if (!q.data || q.data.items.length === 0) {
    return <Card className="p-6 text-sm text-muted-foreground">{t('system.logs.empty')}</Card>;
  }
  return (
    <Card className="max-h-[60vh] overflow-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left">
          <tr>
            <th className="p-3 font-medium">{t('system.logs.col_ts')}</th>
            <th className="p-3 font-medium">{t('system.logs.col_result')}</th>
            <th className="p-3 font-medium">{t('system.logs.col_username')}</th>
            <th className="p-3 font-medium">{t('system.logs.col_ip')}</th>
          </tr>
        </thead>
        <tbody>
          {q.data.items.map((row, i) => (
            <tr key={i} className="border-t">
              <td className="p-3 font-mono text-xs">{new Date(row.ts).toLocaleString()}</td>
              <td className="p-3">
                <Badge variant={row.status === 'accepted' ? 'default' : 'destructive'}>
                  {row.status}
                </Badge>
              </td>
              <td className="p-3 font-mono">{row.user ?? '—'}</td>
              <td className="p-3 font-mono text-xs">{row.ip ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Operation log (DinoPanel audit)
// ---------------------------------------------------------------------------

function OperationPanel() {
  const { t } = useTranslation();
  const [pathLike, setPathLike] = useState('');
  const q = useOperationLog({ pathLike: pathLike || undefined });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-3">
      <Input
        placeholder={t('system.logs.filter.path_like')}
        value={pathLike}
        onChange={(e) => setPathLike(e.target.value)}
      />
      {q.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">{t('system.logs.empty')}</Card>
      ) : (
        <>
          <Card className="max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="p-3 font-medium">{t('system.logs.col_ts')}</th>
                  <th className="p-3 font-medium">{t('system.logs.col_method')}</th>
                  <th className="p-3 font-medium">{t('system.logs.col_path')}</th>
                  <th className="p-3 font-medium">{t('system.logs.col_status')}</th>
                  <th className="p-3 font-medium">{t('system.logs.col_duration')}</th>
                  <th className="p-3 font-medium">{t('system.logs.col_ip')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="p-3 font-mono text-xs">
                      {new Date(r.createdAt).toLocaleString()}
                    </td>
                    <td className="p-3 font-mono">{r.method}</td>
                    <td className="p-3 font-mono text-xs">{r.path}</td>
                    <td className="p-3">
                      <Badge variant={r.statusCode < 400 ? 'default' : 'destructive'}>
                        {r.statusCode}
                      </Badge>
                    </td>
                    <td className="p-3 text-muted-foreground">{r.durationMs}ms</td>
                    <td className="p-3 font-mono text-xs">{r.ip ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          {q.hasNextPage && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => q.fetchNextPage()}
              disabled={q.isFetchingNextPage}
            >
              {t('system.logs.load_more')}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Login log
// ---------------------------------------------------------------------------

function LoginPanel() {
  const { t } = useTranslation();
  const q = useLoginLog();
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  if (q.isPending) return <Skeleton className="h-64 w-full" />;
  if (rows.length === 0) {
    return <Card className="p-6 text-sm text-muted-foreground">{t('system.logs.empty')}</Card>;
  }
  return (
    <div className="space-y-3">
      <Card className="max-h-[60vh] overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="p-3 font-medium">{t('system.logs.col_ts')}</th>
              <th className="p-3 font-medium">{t('system.logs.col_username')}</th>
              <th className="p-3 font-medium">{t('system.logs.col_result')}</th>
              <th className="p-3 font-medium">{t('system.logs.col_reason')}</th>
              <th className="p-3 font-medium">{t('system.logs.col_ip')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-3 font-mono text-xs">{new Date(r.createdAt).toLocaleString()}</td>
                <td className="p-3 font-mono">{r.username}</td>
                <td className="p-3">
                  <Badge variant={r.result === 'success' ? 'default' : 'destructive'}>
                    {r.result}
                  </Badge>
                </td>
                <td className="p-3 text-muted-foreground">{r.reason ?? '—'}</td>
                <td className="p-3 font-mono text-xs">{r.ip ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {q.hasNextPage && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => q.fetchNextPage()}
          disabled={q.isFetchingNextPage}
        >
          {t('system.logs.load_more')}
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Task log
// ---------------------------------------------------------------------------

function TaskPanel() {
  const { t } = useTranslation();
  const q = useTaskLog();
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  if (q.isPending) return <Skeleton className="h-64 w-full" />;
  if (rows.length === 0) {
    return <Card className="p-6 text-sm text-muted-foreground">{t('system.logs.empty')}</Card>;
  }
  return (
    <div className="space-y-3">
      <Card className="max-h-[60vh] overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="p-3 font-medium">{t('system.logs.col_ts')}</th>
              <th className="p-3 font-medium">{t('system.logs.col_task')}</th>
              <th className="p-3 font-medium">{t('system.logs.col_run_status')}</th>
              <th className="p-3 font-medium">{t('system.logs.col_duration')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-3 font-mono text-xs">
                  {new Date(r.startedAt).toLocaleString()}
                </td>
                <td className="p-3 font-mono">#{r.taskId}</td>
                <td className="p-3">
                  <Badge
                    variant={
                      r.status === 'success'
                        ? 'default'
                        : r.status === 'failed'
                          ? 'destructive'
                          : 'secondary'
                    }
                  >
                    {r.status}
                  </Badge>
                </td>
                <td className="p-3 text-muted-foreground">
                  {r.finishedAt ? `${r.finishedAt - r.startedAt}ms` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {q.hasNextPage && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => q.fetchNextPage()}
          disabled={q.isFetchingNextPage}
        >
          {t('system.logs.load_more')}
        </Button>
      )}
    </div>
  );
}
