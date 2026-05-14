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
  Copy,
  ShieldCheck,
  UserCog,
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
  const [copyTarget, setCopyTarget] = useState<FileEntry | null>(null);
  const [copyDest, setCopyDest] = useState('');
  const [chmodTarget, setChmodTarget] = useState<FileEntry | null>(null);
  const [chmodMode, setChmodMode] = useState('');
  const [chmodError, setChmodError] = useState('');
  const [chownTarget, setChownTarget] = useState<FileEntry | null>(null);
  const [chownUid, setChownUid] = useState('');
  const [chownGid, setChownGid] = useState('');
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

  const handleCopy = async () => {
    if (!copyTarget || !copyDest.trim()) return;
    try {
      await muts.copyFile.mutateAsync({ from: copyTarget.path, to: copyDest.trim() });
      setCopyTarget(null);
      setCopyDest('');
      toast.success(t('files.copy_success'));
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  const handleChmod = async () => {
    if (!chmodTarget) return;
    const modeStr = chmodMode.trim();
    if (!/^[0-7]{3,4}$/.test(modeStr)) {
      setChmodError(t('files.chmod_mode_invalid'));
      return;
    }
    setChmodError('');
    try {
      await muts.chmod.mutateAsync({ path: chmodTarget.path, mode: parseInt(modeStr, 8) });
      setChmodTarget(null);
      setChmodMode('');
      toast.success(t('files.chmod_success'));
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  const handleChown = async () => {
    if (!chownTarget) return;
    const uid = parseInt(chownUid.trim(), 10);
    const gid = parseInt(chownGid.trim(), 10);
    if (isNaN(uid) || isNaN(gid)) {
      toast.error(t('common.error'));
      return;
    }
    try {
      await muts.chown.mutateAsync({ path: chownTarget.path, uid, gid });
      setChownTarget(null);
      setChownUid('');
      setChownGid('');
      toast.success(t('files.chown_success'));
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
                            setCopyTarget(entry);
                            setCopyDest(`${currentPath.replace(/\/$/, '')}/${entry.name}`);
                          }}
                          aria-label={t('files.copy')}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            setChmodTarget(entry);
                            setChmodMode(
                              (entry.mode & 0o777).toString(8).padStart(3, '0'),
                            );
                            setChmodError('');
                          }}
                          aria-label={t('files.chmod')}
                        >
                          <ShieldCheck className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            setChownTarget(entry);
                            setChownUid(String(entry.uid));
                            setChownGid(String(entry.gid));
                          }}
                          aria-label={t('files.chown')}
                        >
                          <UserCog className="h-3.5 w-3.5" />
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

      {/* Copy dialog */}
      <Dialog
        open={!!copyTarget}
        onOpenChange={(o) => {
          if (!o) { setCopyTarget(null); setCopyDest(''); }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('files.copy_dialog_title')}</DialogTitle>
            <DialogDescription className="font-mono text-xs">{copyTarget?.path}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <label className="text-sm font-medium">{t('files.copy_destination_label')}</label>
            <Input
              value={copyDest}
              onChange={(e) => setCopyDest(e.target.value)}
              placeholder={t('files.copy_destination_placeholder')}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleCopy()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCopyTarget(null); setCopyDest(''); }}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleCopy} disabled={!copyDest.trim() || muts.copyFile.isPending}>
              {muts.copyFile.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Chmod dialog */}
      <Dialog
        open={!!chmodTarget}
        onOpenChange={(o) => {
          if (!o) { setChmodTarget(null); setChmodMode(''); setChmodError(''); }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('files.chmod_dialog_title')}</DialogTitle>
            <DialogDescription className="font-mono text-xs">{chmodTarget?.path}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <label className="text-sm font-medium">{t('files.chmod_mode_label')}</label>
            <Input
              value={chmodMode}
              onChange={(e) => { setChmodMode(e.target.value); setChmodError(''); }}
              placeholder={t('files.chmod_mode_placeholder')}
              maxLength={4}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleChmod()}
            />
            {chmodError && (
              <p className="text-xs text-destructive">{chmodError}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setChmodTarget(null); setChmodMode(''); setChmodError(''); }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleChmod}
              disabled={!chmodMode.trim() || muts.chmod.isPending}
            >
              {muts.chmod.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Chown dialog */}
      <Dialog
        open={!!chownTarget}
        onOpenChange={(o) => {
          if (!o) { setChownTarget(null); setChownUid(''); setChownGid(''); }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('files.chown_dialog_title')}</DialogTitle>
            <DialogDescription className="font-mono text-xs">{chownTarget?.path}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">{t('files.chown_uid_label')}</label>
              <Input
                type="number"
                min={0}
                value={chownUid}
                onChange={(e) => setChownUid(e.target.value)}
                placeholder={t('files.chown_uid_placeholder')}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleChown()}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">{t('files.chown_gid_label')}</label>
              <Input
                type="number"
                min={0}
                value={chownGid}
                onChange={(e) => setChownGid(e.target.value)}
                placeholder={t('files.chown_gid_placeholder')}
                onKeyDown={(e) => e.key === 'Enter' && handleChown()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setChownTarget(null); setChownUid(''); setChownGid(''); }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleChown}
              disabled={
                chownUid.trim() === '' ||
                chownGid.trim() === '' ||
                isNaN(parseInt(chownUid, 10)) ||
                isNaN(parseInt(chownGid, 10)) ||
                muts.chown.isPending
              }
            >
              {muts.chown.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
