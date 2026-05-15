import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { parseDocument } from 'yaml';
import type { YAMLError } from 'yaml';
import Editor, { type OnMount, type Monaco } from '@monaco-editor/react';
import {
  Play,
  Square,
  RotateCcw,
  Download,
  CheckCircle2,
  XCircle,
  ArrowLeft,
  Loader2,
  ShieldCheck,
  Save,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useTheme } from '@/components/theme-provider';
import { cn } from '@/lib/utils';
import { extractErrorMessage } from '@/lib/api';
import {
  useComposeStack,
  useComposeFile,
  useComposeActions,
  useComposeActionWs,
} from '@/hooks/use-compose';
import type { ComposeStack, ComposeValidation } from '@dinopanel/shared';
import type { ComposeActionType } from '@/hooks/use-compose';

// ---------------------------------------------------------------------------
// Theme constants (mirrors container-detail.tsx)
// ---------------------------------------------------------------------------

const lightTheme = {
  background: '#ffffff',
  foreground: '#1f2328',
  cursor: '#1f2328',
  selectionBackground: '#0969da33',
} as const;

const darkTheme = {
  background: '#0d1117',
  foreground: '#e6edf3',
  cursor: '#79c0ff',
  selectionBackground: '#3392ff44',
} as const;

// ---------------------------------------------------------------------------
// WsStatusDot (same pattern as container-detail)
// ---------------------------------------------------------------------------

