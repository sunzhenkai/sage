import { useEffect, useRef, useState } from 'react';
import { workspaceHref } from './workspace.js';
import { useLocale } from './locale.js';
import { TextAreaField, TextField } from './fields.js';
import { Banner, EmptyPanel, InlineNotice, LoadingState } from './feedback.js';

export interface PackageSummaryView {
  readonly packageId: string;
  readonly latestVersion: string;
  readonly releaseCount: number;
  readonly latestContentDigest: string;
  readonly updatedAt: string;
  readonly name?: string;
  readonly description?: string;
}
export interface PackageReleaseView {
  readonly packageVersion: string;
  readonly releaseRef: string;
  readonly releaseId: string;
  readonly contentDigest: string;
  readonly lockDigest: string;
  readonly compilerBuild: string;
  readonly createdAt: string;
}
export interface PackageAssetView {
  readonly relativePath: string;
  readonly kind: string;
  readonly digest: string;
  readonly bytes: number;
  readonly preview?: string;
}
export interface PackageManifestView {
  readonly id: string;
  readonly version: string;
  readonly description: string;
  readonly entry: string;
  readonly modelRoute: { readonly provider: string; readonly model: string };
  readonly skillRefs: readonly string[];
  readonly capabilityRefs: readonly string[];
}
export interface PackageDetailView {
  readonly packageId: string;
  readonly name?: string;
  readonly description?: string;
  readonly manifest?: PackageManifestView;
  readonly assets?: readonly PackageAssetView[];
  readonly releases: readonly PackageReleaseView[];
}

