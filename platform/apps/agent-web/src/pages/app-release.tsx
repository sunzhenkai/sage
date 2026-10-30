import { useQuery } from '@tanstack/react-query';
import { Copy, Play } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { Crumb, PageHeader } from '@/components/layout/app-shell';
import { CodeBlock } from '@/components/bui/code-block';
import { RunReleaseDialog } from '@/components/bui/run-release-dialog';
import { DetailLayout, PageContent, Quiet, Section } from '@/components/layout/page';
import { ActionMenu } from '@/components/ui/action-menu';
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
        meta={detail === undefined ? null : <span>{formatTime(detail.createdAt)}</span>}
        actions={detail === undefined ? null : (
          <>
            <Button size="sm" aria-label={t('apps.release.run')} title={isMock() ? t('apps.run.mockDisabled') : t('apps.release.run')} disabled={isMock()} onClick={() => setRunOpen(true)}><Play />{t('apps.release.run')}</Button>
            <ActionMenu label={t('apps.menu.more')} items={[
              { id: 'source', label: downloading === 'source' ? t('apps.release.downloading') : t('apps.release.downloadSource'), disabled: downloading !== undefined, onSelect: () => { void download('source'); } },
              { id: 'bundle', label: downloading === 'bundle' ? t('apps.release.downloading') : t('apps.release.downloadBundle'), disabled: downloading !== undefined, onSelect: () => { void download('bundle'); } }
            ]} />
          </>
        )} />
      {downloadError !== undefined ? <p className="gutter-x py-3 text-[12.5px] text-red" role="alert">{t('apps.release.downloadFailed')} {downloadError}</p> : null}
      {release.isLoading ? <Loading /> : release.error ? <ErrorState error={release.error} /> : detail ? (
        <DetailLayout properties={<>
          <PropertyGroup title={t('apps.detail.properties')}>
            <Property label={t('apps.release.fields.version')}><Mono>{detail.packageVersion}</Mono></Property>
            <Property label={t('apps.detail.entry')}><Mono>{manifest?.entry ?? '—'}</Mono></Property>
            <Property label={t('apps.detail.model')}>{manifest?.modelRoute === undefined ? null : <Mono>{`${manifest.modelRoute.provider} / ${manifest.modelRoute.model}`}</Mono>}</Property>
          </PropertyGroup>
          {(manifest?.tasks ?? []).length === 0 ? null : (
            <PropertyGroup title={t('apps.detail.tasks')}>
              <div className="flex flex-wrap gap-1 px-2">{(manifest?.tasks ?? []).map((task) => <Pill key={task.name}>{task.name}</Pill>)}</div>
            </PropertyGroup>
          )}
          {(manifest?.skillRefs ?? []).length === 0 ? null : (
            <PropertyGroup title={t('apps.detail.skills')}>
              <div className="flex flex-wrap gap-1 px-2">{(manifest?.skillRefs ?? []).map((skill) => <Pill key={skill} color="var(--violet)">{skill.replace(/^skill:\/\//, '')}</Pill>)}</div>
            </PropertyGroup>
          )}
          {(manifest?.capabilityRefs ?? []).length === 0 ? null : (
            <PropertyGroup title={t('apps.detail.capabilities')}>
              <div className="flex flex-wrap gap-1 px-2">{(manifest?.capabilityRefs ?? []).map((capability) => <Pill key={capability} color="var(--blue)">{capability.replace(/^capability:\/\//, '')}</Pill>)}</div>
            </PropertyGroup>
          )}
        </>}>
          <PageContent>
            <Section card title={t('apps.release.provenance')}>
              {([
                [t('apps.release.fields.releaseId'), detail.releaseId],
                [t('apps.release.fields.contentDigest'), detail.contentDigest],
                [t('apps.release.fields.compilerBuild'), detail.provenance.compilerBuild],
                [t('apps.release.fields.releaseRef'), detail.releaseRef],
                [t('apps.release.fields.sourceFilesDigest'), detail.sourceFilesDigest ?? detail.provenance.sourceDigest],
                [t('apps.release.fields.lockDigest'), detail.provenance.lockDigest],
                ['compilerRef', detail.provenance.compilerRef],
                ['compilerDigest', detail.provenance.compilerDigest],
                ['sbomDigest', detail.provenance.sbomDigest],
                ['provenanceDigest', detail.provenance.provenanceDigest],
                ['policyDigest', detail.provenance.policyDigest],
                ['signatureDigest', detail.provenance.signatureDigest]
              ] as const).map(([label, value]) => (
                <ListRow key={label}>
                  <RowId>{label}</RowId>
                  <RowTitle><Mono className="truncate">{value}</Mono></RowTitle>
                  <RowMeta><Button variant="ghost" size="icon-sm" aria-label={t('common.copy')} title={t('common.copy')} onClick={() => { void navigator.clipboard?.writeText(value); }}><Copy /></Button></RowMeta>
                </ListRow>
              ))}
            </Section>
            <Section card title={t('apps.release.assets')} count={detail.assets?.length ?? 0}>
              {detail.assets === undefined || detail.assets.length === 0 ? <div className="gutter-x py-5"><Quiet>{t('apps.release.assetsEmpty')}</Quiet></div> : (detail.assets ?? []).map((asset) => (
                <div key={asset.relativePath}>
                  <ListRow>
                    <RowId>{asset.kind.toUpperCase().slice(0, 10)}</RowId>
                    <RowTitle><Mono className="text-[12.5px]">{asset.relativePath}</Mono></RowTitle>
                    <RowMeta><span className="text-faint">{asset.bytes} B</span></RowMeta>
                  </ListRow>
                  {asset.preview ? <div className="border-b border-line gutter-x pb-3 pt-1"><CodeBlock code={asset.preview} filename={asset.relativePath} maxHeight={288} /></div> : null}
                </div>
              ))}
            </Section>
            <Section title={t('apps.release.raw')}>
              <JsonView value={detail} filename={`${appId}-${detail.packageVersion}.json`} />
            </Section>
          </PageContent>
        </DetailLayout>
      ) : null}
      <RunReleaseDialog appId={appId} release={runOpen ? detail : undefined} manifest={detail?.manifest} onClose={() => setRunOpen(false)} />
    </>
  );
}
