import { useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import { useTranslation } from 'react-i18next';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useReadFile, useFileMutations } from '@/hooks/use-files';
import { useTheme } from '@/components/theme-provider';
import { extractErrorMessage } from '@/lib/api';

interface FileEditorProps {
  open: boolean;
  onClose: () => void;
  path: string;
  currentDir: string;
  showHidden: boolean;
}

const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  md: 'markdown',
  yaml: 'yaml',
  yml: 'yaml',
  sh: 'shell',
  bash: 'shell',
  py: 'python',
  go: 'go',
  rs: 'rust',
  conf: 'ini',
  ini: 'ini',
  toml: 'ini',
  nginx: 'nginx',
  html: 'html',
  css: 'css',
  scss: 'scss',
  sql: 'sql',
  xml: 'xml',
};

function detectLanguage(path: string): string {
  const filename = path.split('/').pop() ?? '';
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (ext in LANGUAGE_BY_EXT) return LANGUAGE_BY_EXT[ext]!;
  if (filename === 'Dockerfile') return 'dockerfile';
  if (filename === 'Makefile') return 'makefile';
  if (filename.startsWith('.env')) return 'shell';
  return 'plaintext';
}

export function FileEditor({ open, onClose, path, currentDir, showHidden }: FileEditorProps) {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const read = useReadFile(open ? path : null);
  const { writeFile } = useFileMutations(currentDir, showHidden);
  const [draft, setDraft] = useState<string>('');
  const [dirty, setDirty] = useState(false);
  const filename = path.split('/').pop() ?? path;

  useEffect(() => {
    if (read.data) {
      setDraft(read.data.content);
      setDirty(false);
    }
  }, [read.data]);

  const handleSave = async () => {
    try {
      await writeFile.mutateAsync({ path, content: draft });
      setDirty(false);
      toast.success(t('settings.saved'));
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[80vh] max-w-5xl flex-col p-0">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle className="font-mono text-sm">{filename}</DialogTitle>
          <DialogDescription className="font-mono text-xs">{path}</DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-hidden">
          {read.isPending ? (
            <Skeleton className="h-full w-full" />
          ) : read.error ? (
            <div className="flex h-full items-center justify-center text-sm text-destructive">
              {extractErrorMessage(read.error)}
            </div>
          ) : (
            <Editor
              height="100%"
              theme={resolvedTheme === 'dark' ? 'vs-dark' : 'vs'}
              language={detectLanguage(path)}
              value={draft}
              onChange={(v) => {
                setDraft(v ?? '');
                setDirty(true);
              }}
              options={{
                fontSize: 13,
                fontFamily: '"JetBrains Mono", Monaco, Menlo, Consolas, monospace',
                minimap: { enabled: false },
                wordWrap: 'on',
                scrollBeyondLastLine: false,
                automaticLayout: true,
              }}
            />
          )}
        </div>
        <DialogFooter className="border-t px-6 py-3">
          <Button variant="outline" size="sm" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!dirty || writeFile.isPending}>
            {writeFile.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {t('files.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
