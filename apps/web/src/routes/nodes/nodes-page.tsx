import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ServerOff } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { extractErrorMessage, getApiErrorCode } from '@/lib/api';
import { formatBytes, formatDuration } from '@/lib/utils';
import {
  useNodes,
  useAddNode,
  useRemoveNode,
  useTestNode,
  useNodeMetrics,
  useNodeContainers,
} from '@/hooks/use-nodes';
import type { RemoteNode } from '@dinopanel/shared';

// Map error code → Badge variant
function errorPillVariant(code: string | null): 'destructive' | 'warning' | 'muted' {
  if (code === 'NODES_AUTH_FAILED' || code === 'NODES_HOSTKEY_CHANGED') return 'destructive';
  if (code === 'NODES_UNREACHABLE' || code === 'NODES_TIMEOUT') return 'warning';
  return 'muted';
}

function ErrorPill({ err }: { err: unknown }) {
  const { t } = useTranslation();
  const code = getApiErrorCode(err);
  const label = code ? t(`nodes.error.${code}`, { defaultValue: extractErrorMessage(err) }) : extractErrorMessage(err);
  return <Badge variant={errorPillVariant(code)}>{label}</Badge>;
}

// ─── Metrics card ────────────────────────────────────────────────────────────

function MetricsSection({ nodeId }: { nodeId: string }) {
  const { t } = useTranslation();
  const { data, isPending, error } = useNodeMetrics(nodeId);

  if (isPending) return <Skeleton className="h-28 w-full" />;
  if (error) {
    return (
      <Card className="flex items-center gap-3 p-4 text-sm">
        <ErrorPill err={error} />
        <span className="text-muted-foreground">{t('nodes.metrics.title')}</span>
      </Card>
    );
  }

  const memPct = data.mem.total > 0 ? ((data.mem.used / data.mem.total) * 100).toFixed(1) : '—';

  return (
    <Card className="space-y-3 p-4 text-sm">
      <div className="font-medium">{t('nodes.metrics.title')}</div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
        <div>
          <div className="text-xs text-muted-foreground">{t('nodes.metrics.cpu')}</div>
          <div className="font-mono">{data.cpu.usage.toFixed(1)}%</div>
          <div className="text-xs text-muted-foreground">
            {t('nodes.metrics.load')} {data.cpu.loadAvg.map((v) => v.toFixed(2)).join(' ')}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">{t('nodes.metrics.mem')}</div>
          <div className="font-mono">{memPct}%</div>
          <div className="text-xs text-muted-foreground">
            {formatBytes(data.mem.used)} / {formatBytes(data.mem.total)}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">{t('nodes.metrics.uptime')}</div>
          <div className="font-mono">{formatDuration(data.uptimeSec)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">{t('nodes.metrics.disk')}</div>
          {data.disks.map((d) => (
            <div key={d.mount} className="font-mono text-xs">
              {d.mount}: {d.total > 0 ? `${((d.used / d.total) * 100).toFixed(1)}% · ` : ''}
              {formatBytes(d.used)}/{formatBytes(d.total)}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ─── Containers card ─────────────────────────────────────────────────────────

function ContainersSection({ nodeId }: { nodeId: string }) {
  const { t } = useTranslation();
  const { data, isPending, error } = useNodeContainers(nodeId);

  if (isPending) return <Skeleton className="h-28 w-full" />;
  if (error) {
    return (
      <Card className="flex items-center gap-3 p-4 text-sm">
        <ErrorPill err={error} />
        <span className="text-muted-foreground">{t('nodes.containers.title')}</span>
      </Card>
    );
  }

  if (!data.dockerAvailable) {
    return (
      <Card className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <ServerOff className="h-4 w-4 shrink-0" />
        {t('nodes.containers.no_docker')}
      </Card>
    );
  }

  return (
    <Card className="overflow-x-auto">
      <div className="p-3 text-sm font-medium">{t('nodes.containers.title')}</div>
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left">
          <tr>
            <th className="p-3 font-medium">{t('nodes.containers.col_name')}</th>
            <th className="p-3 font-medium">{t('nodes.containers.col_image')}</th>
            <th className="p-3 font-medium">{t('nodes.containers.col_state')}</th>
            <th className="p-3 font-medium">{t('nodes.containers.col_status')}</th>
          </tr>
        </thead>
        <tbody>
          {data.containers.length === 0 ? (
            <tr>
              <td colSpan={4} className="p-3 text-muted-foreground">
                {t('nodes.containers.empty')}
              </td>
            </tr>
          ) : (
            data.containers.map((c) => (
              <tr key={c.id} className="border-t align-top">
                <td className="p-3 font-mono text-xs">{c.name}</td>
                <td className="p-3 font-mono text-xs">{c.image}</td>
                <td className="p-3">
                  <Badge variant={c.state === 'running' ? 'success' : c.state === 'exited' || c.state === 'dead' ? 'muted' : 'secondary'}>
                    {c.state}
                  </Badge>
                </td>
                <td className="p-3 text-xs text-muted-foreground">{c.status}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </Card>
  );
}

// ─── Add node dialog ─────────────────────────────────────────────────────────

function AddNodeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const add = useAddNode();
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [user, setUser] = useState('root');
  const [port, setPort] = useState('22');

  const reset = () => {
    setName('');
    setHost('');
    setUser('root');
    setPort('22');
  };

  const submit = async () => {
    try {
      await add.mutateAsync({ name: name.trim(), host: host.trim(), user: user.trim(), port: parseInt(port, 10) || 22 });
      toast.success(t('nodes.dialog.added'));
      reset();
      onClose();
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('nodes.dialog.title')}</DialogTitle>
        </DialogHeader>

        {/* ssh-copy-id onboarding hint */}
        <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
          <div className="font-medium text-foreground">{t('nodes.dialog.hint_title')}</div>
          <div>{t('nodes.dialog.hint_body')}</div>
          <pre className="font-mono select-all rounded bg-background/60 px-2 py-1 text-xs">
            {host && user ? `ssh-copy-id ${user}@${host}` : t('nodes.dialog.hint_default')}
          </pre>
        </div>

        <div className="space-y-3">
          <div className="grid gap-1.5">
            <Label htmlFor="node-name">{t('nodes.dialog.name_label')}</Label>
            <Input id="node-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="rocky-235" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="node-host">{t('nodes.dialog.host_label')}</Label>
            <Input id="node-host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.199.235" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="node-user">{t('nodes.dialog.user_label')}</Label>
              <Input id="node-user" value={user} onChange={(e) => setUser(e.target.value)} placeholder="root" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="node-port">{t('nodes.dialog.port_label')}</Label>
              <Input id="node-port" value={port} onChange={(e) => setPort(e.target.value)} placeholder="22" type="number" min={1} max={65535} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleClose}>{t('common.cancel')}</Button>
          <Button
            disabled={!name.trim() || !host.trim() || !user.trim() || add.isPending}
            onClick={submit}
          >
            {t('nodes.dialog.add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function NodesPage() {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [testResult, setTestResult] = useState<Record<string, number | string>>({});

  const { data: nodes, isPending, error } = useNodes();
  const remove = useRemoveNode();
  const test = useTestNode();

  const handleSelect = (node: RemoteNode) => {
    setSelectedId((prev) => (prev === node.id ? null : node.id));
  };

  const handleTest = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      const res = await test.mutateAsync(id);
      setTestResult((prev) => ({ ...prev, [id]: res.latencyMs }));
    } catch {
      setTestResult((prev) => ({ ...prev, [id]: '✗' }));
      // single failure, no toast storm — just show in row
    }
  };

  const handleDelete = async (e: React.MouseEvent, node: RemoteNode) => {
    e.stopPropagation();
    if (!window.confirm(t('nodes.delete_confirm', { name: node.name }))) return;
    try {
      await remove.mutateAsync(node.id);
      if (selectedId === node.id) setSelectedId(null);
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  const selectedNode = nodes?.find((n) => n.id === selectedId) ?? null;

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{t('nodes.title')}</h1>
        <Button size="sm" onClick={() => setAddOpen(true)}>{t('nodes.add')}</Button>
      </div>

      {isPending && <Skeleton className="h-32 w-full" />}
      {error && (
        <Card className="p-4 text-sm text-destructive">{extractErrorMessage(error)}</Card>
      )}

      {!isPending && !error && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="p-3 font-medium">{t('nodes.col_name')}</th>
                <th className="p-3 font-medium">{t('nodes.col_host')}</th>
                <th className="p-3 font-medium">{t('nodes.col_user')}</th>
                <th className="p-3 font-medium">{t('nodes.col_port')}</th>
                <th className="p-3 font-medium">{t('nodes.col_actions')}</th>
              </tr>
            </thead>
            <tbody>
              {(!nodes || nodes.length === 0) ? (
                <tr>
                  <td colSpan={5} className="p-3 text-muted-foreground">{t('nodes.empty')}</td>
                </tr>
              ) : (
                nodes.map((node) => (
                  <tr
                    key={node.id}
                    onClick={() => handleSelect(node)}
                    className={`cursor-pointer border-t transition-colors hover:bg-muted/40 ${selectedId === node.id ? 'bg-muted/60' : ''}`}
                  >
                    <td className="p-3 font-medium">{node.name}</td>
                    <td className="p-3 font-mono text-xs">{node.host}</td>
                    <td className="p-3 font-mono text-xs">{node.user}</td>
                    <td className="p-3 font-mono text-xs">{node.port}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={test.isPending}
                          onClick={(e) => handleTest(e, node.id)}
                        >
                          {t('nodes.test')}
                          {testResult[node.id] !== undefined && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              {typeof testResult[node.id] === 'number'
                                ? t('nodes.latency', { ms: testResult[node.id] })
                                : testResult[node.id]}
                            </span>
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={remove.isPending}
                          onClick={(e) => handleDelete(e, node)}
                        >
                          {t('nodes.delete')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      )}

      {selectedNode && (
        <div className="space-y-3">
          <div className="text-sm font-medium text-muted-foreground">
            {selectedNode.name} — {selectedNode.user}@{selectedNode.host}:{selectedNode.port}
          </div>
          <MetricsSection nodeId={selectedNode.id} />
          <ContainersSection nodeId={selectedNode.id} />
        </div>
      )}

      <AddNodeDialog open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}
