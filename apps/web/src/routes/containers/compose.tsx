import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Play,
  Square,
  RotateCcw,
  Download,
  Pencil,
  Trash2,
  Plus,
  Workflow,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { extractErrorMessage } from '@/lib/api';
import { useComposeStacks, useComposeActions } from '@/hooks/use-compose';
import type { ComposeStack } from '@dinopanel/shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEMPLATE = `services:
  app:
    image: nginx:latest
    ports:
      - "8080:80"
`;

const NAME_RE = /^[a-z0-9_-]+$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function SourceBadge({ source }: { source: ComposeStack['source'] }) {
  const { t } = useTranslation();
  return (
    <Badge variant={source === 'registered' ? 'secondary' : 'muted'}>
      {t(`compose.source.${source}`)}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Create Stack Dialog
// ---------------------------------------------------------------------------

interface CreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function CreateDialog({ open, onOpenChange }: CreateDialogProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { create } = useComposeActions();

  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [content, setContent] = useState(TEMPLATE);
  const [submitting, setSubmitting] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const defaultPath = (n: string) =>
    n ? `~/dinopanel-stacks/${n}/` : '';

  const handleNameChange = (v: string) => {
    setName(v);
    // Only auto-update path if user hasn't manually changed it
    if (!path || path === defaultPath(name)) {
      setPath(defaultPath(v));
    }
    setNameError(null);
  };

  const handleSubmit = async () => {
    if (!name) { setNameError(t('compose.create_dialog.name_required')); return; }
    if (!NAME_RE.test(name)) { setNameError(t('compose.create_dialog.name_invalid')); return; }
    setSubmitting(true);
    try {
      const stack = await create({ name, path: path || defaultPath(name), content });
      toast.success(t('compose.create_success', { name: stack.name }));
      onOpenChange(false);
      void navigate(`/compose/${stack.name}`);
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = (o: boolean) => {
    if (!o) {
      setName('');
      setPath('');
      setContent(TEMPLATE);
      setNameError(null);
    }
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('compose.create_dialog.title')}</DialogTitle>
          <DialogDescription>{t('compose.create_dialog.desc')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="stack-name">{t('compose.create_dialog.name_label')}</Label>
            <Input
              id="stack-name"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="my-app"
              className="font-mono"
              autoComplete="off"
            />
            {nameError && <p className="text-xs text-destructive">{nameError}</p>}
            <p className="text-xs text-muted-foreground">
              {t('compose.create_dialog.name_hint')}
            </p>
          </div>

          {/* Path */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="stack-path">{t('compose.create_dialog.path_label')}</Label>
            <Input
              id="stack-path"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="~/dinopanel-stacks/my-app/"
              className="font-mono"
            />
          </div>

          {/* Initial content */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="stack-content">{t('compose.create_dialog.content_label')}</Label>
            <textarea
              id="stack-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={8}
              className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={submitting || !name}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('compose.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Row actions (extracted so each row gets its own loading state)
// ---------------------------------------------------------------------------

interface RowActionsProps {
  stack: ComposeStack;
}

function RowActions({ stack }: RowActionsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { unregister } = useComposeActions();
  const [pending, setPending] = useState<string | null>(null);

  const handleUnregister = async () => {
    if (stack.id === null) return;
    setPending('unregister');
    try {
      await unregister(stack.id);
      toast.success(t('compose.unregister_success', { name: stack.name }));
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex items-center gap-1">
      {/* Edit */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => void navigate(`/compose/${stack.name}`)}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('compose.actions.edit')}</TooltipContent>
      </Tooltip>

      {/* Up */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => void navigate(`/compose/${stack.name}?action=up`)}
          >
            <Play className="h-3.5 w-3.5 text-green-600" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('compose.actions.up')}</TooltipContent>
      </Tooltip>

      {/* Down */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => void navigate(`/compose/${stack.name}?action=down`)}
          >
            <Square className="h-3.5 w-3.5 text-red-500" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('compose.actions.down')}</TooltipContent>
      </Tooltip>

      {/* Restart */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => void navigate(`/compose/${stack.name}?action=restart`)}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('compose.actions.restart')}</TooltipContent>
      </Tooltip>

      {/* Pull */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => void navigate(`/compose/${stack.name}?action=pull`)}
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('compose.actions.pull')}</TooltipContent>
      </Tooltip>

      {/* Unregister — only for registered stacks */}
      {stack.source === 'registered' && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => void handleUnregister()}
              disabled={pending === 'unregister'}
            >
              {pending === 'unregister' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('compose.actions.unregister')}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function ComposePage() {
  const { t } = useTranslation();
  const [createOpen, setCreateOpen] = useState(false);

  const { data: stacks, isPending, error, refetch } = useComposeStacks();

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{t('compose.title')}</h1>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          {t('compose.create')}
        </Button>
      </div>

      {/* Content */}
      {isPending ? (
        <div className="flex flex-col gap-2">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 py-12 text-sm text-muted-foreground">
          <p className="text-destructive">{extractErrorMessage(error)}</p>
          <Button size="sm" variant="outline" onClick={() => void refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : !stacks || stacks.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
          <Workflow className="h-12 w-12 opacity-30" />
          <p className="text-sm">{t('compose.empty')}</p>
          <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            {t('compose.create')}
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                <th className="px-4 py-2 text-left font-medium">{t('compose.col_source')}</th>
                <th className="px-4 py-2 text-left font-medium">{t('compose.col_name')}</th>
                <th className="px-4 py-2 text-left font-medium">{t('compose.col_path')}</th>
                <th className="px-4 py-2 text-left font-medium">{t('compose.col_services')}</th>
                <th className="px-4 py-2 text-left font-medium">{t('compose.col_containers')}</th>
                <th className="px-4 py-2 text-left font-medium">{t('compose.col_actions')}</th>
              </tr>
            </thead>
            <tbody>
              {stacks.map((stack) => (
                <tr key={`${stack.source}-${stack.name}`} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="px-4 py-3">
                    <SourceBadge source={stack.source} />
                  </td>
                  <td className="px-4 py-3 font-mono font-medium">{stack.name}</td>
                  <td className="max-w-[200px] px-4 py-3">
                    <span className="block truncate font-mono text-xs text-muted-foreground" title={stack.path}>
                      {stack.path}
                    </span>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{stack.services.length}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        stack.runningCount > 0
                          ? 'font-medium text-green-600 dark:text-green-400'
                          : 'text-muted-foreground'
                      }
                    >
                      {stack.runningCount}
                    </span>
                    <span className="text-muted-foreground"> / {stack.containerCount}</span>
                  </td>
                  <td className="px-4 py-3">
                    <RowActions stack={stack} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
