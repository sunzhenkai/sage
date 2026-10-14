import { Link, useLocation } from 'react-router';
import { PageContent, PageDescription, PageHeader, PageShell } from '@/components/layout/page';
import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  const { pathname } = useLocation();
  return (
    <PageShell>
      <PageHeader title="Not found" />
      <PageContent>
        <PageDescription title="Page not found" description={<>Nothing lives at <span className="t-mono">{pathname}</span>.</>} />
        <Button asChild size="sm" variant="outline"><Link to="/overview">Back to overview</Link></Button>
      </PageContent>
    </PageShell>
  );
}
