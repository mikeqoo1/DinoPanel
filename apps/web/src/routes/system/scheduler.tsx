import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Play, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import type {
  CreateScheduledTaskBody,
  ScheduledTask,
  UserFacingTaskType,
} from '@dinopanel/shared';
import { useDatabases } from '@/hooks/use-databases';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { extractErrorMessage } from '@/lib/api';
import {
  useScheduledTasks,
  useCreateScheduledTask,
  useDeleteScheduledTask,
  useRunTaskNow,
  useTaskRuns,
} from '@/hooks/use-scheduler';

type UiType = UserFacingTaskType;

export function SchedulerTab() {
  const { t } = useTranslation();
  const tasks = useScheduledTasks();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">{t('system.scheduler.title')}</h2>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="mr-1 h-4 w-4" />
          {t('system.scheduler.add')}
        </Button>
      </div>

      {tasks.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : !tasks.data || tasks.data.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">
          {t('system.scheduler.empty')}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="w-8"></th>
                <th className="p-3 font-medium">{t('system.scheduler.col_name')}</th>
                <th className="p-3 font-medium">{t('system.scheduler.col_type')}</th>
                <th className="p-3 font-medium font-mono text-xs">
                  {t('system.scheduler.col_cron')}
                </th>
                <th className="p-3 font-medium">{t('system.scheduler.col_next')}</th>
                <th className="p-3 font-medium text-right">
                  {t('system.scheduler.col_actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {tasks.data.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  expanded={expanded === task.id}
                  onToggle={() => setExpanded(expanded === task.id ? null : task.id)}
                />
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <AddTaskDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

function TaskRow({
  task,
  expanded,
  onToggle,
}: {
  task: ScheduledTask;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const runNow = useRunTaskNow();
  const remove = useDeleteScheduledTask();

  const handleRun = async () => {
    try {
      await runNow.mutateAsync(task.id);
      toast.success(t('system.scheduler.run_started'));
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  const handleDelete = async () => {
    if (!confirm(t('system.scheduler.delete_confirm', { name: task.name }))) return;
    try {
      await remove.mutateAsync(task.id);
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  return (
    <>
      <tr className="border-t">
        <td className="p-3">
          <button onClick={onToggle} className="text-muted-foreground hover:text-foreground">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </td>
        <td className="p-3">
          <div className="flex items-center gap-2">
            <span className="font-medium">{task.name}</span>
            {task.builtin && <Badge variant="secondary">builtin</Badge>}
          </div>
        </td>
        <td className="p-3 text-muted-foreground">
          {t(`system.scheduler.type.${task.type}`)}
        </td>
        <td className="p-3 font-mono text-xs">{task.cron}</td>
        <td className="p-3 text-muted-foreground">
          {task.nextRunAt ? new Date(task.nextRunAt).toLocaleString() : '—'}
        </td>
        <td className="p-3">
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRun}
              disabled={runNow.isPending}
              title={t('system.scheduler.run_now')}
            >
              <Play className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDelete}
              disabled={task.builtin || remove.isPending}
              title={t('system.scheduler.delete')}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="border-t bg-muted/20">
          <td colSpan={6} className="p-4">
            <RunsList taskId={task.id} />
          </td>
        </tr>
      )}
    </>
  );
}

function RunsList({ taskId }: { taskId: number }) {
  const { t } = useTranslation();
  const runs = useTaskRuns(taskId);
  if (runs.isPending) return <Skeleton className="h-16 w-full" />;
  if (!runs.data || runs.data.items.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('system.scheduler.no_runs')}</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t('system.scheduler.run_log')}
      </p>
      <ul className="space-y-1 text-sm">
        {runs.data.items.slice(0, 5).map((run) => (
          <li key={run.id} className="flex items-baseline gap-3">
            <span className="font-mono text-xs text-muted-foreground">
              {new Date(run.startedAt).toLocaleString()}
            </span>
            <RunStatusBadge status={run.status} />
            <span className="text-xs text-muted-foreground">
              {run.finishedAt ? `${run.finishedAt - run.startedAt}ms` : '—'}
            </span>
            {run.exitCode !== null && (
              <span className="text-xs text-muted-foreground">exit={run.exitCode}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RunStatusBadge({ status }: { status: string }) {
  const variant: 'default' | 'secondary' | 'destructive' | 'outline' =
    status === 'success' ? 'default'
    : status === 'failed' ? 'destructive'
    : status === 'running' ? 'secondary'
    : 'outline';
  return <Badge variant={variant}>{status}</Badge>;
}

// ---------------------------------------------------------------------------
// Add Task Dialog
// ---------------------------------------------------------------------------

function AddTaskDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
}) {
  const { t } = useTranslation();
  const create = useCreateScheduledTask();

  const [name, setName] = useState('');
  const [type, setType] = useState<UiType>('shell');
  const [payload, setPayload] = useState<Record<string, unknown>>({ command: '' });
  const [cron, setCron] = useState('*/5 * * * *');

  const reset = () => {
    setName('');
    setType('shell');
    setPayload({ command: '' });
    setCron('*/5 * * * *');
  };

  const onTypeChange = (next: UiType) => {
    setType(next);
    setPayload(defaultPayloadFor(next));
  };

  const handleSubmit = async () => {
    const body: CreateScheduledTaskBody = {
      name: name.trim(),
      type,
      cron: cron.trim(),
      payload: normalizePayload(type, payload),
      enabled: true,
    };
    try {
      await create.mutateAsync(body);
      toast.success(t('system.scheduler.create_success'));
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  // Reset on every close (cancel / escape / overlay), not just on a
  // successful submit — otherwise a failed db_backup submit + cancel leaves
  // stale type/payload that reappears when the dialog is reopened.
  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  // db_backup payload is required + constrained (instanceId int, retentionGroup
  // matches the backend regex/length, keepLastN in [1,365]). The HTML5
  // pattern/min/max on the inputs are decorative here (Radix dialog + onClick
  // submit, not a native form), so gate submission in JS to mirror the schema.
  const dbBackupInvalid =
    type === 'db_backup' &&
    (() => {
      const rg = String(payload.retentionGroup ?? '').trim();
      const n = payload.keepLastN as number;
      return (
        !Number.isInteger(payload.instanceId as number) ||
        rg.length < 1 ||
        rg.length > 32 ||
        !/^[a-z0-9][a-z0-9-]*$/.test(rg) ||
        !Number.isInteger(n) ||
        n < 1 ||
        n > 365
      );
    })();

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('system.scheduler.dialog.title')}</DialogTitle>
          <DialogDescription>
            <span className="font-mono text-xs">{cron}</span>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t('system.scheduler.dialog.name_label')}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t('system.scheduler.dialog.type_label')}</Label>
            <select
              className="block w-full rounded-md border bg-background p-2 text-sm"
              value={type}
              onChange={(e) => onTypeChange(e.target.value as UiType)}
            >
              <option value="shell">{t('system.scheduler.type.shell')}</option>
              <option value="backup_files">
                {t('system.scheduler.type.backup_files')}
              </option>
              <option value="clean_logs">{t('system.scheduler.type.clean_logs')}</option>
              <option value="restart_service">
                {t('system.scheduler.type.restart_service')}
              </option>
              <option value="http_request">
                {t('system.scheduler.type.http_request')}
              </option>
              <option value="db_backup">{t('system.scheduler.type.db_backup')}</option>
            </select>
          </div>
          <PayloadForm type={type} payload={payload} onChange={setPayload} />
          <div className="space-y-2">
            <Label>{t('system.scheduler.dialog.cron_label')}</Label>
            <CronBuilder value={cron} onChange={setCron} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              !name.trim() || !cron.trim() || create.isPending || dbBackupInvalid
            }
          >
            {t('system.scheduler.dialog.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Payload form per task type
// ---------------------------------------------------------------------------

function defaultPayloadFor(type: UiType): Record<string, unknown> {
  switch (type) {
    case 'shell':
      return { command: '' };
    case 'backup_files':
      return { sources: [], targetDir: '' };
    case 'clean_logs':
      return { path: '/var/log', olderThanDays: 30 };
    case 'restart_service':
      return { unit: '' };
    case 'http_request':
      return { url: '', method: 'GET' };
    case 'db_backup':
      return { instanceId: undefined, retentionGroup: '', keepLastN: 7 };
  }
}

function normalizePayload(type: UiType, raw: Record<string, unknown>): unknown {
  if (type === 'backup_files') {
    const sourcesRaw = String(raw.sources ?? '').trim();
    const sources = sourcesRaw
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    return { sources, targetDir: raw.targetDir };
  }
  if (type === 'clean_logs') {
    return { ...raw, olderThanDays: Number(raw.olderThanDays) };
  }
  if (type === 'http_request') {
    let body = raw.body;
    if (typeof body === 'string' && body.trim()) {
      try {
        body = JSON.parse(body);
      } catch {
        // leave as string
      }
    } else {
      body = undefined;
    }
    return { ...raw, body };
  }
  if (type === 'db_backup') {
    return {
      instanceId: Number(raw.instanceId),
      retentionGroup: String(raw.retentionGroup ?? '').trim(),
      keepLastN: Number(raw.keepLastN),
    };
  }
  return raw;
}

function PayloadForm({
  type,
  payload,
  onChange,
}: {
  type: UiType;
  payload: Record<string, unknown>;
  onChange: (p: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const databases = useDatabases();
  const set = (k: string, v: unknown) => onChange({ ...payload, [k]: v });

  switch (type) {
    case 'shell':
      return (
        <div className="space-y-2">
          <Label>{t('system.scheduler.dialog.shell_command')}</Label>
          <textarea
            className="block w-full rounded-md border bg-background p-2 font-mono text-sm"
            rows={3}
            value={String(payload.command ?? '')}
            onChange={(e) => set('command', e.target.value)}
          />
        </div>
      );
    case 'backup_files':
      return (
        <>
          <div className="space-y-2">
            <Label>{t('system.scheduler.dialog.backup_sources')}</Label>
            <textarea
              className="block w-full rounded-md border bg-background p-2 font-mono text-sm"
              rows={3}
              value={String(payload.sources ?? '')}
              onChange={(e) => set('sources', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>{t('system.scheduler.dialog.backup_target')}</Label>
            <Input
              value={String(payload.targetDir ?? '')}
              onChange={(e) => set('targetDir', e.target.value)}
            />
          </div>
        </>
      );
    case 'clean_logs':
      return (
        <>
          <div className="space-y-2">
            <Label>{t('system.scheduler.dialog.clean_path')}</Label>
            <Input
              value={String(payload.path ?? '')}
              onChange={(e) => set('path', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>{t('system.scheduler.dialog.clean_days')}</Label>
            <Input
              type="number"
              min={1}
              value={Number(payload.olderThanDays ?? 30)}
              onChange={(e) => set('olderThanDays', Number(e.target.value))}
            />
          </div>
        </>
      );
    case 'restart_service':
      return (
        <div className="space-y-2">
          <Label>{t('system.scheduler.dialog.restart_unit')}</Label>
          <Input
            value={String(payload.unit ?? '')}
            onChange={(e) => set('unit', e.target.value)}
            placeholder="nginx.service"
          />
        </div>
      );
    case 'http_request':
      return (
        <>
          <div className="space-y-2">
            <Label>{t('system.scheduler.dialog.http_url')}</Label>
            <Input
              value={String(payload.url ?? '')}
              onChange={(e) => set('url', e.target.value)}
              placeholder="https://example.com/ping"
            />
          </div>
          <div className="space-y-2">
            <Label>{t('system.scheduler.dialog.http_method')}</Label>
            <select
              className="block w-full rounded-md border bg-background p-2 text-sm"
              value={String(payload.method ?? 'GET')}
              onChange={(e) => set('method', e.target.value)}
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label>{t('system.scheduler.dialog.http_body')}</Label>
            <textarea
              className="block w-full rounded-md border bg-background p-2 font-mono text-sm"
              rows={3}
              value={String(payload.body ?? '')}
              onChange={(e) => set('body', e.target.value)}
            />
          </div>
        </>
      );
    case 'db_backup':
      return (
        <>
          <div className="space-y-2">
            <Label>{t('system.scheduler.dialog.db_instance')}</Label>
            <select
              className="block w-full rounded-md border bg-background p-2 text-sm"
              value={payload.instanceId !== undefined ? String(payload.instanceId) : ''}
              onChange={(e) => set('instanceId', e.target.value ? Number(e.target.value) : undefined)}
            >
              <option value="">—</option>
              {(databases.data ?? []).map((db) => (
                <option key={db.id} value={db.id}>
                  {db.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label>{t('system.scheduler.dialog.db_retention_group')}</Label>
            <Input
              value={String(payload.retentionGroup ?? '')}
              onChange={(e) => set('retentionGroup', e.target.value)}
              pattern="[a-z0-9][a-z0-9-]*"
              maxLength={32}
              placeholder="nightly"
            />
          </div>
          <div className="space-y-2">
            <Label>{t('system.scheduler.dialog.db_keep_last_n')}</Label>
            <Input
              type="number"
              min={1}
              max={365}
              value={Number(payload.keepLastN ?? 7)}
              onChange={(e) => set('keepLastN', Number(e.target.value))}
            />
          </div>
        </>
      );
  }
}

// ---------------------------------------------------------------------------
// Cron builder
// ---------------------------------------------------------------------------

type CronMode = 'every_minutes' | 'every_hours' | 'daily_at' | 'weekly_on' | 'monthly_on' | 'advanced';

function CronBuilder({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<CronMode>('every_minutes');
  const [n, setN] = useState(5);
  const [hour, setHour] = useState(3);
  const [minute, setMinute] = useState(0);
  const [day, setDay] = useState(1);
  const [weekday, setWeekday] = useState(1);
  const [raw, setRaw] = useState(value);

  const computed = useMemo(() => {
    switch (mode) {
      case 'every_minutes':
        return `*/${n} * * * *`;
      case 'every_hours':
        return `0 */${n} * * *`;
      case 'daily_at':
        return `${minute} ${hour} * * *`;
      case 'weekly_on':
        return `${minute} ${hour} * * ${weekday}`;
      case 'monthly_on':
        return `${minute} ${hour} ${day} * *`;
      case 'advanced':
        return raw;
    }
  }, [mode, n, hour, minute, day, weekday, raw]);

  // Propagate to parent whenever builder output changes
  useMemo(() => {
    onChange(computed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computed]);

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="grid grid-cols-2 gap-2 text-sm">
        <ModeBtn mode={mode} value="every_minutes" onSelect={setMode}>
          {t('system.scheduler.cron.every_minutes')}
        </ModeBtn>
        <ModeBtn mode={mode} value="every_hours" onSelect={setMode}>
          {t('system.scheduler.cron.every_hours')}
        </ModeBtn>
        <ModeBtn mode={mode} value="daily_at" onSelect={setMode}>
          {t('system.scheduler.cron.daily_at')}
        </ModeBtn>
        <ModeBtn mode={mode} value="weekly_on" onSelect={setMode}>
          {t('system.scheduler.cron.weekly_on')}
        </ModeBtn>
        <ModeBtn mode={mode} value="monthly_on" onSelect={setMode}>
          {t('system.scheduler.cron.monthly_on')}
        </ModeBtn>
        <ModeBtn mode={mode} value="advanced" onSelect={setMode}>
          {t('system.scheduler.cron.advanced')}
        </ModeBtn>
      </div>

      {(mode === 'every_minutes' || mode === 'every_hours') && (
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label>{t('system.scheduler.cron.every_n_label')}</Label>
            <Input
              type="number"
              min={1}
              max={mode === 'every_minutes' ? 59 : 23}
              className="w-20"
              value={n}
              onChange={(e) => setN(Math.max(1, Number(e.target.value)))}
            />
          </div>
        </div>
      )}

      {(mode === 'daily_at' || mode === 'weekly_on' || mode === 'monthly_on') && (
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label>{t('system.scheduler.cron.hour_label')}</Label>
            <Input
              type="number"
              min={0}
              max={23}
              className="w-20"
              value={hour}
              onChange={(e) => setHour(clamp(Number(e.target.value), 0, 23))}
            />
          </div>
          <div className="space-y-1">
            <Label>{t('system.scheduler.cron.minute_label')}</Label>
            <Input
              type="number"
              min={0}
              max={59}
              className="w-20"
              value={minute}
              onChange={(e) => setMinute(clamp(Number(e.target.value), 0, 59))}
            />
          </div>
          {mode === 'weekly_on' && (
            <div className="space-y-1">
              <Label>{t('system.scheduler.cron.weekday_label')}</Label>
              <select
                className="rounded-md border bg-background p-2 text-sm"
                value={weekday}
                onChange={(e) => setWeekday(Number(e.target.value))}
              >
                {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                  <option key={d} value={d}>
                    {t(`system.scheduler.cron.weekday.${d}`)}
                  </option>
                ))}
              </select>
            </div>
          )}
          {mode === 'monthly_on' && (
            <div className="space-y-1">
              <Label>{t('system.scheduler.cron.day_label')}</Label>
              <Input
                type="number"
                min={1}
                max={31}
                className="w-20"
                value={day}
                onChange={(e) => setDay(clamp(Number(e.target.value), 1, 31))}
              />
            </div>
          )}
        </div>
      )}

      {mode === 'advanced' && (
        <Input
          className="font-mono"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="0 * * * *"
        />
      )}

      <p className="text-xs text-muted-foreground">
        {t('system.scheduler.cron.preview')}:{' '}
        <span className="font-mono">{computed}</span>
      </p>
    </div>
  );
}

function ModeBtn({
  mode,
  value,
  onSelect,
  children,
}: {
  mode: CronMode;
  value: CronMode;
  onSelect: (m: CronMode) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={cn(
        'rounded-md border px-3 py-1.5 text-left text-sm',
        mode === value
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border hover:bg-muted',
      )}
    >
      {children}
    </button>
  );
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
