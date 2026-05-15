import { useTranslation } from 'react-i18next';
import { Workflow } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function ComposePage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('nav.compose')}</h1>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Workflow className="h-5 w-5" />
            {t('nav.compose')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t('containers.coming_soon')}</p>
        </CardContent>
      </Card>
    </div>
  );
}
