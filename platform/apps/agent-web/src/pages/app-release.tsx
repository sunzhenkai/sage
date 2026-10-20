import { useQuery } from '@tanstack/react-query';
import { Download, GitBranch, Play, Tags } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { Crumb, PageHeader } from '@/components/layout/app-shell';
import { CodeBlock } from '@/components/bui/code-block';
import { RunReleaseDialog } from '@/components/bui/run-release-dialog';
import { DetailLayout, PageContent, PageDescription, Quiet, Section } from '@/components/layout/page';
import { Button } from '@/components/ui/button';
import { ListRow, Pill, Property, PropertyGroup, RowId, RowMeta, RowTitle } from '@/components/ui/list';
import { ErrorState, JsonView, Loading, Mono } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { saveBlob } from '@/lib/download';
import { errorDisplay } from '@/lib/error-message';
import { useT } from '@/lib/i18n';
import { isMock } from '@/lib/mock';
import { formatTime } from '@/lib/utils';

export function AppReleaseDetailPage() {
  const { appId = '', releaseId = '' } = useParams();
  const t = useT();
  const release = useQuery({ queryKey: ['app-release', appId, releaseId], queryFn: () => api.apps.getRelease(appId, releaseId) });
  const [runOpen, setRunOpen] = useState(false);
  const [downloading, setDownloading] = useState<'source' | 'bundle'>();
  const [downloadError, setDownloadError] = useState<string>();
  const detail = release.data;
  const manifest = detail?.manifest;
  const shortDigest = (digest: string | undefined) => digest?.replace(/^sha256:/, '').slice(0, 12) ?? '—';

  const download = async (format: 'source' | 'bundle') => {
    if (detail === undefined) return;
    setDownloading(format);
    setDownloadError(undefined);
    try {
      saveBlob(await api.apps.exportRelease(appId, detail.releaseId, format), `${appId}-v${detail.packageVersion}-${format}.tar.gz`);
    } catch (error) {
      const display = errorDisplay(error);
      setDownloadError([display.text, display.detail].filter(Boolean).join(' '));
    } finally {
      setDownloading(undefined);
    }
  };

  return (
    <>
      <PageHeader
        breadcrumb={<><Crumb to="/apps">{t('nav.apps')}</Crumb><span className="hidden items-center gap-1.5 sm:flex"><Crumb to={`/apps/${encodeURIComponent(appId)}`}>{appId}</Crumb></span></>}
        title={detail === undefined ? releaseId : `v${detail.packageVersion}`}
        meta={detail === undefined ? null : <div className="hidden items-center gap-2 lg:flex"><Pill color="var(--violet)"><GitBranch className="size-3" />{detail.releaseRef}</Pill><span>{formatTime(detail.createdAt)}</span></div>}
        actions={detail === undefined ? null : (
          <>
            <Button variant="secondary" size="sm" aria-label={t('apps.release.downloadSource')} title={t('apps.release.downloadSource')} disabled={downloading !== undefined} onClick={() => { void download('source'); }}><Download /><span className="hidden sm:inline">{downloading === 'source' ? t('apps.release.downloading') : t('apps.release.downloadSource')}</span></Button>
            <Button variant="secondary" size="sm" aria-label={t('apps.release.downloadBundle')} title={t('apps.release.downloadBundle')} disabled={downloading !== undefined} onClick={() => { void download('bundle'); }}><Download /><span className="hidden sm:inline">{downloading === 'bundle' ? t('apps.release.downloading') : t('apps.release.downloadBundle')}</span></Button>
            <Button size="sm" aria-label={t('apps.release.run')} title={isMock() ? t('apps.run.mockDisabled') : t('apps.release.run')} disabled={isMock()} onClick={() => setRunOpen(true)}><Play /><span className="hidden sm:inline">{t('apps.release.run')}</span></Button>
          </>
        )} />
      {downloadError !== undefined ? <p className="gutter-x py-3 text-[12.5px] text-red" role="alert">{t('apps.release.downloadFailed')} {downloadError}</p> : null}
      {release.isLoading ? <Loading /> : release.error ? <ErrorState error={release.error} /> : detail ? (
        <DetailLayout properties={
          <PropertyGroup title={t('apps.release.provenance')}>
            <Property label={t('apps.release.fields.version')}><Mono>{detail.packageVersion}</Mono></Property>
            <Property label={t('apps.release.fields.createdAt')}>{formatTime(detail.createdAt)}</Property>
            <Property label={t('apps.release.fields.contentDigest')}><Mono>{shortDigest(detail.contentDigest)}</Mono></Property>
            <Property label={t('apps.release.fields.lockDigest')}><Mono>{shortDigest(detail.lockDigest)}</Mono></Property>
            <Property label={t('apps.release.fields.compilerBuild')}><Mono>{detail.compilerBuild}</Mono></Property>
          </PropertyGroup>
        }>
          <PageContent>
            <PageDescription title={`v${detail.packageVersion}`} description={manifest?.description ?? t('apps.release.description')} />
            <Section card title={t('apps.release.manifest')}>
              <>
                <ListRow><RowId>{t('apps.release.fields.version')}</RowId><RowTitle><Mono>{manifest?.version ?? detail.packageVersion}</Mono></RowTitle><RowMeta><Tags className="size-3.5" /></RowMeta></ListRow>
                <ListRow><RowId>{t('apps.detail.entry')}</RowId><RowTitle><Mono>{manifest?.entry ?? '—'}</Mono></RowTitle></ListRow>
                <ListRow><RowId>{t('apps.detail.model')}</RowId><RowTitle><Mono>{manifest?.modelRoute === undefined ? '—' : `${manifest.modelRoute.provider} / ${manifest.modelRoute.model}`}</Mono></RowTitle></ListRow>
                <ListRow><RowId>{t('apps.detail.tasks')}</RowId><RowMeta>{(manifest?.tasks ?? []).map((task) => <Pill key={task.name}>{task.name}</Pill>)}</RowMeta></ListRow>
                <ListRow><RowId>{t('apps.detail.skills')}</RowId><RowMeta>{(manifest?.skillRefs ?? []).map((skill) => <Pill key={skill} color="var(--violet)">{skill.replace(/^skill:\/\//, '')}</Pill>)}</RowMeta></ListRow>
                <ListRow><RowId>{t('apps.detail.capabilities')}</RowId><RowMeta>{(manifest?.capabilityRefs ?? []).map((capability) => <Pill key={capability} color="var(--blue)">{capability.replace(/^capability:\/\//, '')}</Pill>)}</RowMeta></ListRow>
              </>
            </Section>
            <Section card title={t('apps.release.provenance')}>
              <>
                {([
                  [t('apps.release.fields.releaseId'), detail.releaseId],
                  [t('apps.release.fields.releaseRef'), detail.releaseRef],
                  [t('apps.release.fields.contentDigest'), detail.contentDigest],
                  [t('apps.release.fields.sourceFilesDigest'), detail.sourceFilesDigest ?? detail.provenance.sourceDigest],
                  [t('apps.release.fields.lockDigest'), detail.provenance.lockDigest],
                  [t('apps.release.fields.compilerBuild'), detail.provenance.compilerBuild],
                  ['compilerRef', detail.provenance.compilerRef],
                  ['compilerDigest', detail.provenance.compilerDigest],
                  ['sbomDigest', detail.provenance.sbomDigest],
                  ['provenanceDigest', detail.provenance.provenanceDigest],
                  ['policyDigest', detail.provenance.policyDigest],
                  ['signatureDigest', detail.provenance.signatureDigest]
                ] as const).map(([label, value]) => (
                  <ListRow key={label}><RowId>{label}</RowId><RowTitle sub={<Mono className="truncate">{value}</Mono>}><Mono>{shortDigest(value)}</Mono></RowTitle></ListRow>
                ))}
              </>
            </Section>
            <Section card title={t('apps.release.assets')} count={detail.assets?.length ?? 0}>
              {detail.assets === undefined || detail.assets.length === 0 ? <div className="gutter-x py-5"><Quiet>{t('apps.release.assetsEmpty')}</Quiet></div> : (detail.assets ?? []).map((asset) => (
                <details key={asset.relativePath}>
                  <summary className="flex h-[38px] cursor-default list-none items-center gap-3 gutter-x hover:bg-hover">
                    <RowId>{asset.kind.toUpperCase().slice(0, 10)}</RowId>
                    <RowTitle><Mono className="text-[12.5px]">{asset.relativePath}</Mono></RowTitle>
                    <RowMeta><span className="text-faint">{asset.bytes} B</span></RowMeta>
                  </summary>
                  {asset.preview ? <div className="gutter-x pb-2"><CodeBlock code={asset.preview} filename={asset.relativePath} maxHeight={288} /></div> : null}
                </details>
              ))}
            </Section>
            <Section title={t('apps.release.raw')}>
              <details>
                <summary className="cursor-default text-[12px] text-muted hover:text-fg">{t('apps.release.showRaw')}</summary>
                <div className="pt-2"><JsonView value={detail} filename={`${appId}-${detail.packageVersion}.json`} /></div>
              </details>
            </Section>
          </PageContent>
        </DetailLayout>
      ) : null}
      <RunReleaseDialog appId={appId} release={runOpen ? detail : undefined} manifest={detail?.manifest} onClose={() => setRunOpen(false)} />
    </>
  );
}
