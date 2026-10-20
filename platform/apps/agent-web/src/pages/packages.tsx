import { useQuery } from '@tanstack/react-query';
import { Boxes, Clock, Fingerprint, Hash, Package, Play, Tags } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { Crumb, PageHeader } from '@/components/layout/app-shell';
import { Monogram, Tag } from '@/components/bui/atoms';
import { PageContent, PageDescription, Quiet, Section } from '@/components/layout/page';
import { RecordsTable } from '@/components/bui/records-table';
import { CodeBlock } from '@/components/bui/code-block';
import { Button } from '@/components/ui/button';
import { ListRow, Pill, RowId, RowMeta, RowTitle } from '@/components/ui/list';
import { Empty, ErrorState, JsonView, Loading, Mono } from '@/components/ui/misc';
import { Sparkline, useChartTheme } from '@/components/charts';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { isMock, mockSeries } from '@/lib/mock';
import { formatTime, relativeTime } from '@/lib/utils';

export function PackagesPage() {
  const navigate = useNavigate();
  const t = useT();
  const packages = useQuery({ queryKey: ['packages'], queryFn: api.packages.list });
  const items = packages.data?.packages ?? [];
  const ct = useChartTheme();
  return (
    <>
      <PageHeader title={t('nav.packages')} />
      <PageContent width="wide">
        {packages.isLoading ? <Loading /> : packages.error ? <ErrorState error={packages.error} /> : !items.length ? <Empty icon={Package} title={t('packages.empty.title')} /> : (
          <Section title={t('packages.all.title')} description={t('packages.all.description')} count={items.length}>
          <RecordsTable rows={items} getKey={(x) => x.packageId} onRowClick={(x) => { void navigate(`/packages/${x.packageId}`); }}
            columns={[
              { key: 'pkg', label: t('packages.columns.package'), icon: <Package />, width: '30%', sort: (x, y) => x.packageId.localeCompare(y.packageId), render: (x) => <span className="flex min-w-0 items-center gap-2"><Monogram text={x.packageId} /><span className="truncate">{x.packageId}</span></span> },
              { key: 'version', label: t('packages.columns.latestVersion'), icon: <Tags />, width: 150, render: (x) => x.latestVersion ? <Tag>{`v${x.latestVersion}`}</Tag> : <span className="text-ink-3">—</span> },
              { key: 'usage', label: t('packages.columns.installs'), icon: <Hash />, width: 150, render: (x) => isMock() ? <span className="block h-5 w-full"><Sparkline values={mockSeries(x.packageId, 14, 3)} color={ct.series[3]!} height={20} /></span> : <span className="text-ink-3">—</span> },
              { key: 'releases', label: t('packages.columns.releases'), icon: <Hash />, width: 110, align: 'right', sort: (x, y) => x.releaseCount - y.releaseCount, render: (x) => <span className="tabular-nums text-ink-2">{x.releaseCount}</span> },
              { key: 'digest', label: t('packages.columns.contentDigest'), icon: <Fingerprint />, render: (x) => <span className="font-mono text-[12px] text-ink-2">{x.latestContentDigest ? `${x.latestContentDigest.slice(0, 19)}…` : '—'}</span> },
              { key: 'updated', label: t('packages.columns.lastUpdate'), icon: <Clock />, width: 140, sort: (x, y) => x.updatedAt.localeCompare(y.updatedAt), render: (x) => <span className="text-ink-2">{relativeTime(x.updatedAt)}</span> }
            ]} />
          </Section>
        )}
      </PageContent>
    </>
  );
}

