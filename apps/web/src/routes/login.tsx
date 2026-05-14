import { useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { Loader2, Server } from 'lucide-react';
import { toast } from 'sonner';
import { loginSchema, type LoginInput } from '@dinopanel/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuthStore } from '@/stores/auth';
import { extractErrorMessage } from '@/lib/api';
import axios from 'axios';

export function LoginPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const login = useAuthStore((s) => s.login);
  const [submitting, setSubmitting] = useState(false);

  const from =
    (location.state as { from?: string } | null)?.from && (location.state as { from: string }).from !== '/login'
      ? (location.state as { from: string }).from
      : '/';

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  if (user) return <Navigate to={from} replace />;

  const onSubmit = async (data: LoginInput) => {
    setSubmitting(true);
    try {
      await login(data.username, data.password);
      navigate(from, { replace: true });
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 429) {
        toast.error(t('auth.rate_limited'));
      } else if (axios.isAxiosError(err) && err.response?.status === 401) {
        toast.error(t('auth.invalid_credentials'));
      } else {
        toast.error(extractErrorMessage(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid min-h-screen w-full md:grid-cols-2">
      <div className="hidden flex-col justify-between bg-sidebar p-10 md:flex">
        <div className="flex items-center gap-3 text-lg font-semibold">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Server className="h-5 w-5" />
          </div>
          DinoPanel
        </div>
        <blockquote className="space-y-2">
          <p className="text-lg leading-relaxed text-muted-foreground">
            “{t('app.tagline')}”
          </p>
          <footer className="text-sm text-muted-foreground">— DinoPanel</footer>
        </blockquote>
      </div>

      <div className="flex items-center justify-center p-6">
        <Card className="w-full max-w-sm">
          <CardHeader className="space-y-2 text-center">
            <CardTitle className="text-2xl">{t('auth.login_title')}</CardTitle>
            <CardDescription>{t('auth.login_subtitle')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">{t('auth.username')}</Label>
                <Input
                  id="username"
                  autoComplete="username"
                  autoFocus
                  disabled={submitting}
                  {...register('username')}
                />
                {errors.username && (
                  <p className="text-xs text-destructive">{errors.username.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">{t('auth.password')}</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  disabled={submitting}
                  {...register('password')}
                />
                {errors.password && (
                  <p className="text-xs text-destructive">{errors.password.message}</p>
                )}
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {submitting ? t('auth.signing_in') : t('auth.sign_in')}
              </Button>
            </form>
            <div className="mt-6 flex justify-center gap-2 text-xs text-muted-foreground">
              <button onClick={() => i18n.changeLanguage('zh-TW')} className="hover:underline">
                繁體中文
              </button>
              <span>·</span>
              <button onClick={() => i18n.changeLanguage('en')} className="hover:underline">
                English
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
