import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNow } from 'date-fns';
import {
  Download,
  Tag,
  Trash2,
  Loader2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { extractErrorMessage } from '@/lib/api';
import { useImages, useImageAction, useImagePullWs } from '@/hooks/use-images';
import { useQueryClient } from '@tanstack/react-query';
import { imageKeys } from '@/hooks/use-images';
import type { Image } from '@dinopanel/shared';
import type { LayerProgress } from '@/hooks/use-images';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

// ---------------------------------------------------------------------------
// Pull progress bar (single layer row)
// ---------------------------------------------------------------------------

function LayerRow({ layer }: { layer: LayerProgress }) {
  const pct =
    layer.total > 0 ? Math.min(100, Math.round((layer.current / layer.total) * 100)) : 0;
  const isDone =
    layer.status.toLowerCase().includes('complete') ||
    layer.status.toLowerCase().includes('already exists') ||
    layer.status.toLowerCase().includes('pull complete');

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-[88px] shrink-0 font-mono text-muted-foreground">
        {layer.layerId.slice(0, 12)}
      </span>
      <span className="w-32 shrink-0 truncate text-muted-foreground">{layer.status}</span>
      {isDone ? (
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500" />
      ) : layer.total > 0 ? (
        <div className="flex flex-1 items-center gap-1.5">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-200"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="w-8 text-right tabular-nums text-muted-foreground">{pct}%</span>
        </div>
      ) : (
        <div className="flex-1" />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pull Dialog
// ---------------------------------------------------------------------------

interface PullDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function PullDialog({ open, onOpenChange }: PullDialogProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [ref, setRef] = useState('');
  const [activePullRef, setActivePullRef] = useState('');

  const handleComplete = useCallback(() => {
    toast.success(t('images.pull_dialog.success'));
    void qc.invalidateQueries({ queryKey: imageKeys.list() });
    onOpenChange(false);
    setActivePullRef('');
    setRef('');
  }, [t, qc, onOpenChange]);

  const handleError = useCallback(
    (msg: string) => {
      toast.error(msg);
    },
    [],
  );

  const { layers, status, error, connect, disconnect } = useImagePullWs(
    activePullRef,
    handleComplete,
    handleError,
  );

  // Trigger connect whenever activePullRef is set to a non-empty value
  const connectRef = useRef(connect);
  connectRef.current = connect;
  useEffect(() => {
    if (!activePullRef) return;
    connectRef.current();
  }, [activePullRef]);

  const handleStart = () => {
    const trimmed = ref.trim();
    if (!trimmed) return;
    // If already pulling the same ref, call connect() directly to retry
    if (trimmed === activePullRef) {
      connect();
    } else {
      setActivePullRef(trimmed);
    }
  };

  const handleClose = () => {
    disconnect();
    setActivePullRef('');
    setRef('');
    onOpenChange(false);
  };

  const isPulling = status === 'connecting' || status === 'connected';
  const isDone = status === 'done';
  const isError = status === 'error' || status === 'closed';

  const layerList = Array.from(layers.values());
  const completedLayers = layerList.filter(
    (l) =>
      l.status.toLowerCase().includes('complete') ||
      l.status.toLowerCase().includes('already exists'),
  );
  const activeLayers = layerList.filter(
    (l) =>
      !l.status.toLowerCase().includes('complete') &&
      !l.status.toLowerCase().includes('already exists'),
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('images.pull_dialog.title')}</DialogTitle>
          <DialogDescription>{t('images.pull_dialog.desc')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="image-ref">{t('images.pull_dialog.ref_label')}</Label>
            <Input
              id="image-ref"
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              placeholder="nginx:latest"
              disabled={isPulling || isDone}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isPulling && !isDone) handleStart();
              }}
            />
          </div>

          {/* Progress area */}
          {layerList.length > 0 && (
            <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5 max-h-64 overflow-y-auto">
              {activeLayers.map((l) => (
                <LayerRow key={l.layerId} layer={l} />
              ))}
              {completedLayers.length > 0 && activeLayers.length > 0 && (
                <div className="border-t my-1" />
              )}
              {completedLayers.map((l) => (
                <LayerRow key={l.layerId} layer={l} />
              ))}
            </div>
          )}

          {/* Status indicators */}
          {isPulling && layerList.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('images.pull_dialog.connecting')}
            </div>
          )}

          {isError && !isDone && error && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-2.5 text-sm text-destructive">
              <XCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {t('common.cancel')}
          </Button>
          {!isPulling && !isDone && (
            <Button
              onClick={handleStart}
              disabled={!ref.trim()}
            >
              {isError && activePullRef ? (
                <>
                  <RotateCcw className="h-4 w-4" />
                  {t('images.pull_dialog.retry')}
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  {t('images.pull_dialog.start')}
                </>
              )}
            </Button>
          )}
          {isPulling && (
            <Button disabled>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('images.pull_dialog.pulling')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Tag Dialog
// ---------------------------------------------------------------------------

interface TagDialogProps {
  image: Image;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function TagDialog({ image, open, onOpenChange }: TagDialogProps) {
  const { t } = useTranslation();
  const { tag, isPending } = useImageAction(image.id);
  const [repo, setRepo] = useState('');
  const [tagName, setTagName] = useState('latest');

  const handleSubmit = async () => {
    try {
      await tag(repo.trim(), tagName.trim() || 'latest');
      toast.success(t('images.tag_success'));
      onOpenChange(false);
      setRepo('');
      setTagName('latest');
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('images.tag_dialog.title')}</DialogTitle>
          <DialogDescription>
            {t('images.tag_dialog.desc', {
              image: (image.repoTags[0] ?? image.id.slice(7, 19)),
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="tag-repo">{t('images.tag_dialog.repo_label')}</Label>
            <Input
              id="tag-repo"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="myrepo/myimage"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tag-name">{t('images.tag_dialog.tag_label')}</Label>
            <Input
              id="tag-name"
              value={tagName}
              onChange={(e) => setTagName(e.target.value)}
              placeholder="latest"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={!repo.trim() || isPending}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('images.tag_dialog.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Row actions
// ---------------------------------------------------------------------------

interface ImageRowActionsProps {
  image: Image;
  onRemoved: () => void;
}

function ImageRowActions({ image, onRemoved }: ImageRowActionsProps) {
  const { t } = useTranslation();
  const { remove, isPending } = useImageAction(image.id);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [showTag, setShowTag] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const handleRemove = async (force = false) => {
    setRemoveError(null);
    try {
      await remove(force);
      toast.success(t('images.remove_success'));
      setConfirmRemove(false);
      onRemoved();
    } catch (err) {
      const msg = extractErrorMessage(err);
      // 409 = image in use
      if (msg.toLowerCase().includes('409') || msg.toLowerCase().includes('use')) {
        setRemoveError(msg);
      } else {
        toast.error(msg);
        setConfirmRemove(false);
      }
    }
  };

  return (
    <>
      <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100">
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={isPending}
          onClick={(e) => { e.stopPropagation(); setShowTag(true); }}
          aria-label={t('images.action_tag')}
        >
          <Tag className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={isPending}
          onClick={(e) => {
            e.stopPropagation();
            setRemoveError(null);
            setConfirmRemove(true);
          }}
          aria-label={t('images.action_remove')}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Tag dialog */}
      <TagDialog image={image} open={showTag} onOpenChange={setShowTag} />

      {/* Remove confirm dialog */}
      <Dialog open={confirmRemove} onOpenChange={(o) => { if (!o) { setConfirmRemove(false); setRemoveError(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('images.remove_confirm_title')}</DialogTitle>
            <DialogDescription>
              {t('images.remove_confirm_desc', {
                image: image.repoTags[0] ?? image.id.slice(7, 19),
              })}
            </DialogDescription>
          </DialogHeader>

          {removeError && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              <p className="font-medium">{t('images.remove_in_use')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{removeError}</p>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setConfirmRemove(false); setRemoveError(null); }}
            >
              {t('common.cancel')}
            </Button>
            {removeError && (
              <Button
                variant="destructive"
                disabled={isPending}
                onClick={() => void handleRemove(true)}
              >
                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {t('images.remove_force')}
              </Button>
            )}
            {!removeError && (
              <Button
                variant="destructive"
                disabled={isPending}
                onClick={() => void handleRemove(false)}
              >
                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {t('common.delete')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function ImagesPage() {
  const { t } = useTranslation();
  const [showPull, setShowPull] = useState(false);
  const { data, isPending, error, refetch } = useImages();

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{t('images.title')}</h1>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void refetch()}>
            <RefreshCw className="h-3.5 w-3.5" />
            {t('images.refresh')}
          </Button>
          <Button size="sm" onClick={() => setShowPull(true)}>
            <Download className="h-3.5 w-3.5" />
            {t('images.pull')}
          </Button>
        </div>
      </div>

      {/* Table card */}
      <div className="flex-1 overflow-auto rounded-lg border bg-card">
        {isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
            <p className="text-destructive">{extractErrorMessage(error)}</p>
            <Button size="sm" variant="outline" onClick={() => void refetch()}>
              {t('common.retry')}
            </Button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="px-4 py-2 text-left font-medium">{t('images.col_tags')}</th>
                <th className="w-28 px-4 py-2 text-left font-medium">{t('images.col_size')}</th>
                <th className="w-36 px-4 py-2 text-left font-medium">{t('images.col_created')}</th>
                <th className="w-24 px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {!data || data.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center text-muted-foreground">
                    {t('images.empty')}
                  </td>
                </tr>
              ) : (
                data.map((img) => (
                  <tr
                    key={img.id}
                    className={cn(
                      'group border-b border-transparent transition-colors hover:bg-accent/50',
                    )}
                  >
                    <td className="px-4 py-2">
                      {img.repoTags.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {img.repoTags.map((t_) => (
                            <span
                              key={t_}
                              className="rounded-md border bg-muted px-1.5 py-0.5 font-mono text-xs"
                            >
                              {t_}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="font-mono text-xs text-muted-foreground">
                          {img.id.slice(7, 19)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                      {formatBytes(img.size)}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(img.createdAt * 1000), { addSuffix: true })}
                    </td>
                    <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                      <ImageRowActions image={img} onRemoved={() => void refetch()} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      <PullDialog open={showPull} onOpenChange={setShowPull} />
    </div>
  );
}
