import { useState, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Folder,
  File as FileIcon,
  FilePlus,
  FolderPlus,
  Upload,
  Eye,
  EyeOff,
  Download,
  Trash2,
  Pencil,
  Loader2,
  Link as LinkIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PathBreadcrumb } from '@/components/files/breadcrumb';
import { FileEditor } from '@/components/files/file-editor';
import { useFileList, useFileMutations, downloadFileUrl } from '@/hooks/use-files';
import { api, extractErrorMessage } from '@/lib/api';
import { formatBytes, cn } from '@/lib/utils';
import type { FileEntry } from '@dinopanel/shared';

function modeToString(mode: number): string {
  const perms = ['r', 'w', 'x'];
  let out = '';
  for (let shift = 6; shift >= 0; shift -= 3) {
    const bits = (mode >> shift) & 0b111;
    for (let i = 0; i < 3; i++) {
      out += bits & (1 << (2 - i)) ? perms[i] : '-';
    }
  }
  return out;
}

export function FilesPage() {
  const { t } = useTranslation();
  const [currentPath, setCurrentPath] = useState<string>('/root');
  const [showHidden, setShowHidden] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [newDialog, setNewDialog] = useState<'file' | 'folder' | null>(null);
  const [newName, setNewName] = useState('');
  const [renameTarget, setRenameTarget] = useState<FileEntry | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<FileEntry | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const list = useFileList({ path: currentPath, showHidden });
  const muts = useFileMutations(currentPath, showHidden);

  const sortedEntries = useMemo(() => list.data?.entries ?? [], [list.data]);

  const handleOpen = (entry: FileEntry) => {
    if (entry.type === 'directory') {
      setCurrentPath(entry.path);
    } else if (entry.type === 'file') {
      setEditing(entry.path);
    }
  };

  const handleCreate = async () => {
    if (!newDialog || !newName.trim()) return;
    const targetPath = `${currentPath.replace(/\/$/, '')}/${newName.trim()}`;
    try {
      if (newDialog === 'folder') {
        await muts.mkdir.mutateAsync(targetPath);
      } else {
        await muts.writeFile.mutateAsync({ path: targetPath, content: '' });
      }
      setNewDialog(null);
      setNewName('');
      toast.success(t('settings.saved'));
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  const handleRename = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    const newPath = `${currentPath.replace(/\/$/, '')}/${renameValue.trim()}`;
    try {
      await muts.rename.mutateAsync({ from: renameTarget.path, to: newPath });
      setRenameTarget(null);
      setRenameValue('');
      toast.success(t('settings.saved'));
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await muts.remove.mutateAsync(deleteTarget.path);
      setDeleteTarget(null);
      toast.success(t('settings.saved'));
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      try {
        await muts.upload.mutateAsync({ targetDir: currentPath, file });
        toast.success(`Uploaded ${file.name}`);
      } catch (err) {
        toast.error(`${file.name}: ${extractErrorMessage(err)}`);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDownload = async (entry: FileEntry) => {
    try {
      const res = await api.get(downloadFileUrl(entry.path).replace('/api', ''), {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = entry.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{t('files.title')}</h1>
      </div>

      <Card className="flex flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
          <PathBreadcrumb path={currentPath} onNavigate={setCurrentPath} />
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => setNewDialog('file')}>
              <FilePlus className="h-4 w-4" />
              {t('files.new_file')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setNewDialog('folder')}>
              <FolderPlus className="h-4 w-4" />
              {t('files.new_folder')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4" />
              {t('files.upload')}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={(e) => handleUpload(e.target.files)}
            />
            <Button size="sm" variant="ghost" onClick={() => setShowHidden((v) => !v)}>
              {showHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              {t('files.show_hidden')}
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {list.isPending ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : list.error ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
              <p className="text-destructive">{extractErrorMessage(list.error)}</p>
              <Button size="sm" variant="outline" onClick={() => list.refetch()}>
                {t('common.retry')}
              </Button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="px-4 py-2 text-left font-medium">{t('files.name')}</th>
                  <th className="px-4 py-2 text-right font-medium">{t('files.size')}</th>
                  <th className="px-4 py-2 text-left font-medium">{t('files.permissions')}</th>
                  <th className="px-4 py-2 text-left font-medium">{t('files.modified')}</th>
                  <th className="w-32 px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {sortedEntries.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      (empty directory)
                    </td>
                  </tr>
                )}
                {sortedEntries.map((entry) => (
                  <tr
                    key={entry.path}
                    className={cn(
                      'group cursor-pointer border-b border-transparent transition-colors hover:bg-accent/50',
                      entry.isHidden && 'opacity-60',
                    )}
                    onDoubleClick={() => handleOpen(entry)}
                  >
                    <td className="px-4 py-1.5">
                      <button
                        className="flex items-center gap-2 text-left"
                        onClick={() => handleOpen(entry)}
                      >
                        {entry.type === 'directory' ? (
                          <Folder className="h-4 w-4 shrink-0 text-blue-500" />
                        ) : entry.type === 'symlink' ? (
                          <LinkIcon className="h-4 w-4 shrink-0 text-cyan-500" />
                        ) : (
                          <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="font-mono">{entry.name}</span>
                      </button>
                    </td>
                    <td className="px-4 py-1.5 text-right font-mono text-xs text-muted-foreground tabular-nums">
                      {entry.type === 'file' ? formatBytes(entry.size) : '—'}
                    </td>
                    <td className="px-4 py-1.5 font-mono text-xs text-muted-foreground">
                      {modeToString(entry.mode)}
                    </td>
                    <td className="px-4 py-1.5 text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(entry.mtime), { addSuffix: true })}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100">
                        {entry.type === 'file' && (
                          <>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditing(entry.path);
                              }}
                              aria-label={t('files.edit')}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDownload(entry);
                              }}
                              aria-label={t('files.download')}
                            >
                              <Download className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenameTarget(entry);
                            setRenameValue(entry.name);
                          }}
                          aria-label={t('files.rename')}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTarget(entry);
                          }}
                          aria-label={t('files.delete')}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <FileEditor
        open={!!editing}
        onClose={() => setEditing(null)}
        path={editing ?? ''}
        currentDir={currentPath}
        showHidden={showHidden}
      />

      {/* New file/folder dialog */}
      <Dialog open={!!newDialog} onOpenChange={(o) => !o && setNewDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {newDialog === 'folder' ? t('files.new_folder') : t('files.new_file')}
            </DialogTitle>
            <DialogDescription className="font-mono text-xs">{currentPath}</DialogDescription>
          </DialogHeader>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="name"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewDialog(null)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleCreate} disabled={!newName.trim() || muts.mkdir.isPending || muts.writeFile.isPending}>
              {(muts.mkdir.isPending || muts.writeFile.isPending) && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename dialog */}
      <Dialog open={!!renameTarget} onOpenChange={(o) => !o && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('files.rename')}</DialogTitle>
            <DialogDescription className="font-mono text-xs">{renameTarget?.path}</DialogDescription>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleRename()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleRename} disabled={!renameValue.trim() || muts.rename.isPending}>
              {muts.rename.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('files.delete')}</DialogTitle>
            <DialogDescription>
              {t('files.confirm_delete', { name: deleteTarget?.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={muts.remove.isPending}>
              {muts.remove.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
