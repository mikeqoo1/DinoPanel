import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, KeyRound, ServerOff, ShieldAlert } from 'lucide-react';
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
const ENGINE_LABEL: Record<'docker' | 'podman', string> = { docker: 'Docker', podman: 'Podman' };


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

function ContainersSection({ node }: { node: RemoteNode }) {
  const { t } = useTranslation();
  const { data, isPending, error } = useNodeContainers(node.id);

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

  if (data.sudoFailed) {
    return (
      <Card className="flex items-center gap-2 p-4 text-sm text-yellow-700 dark:text-yellow-400">
        <ShieldAlert className="h-4 w-4 shrink-0" />
        {t('nodes.containers.sudo_failed', { user: node.user })}
      </Card>
    );
  }

  const denied = data.engines.filter((e) => e.permissionDenied);
  const okEngines = Array.from(new Set(data.engines.filter((e) => e.ok).map((e) => e.engine)));

  return (
    <Card className="overflow-x-auto">
      <div className="flex flex-wrap items-center gap-2 p-3 text-sm font-medium">
        {t('nodes.containers.title')}
        {okEngines.map((e) => (
          <Badge key={e} variant="outline">{ENGINE_LABEL[e]}</Badge>
        ))}
      </div>
      {denied.length > 0 && (
        <div className="flex items-start gap-2 border-t px-3 py-2 text-xs text-yellow-700 dark:text-yellow-400">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {denied
              .map((e) => t('nodes.containers.engine_denied', { engine: ENGINE_LABEL[e.engine], user: e.owner }))
              .join(' · ')}
          </span>
        </div>
      )}
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left">
          <tr>
            <th className="p-3 font-medium">{t('nodes.containers.col_name')}</th>
            <th className="p-3 font-medium">{t('nodes.containers.col_image')}</th>
            <th className="p-3 font-medium">{t('nodes.containers.col_engine')}</th>
            <th className="p-3 font-medium">{t('nodes.containers.col_state')}</th>
            <th className="p-3 font-medium">{t('nodes.containers.col_status')}</th>
          </tr>
        </thead>
        <tbody>
          {data.containers.length === 0 ? (
            <tr>
              <td colSpan={5} className="p-3 text-muted-foreground">
                {t('nodes.containers.empty')}
              </td>
            </tr>
          ) : (
            data.containers.map((c) => (
              <tr key={`${c.engine}:${c.owner}:${c.id}`} className="border-t align-top">
                <td className="p-3 font-mono text-xs">{c.name}</td>
                <td className="p-3 font-mono text-xs">{c.image}</td>
                <td className="p-3 text-xs">
                  <Badge variant="outline">{ENGINE_LABEL[c.engine]}</Badge>
                  <span className="ml-1 font-mono text-muted-foreground">{c.owner}</span>
                </td>
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
  const [sudoPassword, setSudoPassword] = useState('');

  const reset = () => {
    setName('');
    setHost('');
    setUser('root');
    setPort('22');
    setSudoPassword('');
  };

  const submit = async () => {
    try {
      await add.mutateAsync({
        name: name.trim(),
        host: host.trim(),
        user: user.trim(),
        port: parseInt(port, 10) || 22,
        ...(sudoPassword ? { sudoPassword } : {}),
      });
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
          <div className="grid gap-1.5">
            <Label htmlFor="node-sudo">{t('nodes.dialog.sudo_label')}</Label>
            <Input
              id="node-sudo"
              type="password"
              autoComplete="off"
              value={sudoPassword}
              onChange={(e) => setSudoPassword(e.target.value)}
              disabled={user.trim() === 'root'}
            />
            <p className="text-xs text-muted-foreground">{t('nodes.dialog.sudo_hint')}</p>
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
  // Picking a node collapses the list so its metrics/containers sit at the top of the page.
  const [listCollapsed, setListCollapsed] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [testResult, setTestResult] = useState<Record<string, number | string>>({});

  const { data: nodes, isPending, error } = useNodes();
  const remove = useRemoveNode();
  const test = useTestNode();

  const handleSelect = (node: RemoteNode) => {
    const deselect = selectedId === node.id;
    setSelectedId(deselect ? null : node.id);
    setListCollapsed(!deselect);
  };

  const handleTest = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      const res = await test.mutateAsync(id);
      const label =
        res.sudoOk === undefined
          ? res.latencyMs
          : t(res.sudoOk ? 'nodes.test_sudo_ok' : 'nodes.test_sudo_bad', { ms: res.latencyMs });
      setTestResult((prev) => ({ ...prev, [id]: label }));
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
      if (selectedId === node.id) {
        setSelectedId(null);
        setListCollapsed(false);
      }
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  const selectedNode = nodes?.find((n) => n.id === selectedId) ?? null;

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{t('nodes.title')}</h1>
        <div className="flex items-center gap-2">
          {selectedNode && (
            <Button size="sm" variant="ghost" onClick={() => setListCollapsed((v) => !v)}>
              {listCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              {listCollapsed
                ? t('nodes.list_show', { count: nodes?.length ?? 0 })
                : t('nodes.list_hide')}
            </Button>
          )}
          <Button size="sm" onClick={() => setAddOpen(true)}>{t('nodes.add')}</Button>
        </div>
      </div>

      {isPending && <Skeleton className="h-32 w-full" />}
      {error && (
        <Card className="p-4 text-sm text-destructive">{extractErrorMessage(error)}</Card>
      )}

      {!isPending && !error && !(listCollapsed && selectedNode) && (
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
                    <td className="p-3 font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        {node.name}
                        {node.hasSudo && (
                          <KeyRound className="h-3.5 w-3.5 text-muted-foreground" aria-label={t('nodes.sudo_badge')} />
                        )}
                      </span>
                    </td>
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
          <ContainersSection node={selectedNode} />
        </div>
      )}

      <AddNodeDialog open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}