export type PackageFetch = typeof fetch;
async function packageJson<T>(fetcher: PackageFetch, url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetcher(url, { ...init, credentials: 'include', headers: { ...(init.body === undefined ? {} : { 'content-type': 'application/json' }), ...init.headers } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: { code: `HTTP_${response.status}` } })) as { error?: { code?: string; message?: string } };
    throw new Error(body.error?.message ?? body.error?.code ?? `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const APP_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/;

export function PackageList({ packages, loading, creating, error, onCreateApp }: {
  readonly packages: readonly PackageSummaryView[];
  readonly loading: boolean;
  readonly creating: boolean;
  readonly error?: string | undefined;
  readonly onCreateApp: (input: { appId: string; name: string; description?: string }) => void | Promise<void>;
}) {
  const { t, formatDateTime } = useLocale();
  const [showForm, setShowForm] = useState(false);
  const [appId, setAppId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [formError, setFormError] = useState<string>();
  const submit = () => {
    const trimmedId = appId.trim();
    const trimmedName = name.trim();
    if (trimmedId.length === 0) { setFormError(t('appIdRequired')); return; }
    if (!APP_ID_PATTERN.test(trimmedId)) { setFormError(t('appIdInvalid')); return; }
    if (trimmedName.length === 0) { setFormError(t('appNameRequired')); return; }
    setFormError(undefined);
    const trimmedDescription = description.trim();
    onCreateApp({ appId: trimmedId, name: trimmedName, ...(trimmedDescription === '' ? {} : { description: trimmedDescription }) });
  };
  return <section className="package-list-section" aria-label={t('packages')}>
    <div className="task-list-heading"><div><p className="eyebrow">{t('durableExecution')}</p><h2>{packages.length} {packages.length === 1 ? t('asset') : t('packages')}</h2></div>
      <div className="task-list-heading-actions"><span className="muted-copy">{t('mostRecentFirst')}</span><button className="button button-primary" type="button" onClick={() => { setShowForm((value) => !value); setFormError(undefined); }}>{t('newApp')}</button></div></div>
    {error ? <Banner kind="error" title={t('packageDataUnavailable')}>{error}</Banner> : null}
    {showForm ? <section className="detail-card app-create-card" aria-label={t('createApp')}>
      <div className="section-heading"><div><span className="eyebrow">{t('newApp')}</span><h3>{t('createApp')}</h3></div></div>
      <form className="form-grid" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <TextField label={t('appId')} value={appId} maxLength={128} onChange={setAppId} placeholder="my-app" hint={t('appIdHint')} />
        <TextField label={t('appName')} value={name} maxLength={128} onChange={setName} />
        <TextAreaField label={t('appDescription')} value={description} rows={2} maxLength={2048} onChange={setDescription} />
        {formError ? <InlineNotice error>{formError}</InlineNotice> : null}
        <div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setShowForm(false)}>{t('cancelAction')}</button><button className="button button-primary" type="submit" disabled={creating}>{creating ? t('creatingApp') : t('createApp')}</button></div>
      </form>
    </section> : null}
    {loading && packages.length === 0 ? <LoadingState label={t('loadingTaskProjections')} />
      : packages.length === 0 ? <EmptyPanel icon="▤" title={t('noPackages')} hint={t('noPackagesHint')} action={<button className="button button-primary" type="button" onClick={() => { setShowForm(true); setFormError(undefined); }}>{t('newApp')}</button>} />
      : <div className="task-table">{packages.map((item) => <a className="task-row" key={item.packageId} href={workspaceHref({ view: 'packages', packageId: item.packageId })}>
        <span className="task-row-icon">▤</span><span className="task-row-main"><strong className="task-id-link">{item.name ?? item.packageId}</strong><small>{item.name ? <>{item.packageId} · </> : null}{t('latestVersion')} · {item.latestVersion} · {t('releaseCount', { count: item.releaseCount })}</small></span>
        <span className="status-badge status-neutral">{item.latestVersion}</span><span className="task-row-target"><time dateTime={item.updatedAt}>{formatDateTime(item.updatedAt)}</time></span><span className="task-row-chevron">→</span>
      </a>)}</div>}
  </section>;
}

export function PackageDetailView({ detail, loading, starting, error, runStartedTaskId, uploading, uploadMessage, deleting, deleteConfirm, onStartRun, onUploadVersion, onRequestDelete, onCancelDelete, onConfirmDelete }: {
  readonly detail?: PackageDetailView | undefined;
  readonly loading: boolean;
  readonly starting: boolean;
  readonly error?: string | undefined;
  readonly runStartedTaskId?: string | undefined;
  readonly uploading: boolean;
  readonly uploadMessage?: { readonly kind: 'success' | 'error'; readonly text: string } | undefined;
  readonly deleting: boolean;
  readonly deleteConfirm: boolean;
  readonly onStartRun: (input: string) => void | Promise<void>;
  readonly onUploadVersion: (files: Record<string, string>) => void | Promise<void>;
  readonly onRequestDelete: () => void;
  readonly onCancelDelete: () => void;
  readonly onConfirmDelete: () => void | Promise<void>;
}) {
  const { t, formatDateTime } = useLocale();
  const [input, setInput] = useState('');
  const [uploadText, setUploadText] = useState('');
  const [uploadError, setUploadError] = useState<string>();
  const [showUpload, setShowUpload] = useState(false);
  const manifest = detail?.manifest;
  const submitUpload = () => {
    const trimmed = uploadText.trim();
    if (trimmed.length === 0) { setUploadError(t('uploadFilesRequired')); return; }
    let parsed: unknown;
    try { parsed = JSON.parse(trimmed); } catch { setUploadError(t('uploadFilesInvalid')); return; }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) { setUploadError(t('uploadFilesInvalid')); return; }
    const files = parsed as Record<string, unknown>;
    if (Object.keys(files).length === 0 || files['app.yaml'] === undefined) { setUploadError(t('uploadFilesRequired')); return; }
    for (const value of Object.values(files)) { if (typeof value !== 'string') { setUploadError(t('uploadFilesInvalid')); return; } }
    setUploadError(undefined);
    onUploadVersion(files as Record<string, string>);
  };
  return <article className="task-detail">
    <header className="detail-heading"><div><a className="back-link" href={workspaceHref({ view: 'packages' })}>← {t('allPackages')}</a>
      <div className="detail-title"><span className="task-row-icon">▤</span><div><p className="eyebrow">{t('packageDetail')}</p><h2>{detail?.name ?? detail?.packageId ?? ''}</h2></div>{detail && <span className="status-badge status-neutral">{manifest?.version ?? detail.releases[0]?.packageVersion ?? ''}</span>}</div>
    </div>
    <div className="detail-heading-actions">
      <button className="button button-secondary" type="button" disabled={loading} onClick={() => window.location.reload()}>↻ {t('refresh')}</button>
      {detail ? <>
        <button className="button button-secondary" type="button" onClick={() => { setShowUpload((value) => !value); setUploadError(undefined); }}>{t('uploadNewVersion')}</button>
        <button className="button button-danger" type="button" disabled={deleting} onClick={onRequestDelete}>{t('deleteApp')}</button>
      </> : null}
    </div></header>
    {error ? <Banner kind="error" title={t('packageDataUnavailable')}>{error}</Banner> : null}
    {runStartedTaskId ? <Banner kind="success" action={<a className="button button-primary" href={workspaceHref({ view: 'tasks', taskId: runStartedTaskId })}>{t('viewRun')} <span>→</span></a>}>{t('runStarted')}</Banner> : null}
    {uploadMessage ? <Banner kind={uploadMessage.kind === 'success' ? 'success' : 'error'}>{uploadMessage.text}</Banner> : null}
    {deleteConfirm ? <Banner kind="error" title={t('deleteApp')} action={<div className="form-actions"><button className="button button-secondary" type="button" onClick={onCancelDelete}>{t('cancelAction')}</button><button className="button button-danger" type="button" disabled={deleting} onClick={() => onConfirmDelete()}>{deleting ? t('deletingApp') : t('deleteAppConfirmAction')}</button></div>}>{t('deleteAppConfirm')}</Banner> : null}
    {loading && !detail ? <LoadingState label={t('loadingTaskProjections')} /> : detail === undefined ? null : <>
      {showUpload ? <section className="detail-card" aria-label={t('uploadNewVersion')}>
        <div className="section-heading"><div><span className="eyebrow">{t('uploadNewVersion')}</span><h3>{t('uploadVersion')}</h3></div></div>
        <p className="muted-copy">{t('uploadHint')}</p>
        <form className="form-grid" onSubmit={(event) => { event.preventDefault(); submitUpload(); }}>
          <TextAreaField label={t('uploadFiles')} value={uploadText} rows={8} maxLength={600_000} onChange={setUploadText} placeholder={t('uploadFilesPlaceholder')} />
          {uploadError ? <InlineNotice error>{uploadError}</InlineNotice> : null}
          <div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setShowUpload(false)}>{t('cancelAction')}</button><button className="button button-primary" type="submit" disabled={uploading}>{uploading ? t('uploadingVersion') : t('uploadVersion')}</button></div>
        </form>
      </section> : null}
      {manifest ? <div className="detail-grid"><section className="detail-card"><span className="eyebrow">{t('manifest')}</span>
        <dl>
          <dt>{t('latestVersion')}</dt><dd>{manifest.version}</dd>
          <dt>{t('manifestEntry')}</dt><dd>{manifest.entry}</dd>
          <dt>{t('modelRoute')}</dt><dd>{manifest.modelRoute.provider} / {manifest.modelRoute.model}</dd>
          <dt>{t('skills')}</dt><dd>{manifest.skillRefs.length === 0 ? '—' : manifest.skillRefs.join(', ')}</dd>
          <dt>{t('capabilities')}</dt><dd>{manifest.capabilityRefs.length === 0 ? '—' : manifest.capabilityRefs.join(', ')}</dd>
        </dl>
        {manifest.description ? <p className="muted-copy">{manifest.description}</p> : null}
      </section>
      <section className="detail-card"><span className="eyebrow">{t('startRun')}</span><p className="muted-copy">{t('startRunHint')}</p>
        <form className="form-grid" onSubmit={(event) => { event.preventDefault(); onStartRun(input.trim()); }}>
          <TextAreaField label={t('runInput')} value={input} rows={4} maxLength={100_000} onChange={setInput} placeholder={t('runInputPlaceholder')} />
          <div className="form-actions"><button className="button button-primary" type="submit" disabled={starting}>{starting ? t('startingRun') : t('startRunAction')}</button></div>
        </form>
      </section></div> : null}
      <section className="detail-card"><div className="section-heading"><div><span className="eyebrow">{t('assets')}</span><h3>{t('assets')}</h3></div><span className="badge badge-neutral">{detail.assets?.length ?? 0}</span></div>
        {!detail.assets || detail.assets.length === 0 ? <p className="muted-copy">{t('noAssets')}</p> : <div className="artifact-list">{detail.assets.map((asset) => <details className="package-asset" key={asset.relativePath}>
          <summary><span className="file-icon">↗</span><strong>{asset.relativePath}</strong><small>{asset.kind} · {formatBytes(asset.bytes)} · {asset.digest}</small></summary>
          {asset.preview ? <pre className="asset-preview">{asset.preview}</pre> : <p className="muted-copy">{t('noAssets')}</p>}
        </details>)}</div>}
      </section>
      <section className="detail-card"><div className="section-heading"><div><span className="eyebrow">{t('versionHistory')}</span><h3>{t('releases')}</h3></div><span className="badge badge-neutral">{detail.releases.length}</span></div>
        <ol className="task-timeline">{detail.releases.map((release) => <li key={release.releaseId}><span className="timeline-marker marker-task" /><div><strong>{release.packageVersion}</strong><small>{release.compilerBuild} · {t('contentDigest')} {release.contentDigest}</small></div><time>{formatDateTime(release.createdAt)}</time></li>)}</ol>
      </section>
    </>}
  </article>;
}

export function PackagesApp({ apiBase = '', fetcher = fetch, packageId }: { readonly apiBase?: string; readonly fetcher?: PackageFetch; readonly packageId?: string }) {
  const { t } = useLocale();
  const [packages, setPackages] = useState<readonly PackageSummaryView[]>([]);
  const [detail, setDetail] = useState<PackageDetailView>();
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [error, setError] = useState<string>();
  const [uploadMessage, setUploadMessage] = useState<{ kind: 'success' | 'error'; text: string } | undefined>();
  const [runStartedTaskId, setRunStartedTaskId] = useState<string>();
  const requestToken = useRef(0);
  const requestController = useRef<AbortController | undefined>(undefined);
  const startGuard = useRef(false);

interface AppSummaryResponse {
  readonly appId: string;
  readonly name?: string;
  readonly description?: string;
  readonly status?: string;
  readonly releaseCount: number;
  readonly latestVersion?: string;
  readonly latestContentDigest?: string;
  readonly updatedAt?: string;
  readonly createdAt?: string;
}

  const loadList = async () => {
    try {
      setError(undefined);
      const body = await packageJson<{ apps: readonly AppSummaryResponse[] }>(fetcher, `${apiBase}/v1/apps`);
      setPackages(body.apps.map((app) => ({
        packageId: app.appId,
        latestVersion: app.latestVersion ?? '—',
        releaseCount: app.releaseCount,
        latestContentDigest: app.latestContentDigest ?? '',
        updatedAt: app.updatedAt ?? app.createdAt ?? '',
        ...(app.name === undefined ? {} : { name: app.name }),
        ...(app.description === undefined ? {} : { description: app.description })
      })));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('packageDataUnavailable')); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (!packageId) void loadList(); }, [apiBase, fetcher, packageId]);

  const select = async (selectedPackageId: string) => {
    const token = ++requestToken.current;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    try {
      setError(undefined); setLoading(true); setUploadMessage(undefined); setDeleteConfirm(false);
      const result = await packageJson<PackageDetailView & { appId?: string }>(fetcher, `${apiBase}/v1/apps/${encodeURIComponent(selectedPackageId)}`, { signal: controller.signal });
      if (requestToken.current !== token || controller.signal.aborted) return;
      setDetail({ ...result, packageId: result.appId ?? result.packageId });
    } catch (cause) {
      if (requestToken.current === token && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : t('packageDataUnavailable'));
    } finally { if (requestToken.current === token) setLoading(false); }
  };
  useEffect(() => {
    const selected = packageId ?? (typeof window === 'undefined' ? undefined : new URLSearchParams(window.location.search).get('package') ?? undefined);
    if (selected) void select(selected);
    return () => requestController.current?.abort();
  }, [apiBase, fetcher, packageId]);

  const createApp = async (input: { appId: string; name: string; description?: string }) => {
    setCreating(true); setError(undefined);
    try {
      await packageJson(fetcher, `${apiBase}/v1/apps`, { method: 'POST', body: JSON.stringify(input) });
      await loadList();
      window.location.assign(workspaceHref({ view: 'packages', packageId: input.appId }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('createAppFailed')); }
    finally { setCreating(false); }
  };

  const uploadVersion = async (files: Record<string, string>) => {
    if (detail === undefined) return;
    setUploading(true); setUploadMessage(undefined); setError(undefined);
    try {
      const result = await packageJson<{ packageVersion: string }>(fetcher, `${apiBase}/v1/apps/${encodeURIComponent(detail.packageId)}/releases`, {
        method: 'POST', body: JSON.stringify({ files })
      });
      setUploadMessage({ kind: 'success', text: `${t('uploadSucceeded')} · ${result.packageVersion}` });
      await select(detail.packageId);
    } catch (cause) { setUploadMessage({ kind: 'error', text: cause instanceof Error ? cause.message : t('uploadFailed') }); }
    finally { setUploading(false); }
  };

  const confirmDelete = async () => {
    if (detail === undefined) return;
    setDeleting(true); setError(undefined);
    try {
      await packageJson(fetcher, `${apiBase}/v1/apps/${encodeURIComponent(detail.packageId)}`, { method: 'DELETE' });
      window.location.assign(workspaceHref({ view: 'packages' }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('deleteAppFailed')); setDeleting(false); }
  };

  const startRun = async (input: string) => {
    if (startGuard.current || detail === undefined) return;
    startGuard.current = true; setStarting(true); setError(undefined);
    try {
      const releaseId = detail.releases[0]?.releaseId;
      if (releaseId === undefined) throw new Error(t('packageNotFound'));
      const result = await packageJson<{ taskId: string }>(fetcher, `${apiBase}/v1/releases/${encodeURIComponent(releaseId)}/runs`, {
        method: 'POST', body: JSON.stringify({ input })
      });
      setRunStartedTaskId(result.taskId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('runStartFailed')); }
    finally { startGuard.current = false; setStarting(false); }
  };

  return <section className="workspace-page packages-page">
    <header className="page-heading"><div><p className="eyebrow">{t('durableExecution')}</p><h1>{t('packages')}</h1><p className="page-subtitle">{t('packagesSubtitle')}</p></div></header>
    {packageId || (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('package'))
      ? <PackageDetailView detail={detail} loading={loading} starting={starting} error={error} runStartedTaskId={runStartedTaskId} uploading={uploading} uploadMessage={uploadMessage} deleting={deleting} deleteConfirm={deleteConfirm} onStartRun={startRun} onUploadVersion={uploadVersion} onRequestDelete={() => setDeleteConfirm(true)} onCancelDelete={() => setDeleteConfirm(false)} onConfirmDelete={confirmDelete} />
      : <PackageList packages={packages} loading={loading} creating={creating} error={error} onCreateApp={createApp} />}
  </section>;
}
