import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { SiteCreate, SiteType } from '@dinopanel/shared';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { extractErrorMessage } from '@/lib/api';
import { useCreateWebsite } from '@/hooks/use-websites';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddSiteDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation();
  const create = useCreateWebsite();

  const [name, setName] = useState('');
  const [primaryDomain, setPrimaryDomain] = useState('');
  const [type, setType] = useState<SiteType>('static');
  const [upstream, setUpstream] = useState('http://127.0.0.1:3000');
  const [indexFiles, setIndexFiles] = useState('index.html index.htm');
  const [preserveHostHeader, setPreserveHostHeader] = useState(false);

  const reset = () => {
    setName('');
    setPrimaryDomain('');
    setType('static');
    setUpstream('http://127.0.0.1:3000');
    setIndexFiles('index.html index.htm');
    setPreserveHostHeader(false);
  };

  const submit = async () => {
    const body = buildCreateBody({
      name,
      primaryDomain,
      type,
      upstream,
      indexFiles,
      preserveHostHeader,
    });
    if (!body) {
      toast.error(t('websites.dialog.invalid_input'));
      return;
    }
    try {
      await create.mutateAsync(body);
      toast.success(t('websites.dialog.created'));
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('websites.dialog.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label>{t('websites.dialog.name')}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="blog"
              />
            </div>
            <div className="space-y-2">
              <Label>{t('websites.dialog.type')}</Label>
              <select
                className="block w-full rounded-md border bg-background p-2 text-sm"
                value={type}
                onChange={(e) => setType(e.target.value as SiteType)}
              >
                <option value="static">{t('websites.type.static')}</option>
                <option value="reverse_proxy">
                  {t('websites.type.reverse_proxy')}
                </option>
                <option value="php">{t('websites.type.php')}</option>
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t('websites.dialog.primary_domain')}</Label>
            <Input
              value={primaryDomain}
              onChange={(e) => setPrimaryDomain(e.target.value)}
              placeholder="blog.example.com"
            />
          </div>

          {type === 'static' || type === 'php' ? (
            <div className="space-y-2">
              <Label>{t('websites.dialog.index_files')}</Label>
              <Input
                value={indexFiles}
                onChange={(e) => setIndexFiles(e.target.value)}
                placeholder="index.html index.htm"
              />
              <p className="text-xs text-muted-foreground">
                {t('websites.dialog.index_files_hint')}
              </p>
            </div>
          ) : null}

          {type === 'reverse_proxy' ? (
            <>
              <div className="space-y-2">
                <Label>{t('websites.dialog.upstream')}</Label>
                <Input
                  value={upstream}
                  onChange={(e) => setUpstream(e.target.value)}
                  placeholder="http://127.0.0.1:3000"
                />
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={preserveHostHeader}
                  onChange={(e) => setPreserveHostHeader(e.target.checked)}
                  className="mt-1"
                />
                <span>{t('websites.dialog.preserve_host')}</span>
              </label>
            </>
          ) : null}

          {type === 'php' ? (
            <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-xs">
              {t('websites.dialog.php_hint')}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} disabled={create.isPending}>
            {t('websites.dialog.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function buildCreateBody(args: {
  name: string;
  primaryDomain: string;
  type: SiteType;
  upstream: string;
  indexFiles: string;
  preserveHostHeader: boolean;
}): SiteCreate | null {
  const name = args.name.trim();
  const primaryDomain = args.primaryDomain.trim();
  if (!name || !primaryDomain) return null;
  const indexFiles = args.indexFiles
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  switch (args.type) {
    case 'static':
      return {
        name,
        primaryDomain,
        payload: {
          type: 'static',
          indexFiles: indexFiles.length > 0 ? indexFiles : ['index.html'],
        },
      };
    case 'reverse_proxy': {
      const upstream = args.upstream.trim();
      if (!upstream) return null;
      return {
        name,
        primaryDomain,
        payload: {
          type: 'reverse_proxy',
          upstream,
          preserveHostHeader: args.preserveHostHeader,
        },
      };
    }
    case 'php':
      return {
        name,
        primaryDomain,
        payload: {
          type: 'php',
          phpVersion: '8.3',
          documentIndex: indexFiles.length > 0 ? indexFiles : ['index.php', 'index.html'],
        },
      };
  }
}
