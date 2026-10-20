import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Crumb, PageHeader } from '@/components/layout/app-shell';
import { Artifacts } from '@/components/bui/artifacts';
import { StatusGlyph } from '@/components/bui/atoms';
import { RunLogs } from '@/components/bui/run-logs';
import { PageContent, PageDescription, Quiet, Section, SegmentedTabs } from '@/components/layout/page';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DetailLayout, ListRow, Property, PropertyGroup, RowId, RowTitle } from '@/components/ui/list';
import { ErrorState, Loading, Mono } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { formatTime, relativeTime } from '@/lib/utils';

type Tab = 'overview' | 'logs' | 'artifacts';
const terminal = new Set(['succeeded', 'failed', 'cancelled']);

export function AppRunDetailPage() {
  const { appId = '', taskId = '' } = useParams();
  const t = useT();
  const [tab, setTab] = useState<Tab>('overview');
  const runQuery = useQuery({
    queryKey: ['app-run', appId, taskId],
    queryFn: () => api.apps.run(appId, taskId),
    refetchInterval: (query) => {
      const status = query.state.data?.run.status;
      return status !== undefined && !terminal.has(status) ? 5_000 : false;
    }
  });
  const run = runQuery.data?.run;
  const live = run !== undefined && !terminal.has(run.status);
  const pending = run?.status === 'pending';

  return (
    <>
      <PageHeader
        breadcrumb={<><Crumb to="/apps">{t('nav.apps')}</Crumb><Crumb to={`/apps/${encodeURIComponent(appId)}`}>{appId}</Crumb></>}
        title={<Mono>{taskId}</Mono>}
        actions={run === undefined || pending ? null : (
          <Button variant="secondary" size="sm" asChild>
            <Link to={`/tasks/${encodeURIComponent(taskId)}`}>{t('apps.runDetail.openTask')}<ArrowUpRight /></Link>
          </Button>
        )} />
      {runQuery.isLoading ? <Loading /> : runQuery.error ? <ErrorState error={runQuery.error} /> : run === undefined ? null : (
        <DetailLayout properties={<>
          <PropertyGroup title={t('apps.runDetail.properties')}>
            <Property label={t('apps.runDetail.status')}><StatusBadge status={run.status} /></Property>
            <Property label={t('apps.runDetail.version')}><Mono>{run.releaseVersion === undefined ? '—' : `v${run.releaseVersion}`}</Mono></Property>
            <Property label={t('apps.runDetail.source')}>{run.source === 'schedule' ? t('apps.detail.sourceSchedule') : t('apps.detail.sourceManual')}</Property>
            <Property label={t('apps.runDetail.task')}><Mono className="break-all">{run.taskId}</Mono></Property>
            <Property label={t('apps.runDetail.created')}>{formatTime(run.createdAt)}</Property>
            <Property label={t('apps.runDetail.updated')}>{formatTime(run.updatedAt)}</Property>
          </PropertyGroup>
          <PropertyGroup title={t('apps.runDetail.release')}>
            <Property label={t('apps.runDetail.releaseId')}><Mono className="break-all">{run.releaseId}</Mono></Property>
            <Property label={t('apps.runDetail.freshness')}>{run.freshness ?? '—'}</Property>
            <Property label={t('apps.runDetail.failureCode')}>{run.failureCode === undefined ? '—' : <span className="text-red">{run.failureCode}</span>}</Property>
          </PropertyGroup>
        </>}>
          <PageContent>
            <PageDescription
              leading={<StatusGlyph status={run.status} />}
              title={run.releaseVersion === undefined ? taskId : `v${run.releaseVersion} · ${taskId}`}
              description={<>{t('apps.runDetail.description')}{run.updatedAt === undefined ? '' : ` · ${t('apps.runDetail.updatedAgo', { time: relativeTime(run.updatedAt) })}`}</>} />
            <SegmentedTabs value={tab} onChange={setTab} items={[
              { value: 'overview', label: t('apps.runDetail.tabs.overview') },
              { value: 'logs', label: t('apps.runDetail.tabs.logs') },
              { value: 'artifacts', label: t('apps.runDetail.tabs.artifacts') }
            ]} />
            <div className="pt-5">
              {pending ? (
                <Section card padded><Quiet>{t('apps.runDetail.pendingHint')}</Quiet></Section>
              ) : tab === 'overview' ? (
                <Section card title={t('apps.runDetail.overview')}>
                  <>
                    <ListRow><RowId>{t('apps.runDetail.status')}</RowId><RowTitle>{t('apps.runDetail.statusHint')}</RowTitle><StatusBadge status={run.status} /></ListRow>
                    <ListRow><RowId>{t('apps.runDetail.created')}</RowId><RowTitle><Mono>{run.createdAt}</Mono></RowTitle></ListRow>
                    <ListRow><RowId>{t('apps.runDetail.updated')}</RowId><RowTitle><Mono>{run.updatedAt ?? '—'}</Mono></RowTitle></ListRow>
                    {run.failureCode === undefined ? null : <ListRow><RowId>{t('apps.runDetail.failureCode')}</RowId><RowTitle><span className="text-red">{run.failureCode}</span></RowTitle></ListRow>}
                  </>
                </Section>
              ) : tab === 'logs' ? (
                <Section card padded><RunLogs taskId={taskId} live={live} /></Section>
              ) : (
                <Section card padded><Artifacts taskId={taskId} live={live} /></Section>
              )}
            </div>
          </PageContent>
        </DetailLayout>
      )}
    </>
  );
}