export function PackageDetailPage() {
  const { packageId = '' } = useParams();
  const navigate = useNavigate();
  const t = useT();
  const pkg = useQuery({ queryKey: ['package', packageId], queryFn: () => api.packages.get(packageId) });
  const detail = pkg.data;
  const manifest = detail?.manifest;
  const releases = detail?.releases ?? [];
  const openApp = `/apps/${encodeURIComponent(packageId)}`;
  const shortDigest = (digest: string) => digest.replace(/^sha256:/, '').slice(0, 12);
  return (
    <>
      <PageHeader breadcrumb={<Crumb to="/packages">{t('nav.packages')}</Crumb>} title={packageId}
        actions={<Button variant="secondary" size="sm" asChild><Link to={openApp}><Boxes />{t('packages.detail.openApp')}</Link></Button>} />
      <PageContent>
        <PageDescription title={packageId} description={manifest?.description ?? t('packages.detail.description')} />
        {pkg.isLoading ? <Loading /> : pkg.error ? <ErrorState error={pkg.error} /> : detail ? (
          <>
            <Section card title={t('packages.detail.summary')}>
            <>
              <ListRow><RowId>{t('packages.detail.version')}</RowId><RowTitle><Mono>{manifest?.version ?? '—'}</Mono></RowTitle></ListRow>
              <ListRow><RowId>{t('packages.detail.entry')}</RowId><RowTitle><Mono>{manifest?.entry ?? '—'}</Mono></RowTitle></ListRow>
              <ListRow><RowId>{t('packages.detail.model')}</RowId><RowTitle><Mono>{manifest?.modelRoute === undefined ? '—' : `${manifest.modelRoute.provider} / ${manifest.modelRoute.model}`}</Mono></RowTitle></ListRow>
              <ListRow><RowId>{t('packages.detail.tasks')}</RowId><RowMeta>{(manifest?.tasks ?? []).map((task) => <Pill key={task.name}>{task.name}</Pill>)}</RowMeta></ListRow>
              <ListRow><RowId>{t('packages.detail.skills')}</RowId><RowMeta>{(manifest?.skillRefs ?? []).map((skill) => <Pill key={skill} color="var(--violet)">{skill.replace(/^skill:\/\//, '')}</Pill>)}</RowMeta></ListRow>
            </>
            </Section>
            <Section card title={t('packages.detail.assets')} count={detail.assets?.length ?? 0}>
            <>{(detail.assets ?? []).map((asset) => (
              <details key={asset.relativePath}>
                <summary className="flex h-[38px] cursor-default list-none items-center gap-3 gutter-x hover:bg-hover">
                  <RowId>{asset.kind.toUpperCase().slice(0, 10)}</RowId>
                  <RowTitle><Mono className="text-[12.5px]">{asset.relativePath}</Mono></RowTitle>
                  <RowMeta><span className="text-faint">{asset.bytes} B</span></RowMeta>
                </summary>
                {asset.preview ? <div className="gutter-x pb-2"><CodeBlock code={asset.preview} filename={asset.relativePath} maxHeight={288} /></div> : null}
              </details>
            ))}</>
            </Section>
            <Section card title={t('packages.detail.releases')} count={releases.length}>
            <>{releases.length === 0 ? <div className="gutter-x py-5"><Quiet>{t('packages.detail.releasesEmpty')}</Quiet></div> : releases.map((release) => (
              <ListRow key={release.releaseId}>
                <RowId>{`v${release.packageVersion}`}</RowId>
                <RowTitle sub={<Mono>{shortDigest(release.contentDigest)}</Mono>}>{shortDigest(release.releaseId)}</RowTitle>
                <RowMeta>
                  <span className="text-faint">{formatTime(release.createdAt)}</span>
                  <Link className="flex items-center gap-1 text-accent-ink hover:underline" to={openApp}><Boxes className="size-3.5" />{t('packages.detail.openApp')}</Link>
                  <Button size="sm" variant="secondary" disabled={isMock()} title={isMock() ? t('apps.run.mockDisabled') : undefined}
                    onClick={() => { void navigate(`${openApp}?run=${encodeURIComponent(release.releaseId)}`); }}>
                    <Play />{t('packages.detail.run')}
                  </Button>
                </RowMeta>
              </ListRow>
            ))}</>
            </Section>
            <Section title={t('packages.detail.raw')}>
              <details>
                <summary className="cursor-default text-[12px] text-muted hover:text-fg">{t('packages.detail.showRaw')}</summary>
                <div className="pt-2"><JsonView value={detail} filename={`${packageId}.json`} /></div>
              </details>
            </Section>
          </>
        ) : null}
      </PageContent>
    </>
  );
}
