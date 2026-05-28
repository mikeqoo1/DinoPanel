import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy } from 'lucide-react';
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
import { copyToClipboard } from '@/lib/clipboard';
import { toast } from 'sonner';
import { useRevealPassword } from '@/hooks/use-databases';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instanceId: number;
}

export function RevealPasswordDialog({ open, onOpenChange, instanceId }: Props) {
  const { t } = useTranslation();
  const reveal = useRevealPassword();

  const [currentPassword, setCurrentPassword] = useState('');
  const [revealedPassword, setRevealedPassword] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const startCountdown = (expiresAt: number) => {
    clearTimer();
    const tick = () => {
      const remaining = Math.ceil((expiresAt - Date.now()) / 1_000);
      if (remaining <= 0) {
        clearTimer();
        setRevealedPassword(null);
        setSecondsLeft(0);
        return;
      }
      setSecondsLeft(remaining);
    };
    tick();
    timerRef.current = setInterval(tick, 500);
  };

  const reset = () => {
    clearTimer();
    setCurrentPassword('');
    setRevealedPassword(null);
    setSecondsLeft(0);
    setError(null);
    reveal.reset();
  };

  // Clean up on close
  useEffect(() => {
    if (!open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Clean up timer on unmount
  useEffect(() => () => clearTimer(), []);

  const submit = async () => {
    setError(null);
    try {
      const res = await reveal.mutateAsync({
        id: instanceId,
        body: { currentPassword },
      });
      setRevealedPassword(res.password);
      startCountdown(res.expiresAt);
    } catch (err) {
      const msg = extractErrorMessage(err);
      const isReVerify =
        typeof err === 'object' &&
        err !== null &&
        'response' in err &&
        (err as { response?: { data?: { code?: string } } }).response?.data?.code === 'AUTH_RE_VERIFY_FAILED';
      setError(isReVerify ? t('databases.reveal_password.error_re_verify') : msg || t('databases.reveal_password.error_generic'));
    }
  };

  const handleCopy = async () => {
    if (!revealedPassword) return;
    const ok = await copyToClipboard(revealedPassword);
    if (ok) toast.success(t('databases.drawer.copied', { label: t('databases.reveal_password.field_label') }));
    else toast.error(t('databases.drawer.copy_failed'));
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('databases.reveal_password.modal_title')}</DialogTitle>
        </DialogHeader>

        {revealedPassword ? (
          <div className="space-y-3">
            <Label>{t('databases.reveal_password.field_label')}</Label>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-muted/40 px-3 py-2 font-mono text-sm">
                {revealedPassword}
              </code>
              <Button size="icon-sm" variant="ghost" onClick={handleCopy} aria-label="Copy password">
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('databases.reveal_password.countdown', { seconds: secondsLeft })}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="reveal-current-password">
                {t('databases.reveal_password.current_password_label')}
              </Label>
              <Input
                id="reveal-current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder={t('databases.reveal_password.current_password_placeholder')}
                onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
                autoFocus
              />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
          {!revealedPassword && (
            <Button onClick={() => void submit()} disabled={reveal.isPending || !currentPassword}>
              {t('databases.reveal_password.submit')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
