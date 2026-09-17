import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Boxes, Trash2 } from 'lucide-react';
import type { NexusInstance, NexusPoint, NexusRange } from '@dinopanel/shared';
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
import { formatBytes, formatRate } from '@/lib/utils';
import {
  useNexusInstances,
  useAddNexusInstance,
  useRemoveNexusInstance,
  useTestNexusInstance,
  useNexusSeries,
  useNexusRepositories,
} from '@/hooks/use-nexus';

const RANGES: NexusRange[] = ['1h', '24h', '7d'];
/** A sample older than this means the poller could not reach the instance. */
const STALE_MS = 180_000;

function timeLabel(ts: number, range: NexusRange): string {
  const d = new Date(ts);
  return range === '7d'
    ? `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:00`
    : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ─── Chart ───────────────────────────────────────────────────────────────────

function TrafficChart({
  points,
  range,
  series,
  format,
}: {
  points: NexusPoint[];
  range: NexusRange;
  series: { key: keyof NexusPoint; label: string; color: string }[];
  format: (v: number) => string;
}) {
  const rows = points.map((p) => ({ ...p, label: timeLabel(p.ts, range) }));
  return (
    <ResponsiveContainer width="100%" height={160}>
      <AreaChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`nexus-${String(s.key)}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={32} stroke="var(--color-muted-foreground)" />
        <YAxis tick={{ fontSize: 11 }} width={62} tickFormatter={format} stroke="var(--color-muted-foreground)" />
        <Tooltip
          contentStyle={{
            background: 'var(--color-popover)',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            fontSize: 12,
          }}
          formatter={(v: number, name: string) => [format(v), name]}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {series.map((s) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={2}
            fill={`url(#nexus-${String(s.key)})`}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─── Repositories ────────────────────────────────────────────────────────────

function RepositoriesTable({ id }: { id: string }) {
  const { t } = useTranslation();
  const { data, isPending, error } = useNexusRepositories(id);

  if (isPending) return <Skeleton className="h-24 w-full" />;
  if (error || !data) return null;

  const withSize = [...data].sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left">
          <tr>
            <th className="p-2 font-medium">{t('nexus.repo.col_name')}</th>
            <th className="p-2 font-medium">{t('nexus.repo.col_format')}</th>
            <th className="p-2 font-medium">{t('nexus.repo.col_type')}</th>
            <th className="p-2 font-medium">{t('nexus.repo.col_size')}</th>
          </tr>
        </thead>
        <tbody>
          {withSize.map((r) => (
            <tr key={r.name} className="border-t">
              <td className="p-2 font-mono text-xs">
                {r.name}
                {!r.online && <Badge variant="muted" className="ml-2">{t('nexus.repo.offline')}</Badge>}
              </td>
              <td className="p-2 text-xs">{r.format}</td>
              <td className="p-2 text-xs text-muted-foreground">{r.type}</td>
              <td className="p-2 font-mono text-xs">{r.size === null ? '—' : formatBytes(r.size)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── One instance ────────────────────────────────────────────────────────────

function InstanceCard({ instance }: { instance: NexusInstance }) {
  const { t } = useTranslation();
  const [range, setRange] = useState<NexusRange>('1h');
  const { data, isPending, error } = useNexusSeries(instance.id, range);
  const remove = useRemoveNexusInstance();
  const test = useTestNexusInstance();

  const handleRemove = async () => {
    if (!window.confirm(t('nexus.remove_confirm', { name: instance.name }))) return;
    try {
      await remove.mutateAsync(instance.id);
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  const handleTest = async () => {
    try {
      const m = await test.mutateAsync(instance.id);
      toast.success(t('nexus.test_ok', { requests: m.requests, bytes: formatBytes(m.bytesDown) }));
    } catch (err) {
      const code = getApiErrorCode(err);
      toast.error(code ? t(`nexus.error.${code}`, { defaultValue: extractErrorMessage(err) }) : extractErrorMessage(err));
    }
  };

  const last = data?.points[data.points.length - 1];
  const stale = data?.latestTs != null && Date.now() - data.latestTs > STALE_MS;
  const formats = Object.entries(data?.latest?.byFormat ?? {}).sort((a, b) => b[1].down - a[1].down);

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Boxes className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{instance.name}</span>
          <a href={instance.url} target="_blank" rel="noreferrer" className="font-mono text-xs text-muted-foreground hover:underline">
            {instance.url}
          </a>
          {data?.latestTs == null ? (
            <Badge variant="secondary">{t('nexus.no_samples')}</Badge>
          ) : stale ? (
            <Badge variant="warning">{t('nexus.stale')}</Badge>
          ) : (
            <Badge variant="success">{t('nexus.live')}</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border p-0.5">
            {RANGES.map((r) => (
              <Button
                key={r}
                size="sm"
                variant={range === r ? 'secondary' : 'ghost'}
                className="h-7 px-2 text-xs"
                onClick={() => setRange(r)}
              >
                {t(`nexus.range.${r}`)}
              </Button>
            ))}
          </div>
          <Button size="sm" variant="outline" disabled={test.isPending} onClick={() => void handleTest()}>
            {t('nexus.test')}
          </Button>
          <Button size="sm" variant="destructive" disabled={remove.isPending} onClick={() => void handleRemove()}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : error ? (
        <div className="text-sm text-destructive">{extractErrorMessage(error)}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            <div>
              <div className="text-xs text-muted-foreground">{t('nexus.now_requests')}</div>
              <div className="text-lg font-semibold">{(last?.requests ?? 0).toFixed(2)}<span className="ml-1 text-xs font-normal text-muted-foreground">/s</span></div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t('nexus.now_down')}</div>
              <div className="text-lg font-semibold">{formatRate(last?.bytesDown ?? 0)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t('nexus.total_requests')}</div>
              <div className="text-lg font-semibold">{(data?.latest?.requests ?? 0).toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t('nexus.total_down')}</div>
              <div className="text-lg font-semibold">{formatBytes(data?.latest?.bytesDown ?? 0)}</div>
            </div>
          </div>

          {data && data.points.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              {t('nexus.waiting_samples')}
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">{t('nexus.chart_requests')}</div>
                <TrafficChart
                  points={data?.points ?? []}
                  range={range}
                  format={(v) => v.toFixed(v < 10 ? 2 : 0)}
                  series={[
                    { key: 'requests', label: t('nexus.series_requests'), color: 'var(--color-chart-1)' },
                    { key: 'errors', label: t('nexus.series_errors'), color: 'var(--color-chart-5)' },
                  ]}
                />
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">{t('nexus.chart_bytes')}</div>
                <TrafficChart
                  points={data?.points ?? []}
                  range={range}
                  format={(v) => formatBytes(v, 0)}
                  series={[
                    { key: 'bytesDown', label: t('nexus.series_down'), color: 'var(--color-chart-2)' },
                    { key: 'bytesUp', label: t('nexus.series_up'), color: 'var(--color-chart-3)' },
                  ]}
                />
              </div>
            </div>
          )}

          {formats.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground">{t('nexus.by_format')}</span>
              {formats.map(([name, v]) => (
                <Badge key={name} variant="outline">
                  {name} ↓{formatBytes(v.down)}
                  {v.up > 0 && ` ↑${formatBytes(v.up)}`}
                </Badge>
              ))}
            </div>
          )}

          <RepositoriesTable id={instance.id} />
        </>
      )}
    </Card>
  );
}

// ─── Add dialog ──────────────────────────────────────────────────────────────

function AddInstanceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const add = useAddNexusInstance();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('http://');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const reset = () => {
    setName('');
    setUrl('http://');
    setUsername('');
    setPassword('');
  };

  const submit = async () => {
    try {
      await add.mutateAsync({
        name: name.trim(),
        url: url.trim().replace(/\/+$/, ''),
        username: username.trim(),
        password,
      });
      toast.success(t('nexus.dialog.added'));
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
          <DialogTitle>{t('nexus.dialog.title')}</DialogTitle>
        </DialogHeader>

        <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
          {t('nexus.dialog.hint')}
        </div>

        <div className="space-y-3">
          <div className="grid gap-1.5">
            <Label htmlFor="nexus-name">{t('nexus.dialog.name_label')}</Label>
            <Input id="nexus-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="ConeX-dev1" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="nexus-url">{t('nexus.dialog.url_label')}</Label>
            <Input id="nexus-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://192.168.198.121:18081" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="nexus-user">{t('nexus.dialog.user_label')}</Label>
              <Input id="nexus-user" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="nexus-pass">{t('nexus.dialog.password_label')}</Label>
              <Input id="nexus-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleClose}>{t('common.cancel')}</Button>
          <Button disabled={add.isPending || !name.trim() || !username.trim() || !password} onClick={() => void submit()}>
            {t('nexus.dialog.add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function NexusPage() {
  const { t } = useTranslation();
  const [addOpen, setAddOpen] = useState(false);
  const { data: instances, isPending, error } = useNexusInstances();

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{t('nexus.title')}</h1>
        <Button size="sm" onClick={() => setAddOpen(true)}>{t('nexus.add')}</Button>
      </div>

      {isPending && <Skeleton className="h-48 w-full" />}
      {error && <Card className="p-4 text-sm text-destructive">{extractErrorMessage(error)}</Card>}

      {!isPending && !error && (instances?.length ?? 0) === 0 && (
        <Card className="p-6 text-sm text-muted-foreground">{t('nexus.empty')}</Card>
      )}

      {instances?.map((instance) => (
        <InstanceCard key={instance.id} instance={instance} />
      ))}

      <AddInstanceDialog open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}
