import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { CreateDbInstance, DbEngine } from '@dinopanel/shared';
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
import { useCreateDatabase } from '@/hooks/use-databases';
import { ENGINE_META, ENGINE_ORDER } from './engine-meta';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateDatabaseDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation();
  const create = useCreateDatabase();

  const [name, setName] = useState('');
  const [engine, setEngine] = useState<DbEngine>('mysql');
  const [imageTag, setImageTag] = useState(ENGINE_META.mysql.defaultImage);
  const [port, setPort] = useState<number>(ENGINE_META.mysql.defaultPort);
  const [customUsername, setCustomUsername] = useState('');
  const [customPassword, setCustomPassword] = useState('');
  const [showCustomCreds, setShowCustomCreds] = useState(false);

  // Re-default imageTag + port when engine flips. Operator can still
  // override after by typing into the field.
  useEffect(() => {
    setImageTag(ENGINE_META[engine].defaultImage);
    setPort(ENGINE_META[engine].defaultPort);
  }, [engine]);

  const reset = () => {
    setName('');
    setEngine('mysql');
    setImageTag(ENGINE_META.mysql.defaultImage);
    setPort(ENGINE_META.mysql.defaultPort);
    setCustomUsername('');
    setCustomPassword('');
    setShowCustomCreds(false);
  };

  const submit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error(t('databases.dialog.invalid_input'));
      return;
    }
    const body: CreateDbInstance = {
      name: trimmedName,
      engine,
      port,
      ...(imageTag.trim() && imageTag.trim() !== ENGINE_META[engine].defaultImage
        ? { imageTag: imageTag.trim() }
        : {}),
      ...(showCustomCreds && customUsername.trim() && customPassword.length >= 8
        ? {
            customCredentials: {
              username: customUsername.trim(),
              password: customPassword,
            },
          }
        : {}),
    };
    try {
      await create.mutateAsync(body);
      toast.success(t('databases.dialog.created'));
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
          <DialogTitle>{t('databases.dialog.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label>{t('databases.dialog.name')}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="shop"
              />
              <p className="text-xs text-muted-foreground">
                {t('databases.dialog.name_hint')}
              </p>
            </div>
            <div className="space-y-2">
              <Label>{t('databases.dialog.engine')}</Label>
              <select
                className="block w-full rounded-md border bg-background p-2 text-sm"
                value={engine}
                onChange={(e) => setEngine(e.target.value as DbEngine)}
              >
                {ENGINE_ORDER.map((eng) => (
                  <option key={eng} value={eng}>
                    {t(ENGINE_META[eng].labelKey)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label>{t('databases.dialog.image_tag')}</Label>
              <Input
                value={imageTag}
                onChange={(e) => setImageTag(e.target.value)}
                placeholder={ENGINE_META[engine].defaultImage}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('databases.dialog.port')}</Label>
              <Input
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                min={1024}
                max={65535}
              />
            </div>
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={showCustomCreds}
              onChange={(e) => setShowCustomCreds(e.target.checked)}
              className="mt-1"
            />
            <span>{t('databases.dialog.custom_credentials')}</span>
          </label>
          {showCustomCreds && (
            <div className="grid grid-cols-2 gap-2 rounded-md border border-muted p-3">
              <div className="space-y-2">
                <Label>{t('databases.dialog.username')}</Label>
                <Input
                  value={customUsername}
                  onChange={(e) => setCustomUsername(e.target.value)}
                  placeholder="admin"
                />
              </div>
              <div className="space-y-2">
                <Label>{t('databases.dialog.password')}</Label>
                <Input
                  value={customPassword}
                  onChange={(e) => setCustomPassword(e.target.value)}
                  placeholder="≥ 8 chars"
                  type="password"
                />
              </div>
              <p className="col-span-2 text-xs text-muted-foreground">
                {t('databases.dialog.custom_credentials_hint')}
              </p>
            </div>
          )}

          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
            {t('databases.dialog.plaintext_warning')}
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} disabled={create.isPending}>
            {t('databases.dialog.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