function WsStatusDot({ status }: { status: 'connecting' | 'connected' | 'closed' }) {
  return (
    <span
      className={cn(
        'h-2 w-2 shrink-0 rounded-full',
        status === 'connected' && 'bg-green-500',
        status === 'connecting' && 'animate-pulse bg-yellow-500',
        status === 'closed' && 'bg-muted-foreground',
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Action Drawer — xterm + WS output
// ---------------------------------------------------------------------------

interface ActionDrawerProps {
  stackName: string;
  action: ComposeActionType;
  open: boolean;
  onClose: () => void;
}

function ActionDrawer({ stackName, action, open, onClose }: ActionDrawerProps) {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [exited, setExited] = useState<{ code: number } | null>(null);
  const [wsEnabled, setWsEnabled] = useState(false);

  // Reset when drawer opens for a new action
  useEffect(() => {
    if (open) {
      setExited(null);
      setWsEnabled(true);
      // Clear the terminal when re-running
      termRef.current?.clear();
      termRef.current?.reset();
    } else {
      setWsEnabled(false);
    }
  }, [open, action]);

  const handleData = useCallback((data: Uint8Array) => {
    termRef.current?.write(data);
  }, []);

  const handleExit = useCallback((code: number) => {
    setExited({ code });
    if (code === 0) {
      termRef.current?.writeln(`\r\n\x1b[32m[${t('compose.action_drawer.exit_success')}]\x1b[0m`);
    } else {
      termRef.current?.writeln(
        `\r\n\x1b[31m[${t('compose.action_drawer.exit_failed', { code })}]\x1b[0m`,
      );
    }
  }, [t]);

  const handleError = useCallback((message: string) => {
    setExited({ code: 1 });
    termRef.current?.writeln(`\r\n\x1b[31m[Error: ${message}]\x1b[0m`);
  }, []);

  const { status, cancel } = useComposeActionWs(
    stackName,
    action,
    wsEnabled,
    handleData,
    handleExit,
    handleError,
  );

  // Mount xterm once
  useEffect(() => {
    if (!containerRef.current) return;
    const term = new Terminal({
      fontFamily: '"JetBrains Mono", "Fira Code", Monaco, Menlo, Consolas, monospace',
      fontSize: 12,
      disableStdin: true,
      cursorBlink: false,
      scrollback: 10_000,
      theme: resolvedTheme === 'dark' ? darkTheme : lightTheme,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    termRef.current = term;
    fitRef.current = fit;
    fit.fit();

    const ro = new ResizeObserver(() => { try { fit.fit(); } catch { /* ignore */ } });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme sync
  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options.theme = resolvedTheme === 'dark' ? darkTheme : lightTheme;
  }, [resolvedTheme]);

  // Refit when dialog opens
  useEffect(() => {
    if (open) {
      setTimeout(() => { try { fitRef.current?.fit(); } catch { /* ignore */ } }, 50);
    }
  }, [open]);

  const handleClose = () => {
    cancel();
    setWsEnabled(false);
    onClose();
  };

  const handleRerun = () => {
    setExited(null);
    termRef.current?.clear();
    termRef.current?.reset();
    setWsEnabled(false);
    // Briefly disable then re-enable to remount WS
    setTimeout(() => setWsEnabled(true), 100);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="flex h-[600px] max-w-4xl flex-col p-0">
        <DialogHeader className="flex flex-row items-center gap-3 border-b px-4 py-3">
          <div className="flex flex-1 flex-col gap-0.5">
            <DialogTitle className="text-base">
              {t('compose.action_drawer.title', { action: t(`compose.actions.${action}`) })}
            </DialogTitle>
            <DialogDescription className="font-mono text-xs">{stackName}</DialogDescription>
          </div>
          <div className="flex items-center gap-2">
            <WsStatusDot status={status} />
            <span className="text-xs text-muted-foreground">
              {status === 'connected' && !exited && t('containers.logs.streaming')}
              {status === 'connecting' && t('containers.logs.connecting')}
              {(status === 'closed' || exited) && (
                exited?.code === 0
                  ? <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {t('compose.action_drawer.exit_success')}
                    </span>
                  : exited
                    ? <span className="flex items-center gap-1 text-destructive">
                        <XCircle className="h-3.5 w-3.5" />
                        {t('compose.action_drawer.exit_failed', { code: exited.code })}
                      </span>
                    : t('containers.logs.disconnected')
              )}
            </span>
          </div>
        </DialogHeader>

        <div
          ref={containerRef}
          className="flex-1 overflow-hidden"
          style={{ background: resolvedTheme === 'dark' ? darkTheme.background : lightTheme.background }}
        />

        <div className="flex justify-end gap-2 border-t px-4 py-3">
          {exited && (
            <Button size="sm" variant="outline" onClick={handleRerun}>
              <RotateCcw className="h-3.5 w-3.5" />
              {t('compose.action_drawer.rerun')}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={handleClose}>
            {t('compose.action_drawer.close')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Validate result panel
// ---------------------------------------------------------------------------

interface ValidateResultProps {
  result: ComposeValidation;
  onClose: () => void;
}

function ValidateResult({ result, onClose }: ValidateResultProps) {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const [showResolved, setShowResolved] = useState(false);

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {result.valid ? (
            <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
          ) : (
            <XCircle className="h-4 w-4 text-destructive" />
          )}
          <span className="text-sm font-medium">
            {result.valid
              ? t('compose.validate_result.valid')
              : t('compose.validate_result.invalid')}
          </span>
        </div>
        <Button size="icon-sm" variant="ghost" onClick={onClose}>
          <ChevronUp className="h-4 w-4" />
        </Button>
      </div>

      {/* Errors list */}
      {result.errors && result.errors.length > 0 && (
        <ul className="flex flex-col gap-1">
          {result.errors.map((e, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-destructive">
              <XCircle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                {e.line !== undefined && (
                  <span className="font-mono mr-1 text-muted-foreground">L{e.line}:</span>
                )}
                {e.message}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Resolved YAML toggle */}
      {result.valid && result.resolvedYaml && (
        <div>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => setShowResolved((p) => !p)}
          >
            {showResolved ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {t('compose.validate_result.resolved_yaml')}
          </Button>
          {showResolved && (
            <div className="mt-2 h-64 rounded-md border overflow-hidden">
              <Editor
                height="100%"
                defaultLanguage="yaml"
                value={result.resolvedYaml}
                theme={resolvedTheme === 'dark' ? 'vs-dark' : 'vs'}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  fontSize: 11,
                  lineNumbers: 'on',
                  folding: false,
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header / toolbar
// ---------------------------------------------------------------------------

interface ToolbarProps {
  stack: ComposeStack;
  dirty: boolean;
  saving: boolean;
  validating: boolean;
  onAction: (action: ComposeActionType) => void;
  onValidate: () => void;
  onSave: () => void;
}

function Toolbar({ stack, dirty, saving, validating, onAction, onValidate, onSave }: ToolbarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-2 border-b bg-card px-6 py-4">
      <div className="flex items-center gap-2">
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => void navigate('/compose')}
          aria-label={t('common.back')}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="font-mono text-lg font-semibold">{stack.name}</h1>
        <Badge variant={stack.source === 'registered' ? 'secondary' : 'muted'}>
          {t(`compose.source.${stack.source}`)}
        </Badge>
        <span className="max-w-[300px] truncate font-mono text-xs text-muted-foreground" title={stack.path}>
          {stack.path}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {/* Action buttons */}
        <Button size="sm" variant="outline" onClick={() => onAction('up')}>
          <Play className="h-3.5 w-3.5 text-green-600" />
          {t('compose.actions.up')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => onAction('down')}>
          <Square className="h-3.5 w-3.5 text-red-500" />
          {t('compose.actions.down')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => onAction('restart')}>
          <RotateCcw className="h-3.5 w-3.5" />
          {t('compose.actions.restart')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => onAction('pull')}>
          <Download className="h-3.5 w-3.5" />
          {t('compose.actions.pull')}
        </Button>

        <div className="flex-1" />

        {/* Validate */}
        <Button size="sm" variant="outline" onClick={onValidate} disabled={validating}>
          {validating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ShieldCheck className="h-3.5 w-3.5" />
          )}
          {t('compose.actions.validate')}
        </Button>

        {/* Save */}
        <Button
          size="sm"
          onClick={onSave}
          disabled={saving || !dirty}
          className={cn(dirty && 'ring-2 ring-primary/40')}
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          {saving ? t('compose.editor.saving') : t('compose.actions.save')}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main editor page
// ---------------------------------------------------------------------------

export function ComposeDetailPage() {
  const { key = '' } = useParams<{ key: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();

  const { data: stack, isPending: stackPending, error: stackError } = useComposeStack(key);
  const { data: file, isPending: filePending } = useComposeFile(key);
  const { updateFile, validate } = useComposeActions();

  const [content, setContent] = useState<string>('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validateResult, setValidateResult] = useState<ComposeValidation | null>(null);

  // Action drawer state
  const initialAction = searchParams.get('action') as ComposeActionType | null;
  const [drawerAction, setDrawerAction] = useState<ComposeActionType | null>(
    initialAction && ['up', 'down', 'restart', 'pull'].includes(initialAction)
      ? initialAction
      : null,
  );

  // Seed editor content once file loads
  useEffect(() => {
    if (file?.content !== undefined && !dirty) {
      setContent(file.content);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.content]);

  // Prompt on dirty navigate-away
  useEffect(() => {
    if (!dirty) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty]);

  // Clear ?action= param after opening drawer
  useEffect(() => {
    if (drawerAction && searchParams.has('action')) {
      setSearchParams({}, { replace: true });
    }
  }, [drawerAction, searchParams, setSearchParams]);

  const handleEditorMount: OnMount = (monacoEditor, monaco) => {
    const model = monacoEditor.getModel();
    if (!model) return;

    const toMarker = (
      diagnostic: YAMLError,
      severity: Monaco['MarkerSeverity'][keyof Monaco['MarkerSeverity']],
    ) => ({
      severity,
      message: diagnostic.message,
      startLineNumber: diagnostic.linePos?.[0]?.line ?? 1,
      startColumn: diagnostic.linePos?.[0]?.col ?? 1,
      endLineNumber: diagnostic.linePos?.[1]?.line ?? diagnostic.linePos?.[0]?.line ?? 1,
      endColumn: diagnostic.linePos?.[1]?.col ?? (diagnostic.linePos?.[0]?.col ?? 1) + 1,
    });

    const runLint = () => {
      const doc = parseDocument(model.getValue());
      const markers = [
        ...doc.errors.map((e) => toMarker(e, monaco.MarkerSeverity.Error)),
        ...doc.warnings.map((w) => toMarker(w, monaco.MarkerSeverity.Warning)),
      ];
      monaco.editor.setModelMarkers(model, 'yaml', markers);
    };

    runLint();

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const sub = model.onDidChangeContent(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(runLint, 200);
    });

    monacoEditor.onDidDispose(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      sub.dispose();
    });
  };

  const handleContentChange = (value: string | undefined) => {
    setContent(value ?? '');
    setDirty(true);
    setValidateResult(null);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateFile(key, content);
      setDirty(false);
      toast.success(t('compose.save_success'));
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleValidate = async () => {
    setValidating(true);
    setValidateResult(null);
    try {
      const result = await validate(key);
      setValidateResult(result);
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setValidating(false);
    }
  };

  const handleAction = (action: ComposeActionType) => {
    setDrawerAction(action);
  };

  const handleDrawerClose = () => {
    setDrawerAction(null);
  };

  // Loading states
  if (stackPending || filePending) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="flex-1 h-96 w-full" />
      </div>
    );
  }

  if (stackError || !stack) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-sm text-muted-foreground">
        <p className="text-destructive">{extractErrorMessage(stackError)}</p>
        <Button size="sm" variant="outline" onClick={() => void navigate('/compose')}>
          <ArrowLeft className="h-4 w-4" />
          {t('common.back')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <Toolbar
        stack={stack}
        dirty={dirty}
        saving={saving}
        validating={validating}
        onAction={handleAction}
        onValidate={() => void handleValidate()}
        onSave={() => void handleSave()}
      />

      {/* Validate result strip */}
      {validateResult && (
        <div className="border-b px-6 py-3">
          <ValidateResult result={validateResult} onClose={() => setValidateResult(null)} />
        </div>
      )}

      {/* Monaco editor */}
      <div className="flex-1 overflow-hidden">
        <Editor
          height="100%"
          defaultLanguage="yaml"
          value={content}
          theme={resolvedTheme === 'dark' ? 'vs-dark' : 'vs'}
          onMount={handleEditorMount}
          onChange={handleContentChange}
          options={{
            minimap: { enabled: true },
            scrollBeyondLastLine: false,
            fontSize: 13,
            lineNumbers: 'on',
            wordWrap: 'off',
            folding: true,
            tabSize: 2,
          }}
        />
      </div>

      {/* Dirty-state hint */}
      {dirty && (
        <div className="flex items-center justify-between border-t bg-muted/30 px-6 py-1.5">
          <span className="text-xs text-muted-foreground">{t('compose.editor.dirty_warning')}</span>
          <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => void handleSave()}>
            {t('compose.actions.save')}
          </Button>
        </div>
      )}

      {/* Action drawer (Dialog with xterm) */}
      {drawerAction && (
        <ActionDrawer
          stackName={key}
          action={drawerAction}
          open={!!drawerAction}
          onClose={handleDrawerClose}
        />
      )}
    </div>
  );
}
