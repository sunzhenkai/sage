import { Link, useLocation } from 'react-router';
import { PageContent, PageDescription, PageHeader, PageShell } from '@/components/layout/page';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';

export function NotFoundPage() {
  const t = useT();
  const { pathname } = useLocation();
  return (
    <PageShell>
      <PageHeader title={t('notFound.header')} />
      <PageContent>
        <PageDescription title={t('notFound.title')} description={<>{t('notFound.descriptionLead')} <span className="t-mono">{pathname}</span>{t('notFound.descriptionTail')}</>} />
        <div><Button asChild size="sm" variant="outline"><Link to="/overview">{t('notFound.back')}</Link></Button></div>
      </PageContent>
    </PageShell>
  );
}
