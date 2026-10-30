import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, CircleAlert, FileText } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Crumb, PageHeader, ViewTab } from '@/components/layout/app-shell';
import { Artifacts, EmptyPane } from '@/components/bui/artifacts';
import { StatusGlyph } from '@/components/bui/atoms';
import { RunLogs } from '@/components/bui/run-logs';
import { PageContent, PageDescription, Quiet, Section } from '@/components/layout/page';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ListRow, RowId, RowTitle } from '@/components/ui/list';
import { ErrorState, Loading, Mono } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { formatTime, relativeTime } from '@/lib/utils';

type Tab = 'overview' | 'artifacts';
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
        tabs={run === undefined ? undefined : <>
          <ViewTab active={tab === 'overview'} onClick={() => setTab('overview')}>{t('apps.runDetail.tabs.overview')}</ViewTab>
          <ViewTab active={tab === 'artifacts'} onClick={() => setTab('artifacts')}>{t('apps.runDetail.tabs.artifacts')}</ViewTab>
        </>}
        actions={run === undefined || pending ? null : (
          <Button variant="secondary" size="sm" asChild>
            <Link to={`/tasks/${encodeURIComponent(taskId)}`}>{t('apps.runDetail.openTask')}<ArrowUpRight /></Link>
          </Button>
        )} />
      {runQuery.isLoading ? <Loading /> : runQuery.error ? <ErrorState error={runQuery.error} /> : run === undefined ? null : (
        <PageContent fill={tab === 'artifacts' && !pending}>
          {tab === 'overview' || pending ? <PageDescription
            leading={<StatusGlyph status={run.status} />}
            title={run.releaseVersion === undefined ? taskId : `v${run.releaseVersion}`}
            description={run.updatedAt === undefined ? undefined : t('apps.runDetail.updatedAgo', { time: relativeTime(run.updatedAt) })} /> : null}
          {pending ? (
            <Section card padded><Quiet>{t('apps.runDetail.pendingHint')}</Quiet></Section>
          ) : tab === 'overview' ? (
            <>
              {run.status === 'failed' && (run.failureCode !== undefined || run.failureDetail !== undefined) ? (
                <div role="alert" className="flex gap-3 rounded-card bg-red-tint px-3 py-2.5">
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-red" />
                  <div className="min-w-0 space-y-1">
                    <p className="text-[13px] font-medium text-red">{run.failureCode ?? t('apps.runDetail.failedTitle')}</p>
                    {run.failureDetail === undefined ? null : <p className="break-words text-[12.5px] text-ink-2">{run.failureDetail}</p>}
                  </div>
                </div>
              ) : null}
              <Section card title={t('apps.runDetail.properties')}>
                <ListRow><RowId>{t('apps.runDetail.status')}</RowId><RowTitle><StatusBadge status={run.status} /></RowTitle></ListRow>
                <ListRow><RowId>{t('apps.runDetail.version')}</RowId><RowTitle><Mono>{run.releaseVersion === undefined ? '—' : `v${run.releaseVersion}`}</Mono></RowTitle></ListRow>
                <ListRow><RowId>{t('apps.runDetail.source')}</RowId><RowTitle>{run.source === 'schedule' ? t('apps.detail.sourceSchedule') : t('apps.detail.sourceManual')}</RowTitle></ListRow>
                <ListRow><RowId>{t('apps.runDetail.task')}</RowId><RowTitle><Mono className="break-all">{run.taskId}</Mono></RowTitle></ListRow>
                <ListRow><RowId>{t('apps.runDetail.created')}</RowId><RowTitle>{formatTime(run.createdAt)}</RowTitle></ListRow>
                <ListRow><RowId>{t('apps.runDetail.updated')}</RowId><RowTitle>{formatTime(run.updatedAt)}</RowTitle></ListRow>
              </Section>
              <Section card title={t('apps.runDetail.release')}>
                <ListRow><RowId>{t('apps.runDetail.releaseId')}</RowId><RowTitle><Mono className="break-all">{run.releaseId}</Mono></RowTitle></ListRow>
                <ListRow><RowId>{t('apps.runDetail.freshness')}</RowId><RowTitle>{run.freshness ?? '—'}</RowTitle></ListRow>
                <ListRow><RowId>{t('apps.runDetail.failureCode')}</RowId><RowTitle>{run.failureCode === undefined ? '—' : <span className="text-red">{run.failureCode}</span>}</RowTitle></ListRow>
                {run.failureDetail === undefined ? null : <ListRow><RowId>{t('apps.runDetail.failureDetail')}</RowId><RowTitle><span className="break-words">{run.failureDetail}</span></RowTitle></ListRow>}
              </Section>
              <Section card padded title={t('tasks.tabs.runLogs')}>
                <RunLogs taskId={taskId} live={live} />
              </Section>
            </>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <Artifacts taskId={taskId} live={live} fill empty={
                run.status === 'failed' ? (
                  <EmptyPane icon={<CircleAlert className="text-red" />} title={t('apps.runDetail.failedTitle')}>
                    {run.failureCode === undefined ? null : <p><Mono className="text-red">{run.failureCode}</Mono></p>}
                    {run.failureDetail === undefined ? null : <p className="mt-1 break-words">{run.failureDetail}</p>}
                    <p className="mt-3 text-faint">{t('apps.runDetail.failedHint')}</p>
                    <Button variant="secondary" size="sm" className="mt-3" onClick={() => setTab('overview')}>{t('apps.runDetail.viewOverview')}</Button>
                  </EmptyPane>
                ) : live ? <EmptyPane icon={<FileText />} title={t('tasks.artifacts.empty')}>{t('apps.runDetail.noArtifactsYet')}</EmptyPane> : undefined
              } />
            </div>
          )}
        </PageContent>
      )}
    </>
  );
}
