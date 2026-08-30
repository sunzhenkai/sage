import { useEffect, useRef, useState } from 'react';
import { workspaceHref } from './workspace.js';
import { useLocale } from './locale.js';
import { Field, Modal, SelectField, TextAreaField, TextField } from './fields.js';
import { Banner, EmptyPanel, InlineNotice, LoadingState } from './feedback.js';
import { EXAMPLE_APPS, type ExampleApp } from './example-apps.js';

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
export interface PackageManifestInputView {
  readonly name: string;
  readonly type: 'string' | 'enum' | 'number';
  readonly required: boolean;
  readonly enum?: readonly (string | number)[];
  readonly default?: string | number;
}
export interface PackageManifestDataSourceView { readonly name: string; readonly url: string }
export interface PackageManifestTaskView { readonly name: string; readonly entry: string }
export interface PackageManifestView {
  readonly id: string;
  readonly version: string;
  readonly description: string;
  readonly entry: string;
  readonly modelRoute: { readonly provider: string; readonly model: string };
  readonly skillRefs: readonly string[];
  readonly capabilityRefs: readonly string[];
  readonly inputs?: readonly PackageManifestInputView[];
  readonly dataSources?: readonly PackageManifestDataSourceView[];
  readonly tasks?: readonly PackageManifestTaskView[];
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
export interface PackageRequestError extends Error { status?: number; code?: string }
async function packageJson<T>(fetcher: PackageFetch, url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetcher(url, { ...init, credentials: 'include', headers: { ...(init.body === undefined ? {} : { 'content-type': 'application/json' }), ...init.headers } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: { code: `HTTP_${response.status}` } })) as { error?: { code?: string; message?: string } };
    const failure: PackageRequestError = new Error(body.error?.message ?? body.error?.code ?? `HTTP ${response.status}`);
    failure.status = response.status;
    if (body.error?.code !== undefined) failure.code = body.error.code;
    throw failure;
  }
  return response.json() as Promise<T>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const APP_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/;

export function PackageList({ packages, loading, creating, importing, importError, error, onCreateApp, onImportExample }: {
  readonly packages: readonly PackageSummaryView[];
  readonly loading: boolean;
  readonly creating: boolean;
  readonly importing?: string | undefined;
  readonly importError?: string | undefined;
  readonly error?: string | undefined;
  readonly onCreateApp: (input: { appId: string; name: string; description?: string }) => void | Promise<void>;
  readonly onImportExample: (example: ExampleApp) => void | Promise<void>;
}) {
  const { t, formatDateTime, formatCompact } = useLocale();
  const [showForm, setShowForm] = useState(false);
  const [appId, setAppId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [formError, setFormError] = useState<string>();
  const [showExamples, setShowExamples] = useState(false);
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
    <header className="page-heading"><h1>{t('packages')}</h1><div className="page-heading-actions"><button className="button button-secondary" type="button" onClick={() => { setShowExamples(true); setFormError(undefined); }}>{t('importExamples')}</button><button className="button button-primary" type="button" onClick={() => { setShowForm(true); setFormError(undefined); }}>{t('newApp')}</button></div></header>
    {error ? <Banner kind="error" title={t('packageDataUnavailable')}>{error}</Banner> : null}
    <Modal open={showExamples} breadcrumb={`${t('packages')} › ${t('importExamples')}`} title={t('importExamplesTitle')} onClose={() => setShowExamples(false)} closeLabel={t('cancelAction')}>
      <p className="muted-copy">{t('importExamplesHint')}</p>
      {importError ? <InlineNotice error>{importError}</InlineNotice> : null}
      <div className="example-app-list">
        {EXAMPLE_APPS.map((example) => <div className="example-app-row" key={example.appId}>
          <span className="provider-mark">▤</span>
          <div className="example-app-copy"><strong>{example.name}</strong><small>{example.appId} · v{example.version}</small><p>{example.description}</p></div>
          <button className="button button-secondary example-import-button" type="button" disabled={importing !== undefined} onClick={() => onImportExample(example)}>{importing === example.appId ? t('importingExample') : t('importExampleAction')}</button>
        </div>)}
      </div>
    </Modal>
    <Modal open={showForm} breadcrumb={`${t('packages')} › ${t('newApp')}`} title={t('createApp')} onClose={() => setShowForm(false)} closeLabel={t('cancelAction')}>
      <form className="form-grid" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <TextField label={t('appId')} value={appId} maxLength={128} onChange={setAppId} placeholder="my-app" hint={t('appIdHint')} />
        <TextField label={t('appName')} value={name} maxLength={128} onChange={setName} />
        <TextAreaField label={t('appDescription')} value={description} rows={2} maxLength={2048} onChange={setDescription} />
        {formError ? <InlineNotice error>{formError}</InlineNotice> : null}
        <div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setShowForm(false)}>{t('cancelAction')}</button><button className="button button-primary" type="submit" disabled={creating}>{creating ? t('creatingApp') : t('createApp')}</button></div>
      </form>
    </Modal>
    {loading && packages.length === 0 ? <LoadingState label={t('loading')} />
      : packages.length === 0 ? <EmptyPanel icon="▤" title={t('noPackages')} hint={t('noPackagesHint')} action={<button className="button button-primary" type="button" onClick={() => { setShowForm(true); setFormError(undefined); }}>{t('newApp')}</button>} />
      : <div className="task-table">{packages.map((item) => <a className="task-row" key={item.packageId} href={workspaceHref({ view: 'packages', packageId: item.packageId })}>
        <span className="task-row-icon">▤</span><span className="task-row-main"><strong className="task-id-link">{item.name ?? item.packageId}</strong><small>{item.name ? <>{item.packageId} · </> : null}{t('releaseCount', { count: item.releaseCount })}</small></span>
        <span className="status-badge status-neutral">{item.latestVersion}</span><span className="task-row-target"><time dateTime={item.updatedAt} title={formatDateTime(item.updatedAt)}>{formatCompact(item.updatedAt)}</time></span><span className="task-row-chevron">→</span>
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
  readonly onStartRun: (request: { readonly task?: string; readonly params: Readonly<Record<string, string | number>> }) => void | Promise<void>;
  readonly onUploadVersion: (files: Record<string, string>) => void | Promise<void>;
  readonly onRequestDelete: () => void;
  readonly onCancelDelete: () => void;
  readonly onConfirmDelete: () => void | Promise<void>;
}) {
  const { t, formatDateTime } = useLocale();
  const manifest = detail?.manifest;
  const declaredInputs = manifest?.inputs ?? [];
  const declaredTasks = manifest?.tasks ?? [];
  const [selectedTask, setSelectedTask] = useState<string>('');
  const effectiveTask = declaredTasks.find((task) => task.name === selectedTask)?.name ?? declaredTasks[0]?.name;
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [paramError, setParamError] = useState<string>();
  const [uploadText, setUploadText] = useState('');
  const [uploadError, setUploadError] = useState<string>();
  const [showUpload, setShowUpload] = useState(false);
  const submitRun = () => {
    const params: Record<string, string | number> = {};
    for (const input of declaredInputs) {
      const raw = (paramValues[input.name] ?? '').trim();
      if (raw === '') continue; // 留空即用声明默认值
      if (input.type === 'number') {
        const numeric = Number(raw);
        if (!Number.isFinite(numeric)) { setParamError(t('numberParamInvalid', { name: input.name })); return; }
        params[input.name] = numeric;
        continue;
      }
      params[input.name] = raw;
    }
    setParamError(undefined);
    void onStartRun({ ...(effectiveTask === undefined ? {} : { task: effectiveTask }), params });
  };
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
      <div className="detail-title"><span className="task-row-icon">▤</span><h2>{detail?.name ?? detail?.packageId ?? ''}</h2>{detail && <span className="status-badge status-neutral">{manifest?.version ?? detail.releases[0]?.packageVersion ?? ''}</span>}</div>
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
    {loading && !detail ? <LoadingState label={t('loading')} /> : detail === undefined ? null : <>
      {showUpload ? <section className="detail-card" aria-label={t('uploadNewVersion')}>
        <div className="section-heading"><div><h3>{t('uploadVersion')}</h3></div></div>
        <p className="muted-copy">{t('uploadHint')}</p>
        <form className="form-grid" onSubmit={(event) => { event.preventDefault(); submitUpload(); }}>
          <TextAreaField label={t('uploadFiles')} value={uploadText} rows={8} maxLength={600_000} onChange={setUploadText} placeholder={t('uploadFilesPlaceholder')} />
          {uploadError ? <InlineNotice error>{uploadError}</InlineNotice> : null}
          <div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setShowUpload(false)}>{t('cancelAction')}</button><button className="button button-primary" type="submit" disabled={uploading}>{uploading ? t('uploadingVersion') : t('uploadVersion')}</button></div>
        </form>
      </section> : null}
      {manifest ? <div className="detail-grid"><section className="detail-card"><h3>{t('manifest')}</h3>
        <dl>
          <dt>{t('latestVersion')}</dt><dd>{manifest.version}</dd>
          <dt>{t('manifestEntry')}</dt><dd>{manifest.entry}</dd>
          <dt>{t('modelRoute')}</dt><dd>{manifest.modelRoute.provider} / {manifest.modelRoute.model}</dd>
          {manifest.skillRefs.length === 0 ? null : <><dt>{t('skills')}</dt><dd>{manifest.skillRefs.join(', ')}</dd></>}
          {manifest.capabilityRefs.length === 0 ? null : <><dt>{t('capabilities')}</dt><dd>{manifest.capabilityRefs.join(', ')}</dd></>}
          {manifest.inputs === undefined || manifest.inputs.length === 0 ? null : <><dt>{t('declaredInputs')}</dt><dd>{manifest.inputs.map((input) => `${input.name} (${input.type}${input.default === undefined ? '' : `=${String(input.default)}`})`).join(', ')}</dd></>}
          {manifest.dataSources === undefined || manifest.dataSources.length === 0 ? null : <><dt>{t('declaredDataSources')}</dt><dd>{manifest.dataSources.map((source) => source.name).join(', ')}</dd></>}
          {manifest.tasks === undefined || manifest.tasks.length === 0 ? null : <><dt>{t('declaredTasks')}</dt><dd>{manifest.tasks.map((task) => task.name).join(', ')}</dd></>}
        </dl>
        {manifest.description ? <p className="muted-copy">{manifest.description}</p> : null}
      </section>
      <section className="detail-card"><h3>{t('startRun')}</h3><p className="muted-copy">{t('startRunHint')}</p>
        <form className="form-grid" onSubmit={(event) => { event.preventDefault(); submitRun(); }}>
          {declaredTasks.length > 1
            ? <Field label={t('taskChoice')}><select aria-label={t('taskChoice')} value={effectiveTask ?? ''} onChange={(event) => setSelectedTask(event.target.value)}>{declaredTasks.map((task) => <option key={task.name} value={task.name}>{task.name}</option>)}</select></Field>
            : null}
          {declaredInputs.map((input) => input.type === 'enum'
            ? <SelectField key={input.name} label={input.name} value={paramValues[input.name] ?? ''} onChange={(value) => setParamValues((current) => ({ ...current, [input.name]: value }))}>
                <option value="">{t('paramDefaultOption')}</option>
                {(input.enum ?? []).map((option) => <option key={String(option)} value={String(option)}>{String(option)}</option>)}
              </SelectField>
            : <TextField key={input.name} label={input.name} value={paramValues[input.name] ?? ''} maxLength={2_048} onChange={(value) => setParamValues((current) => ({ ...current, [input.name]: value }))} placeholder={input.type === 'number' ? '0' : ''} />)}
          {paramError ? <InlineNotice error>{paramError}</InlineNotice> : null}
          {declaredInputs.length > 0 || declaredTasks.length > 1
            ? <div className="form-actions"><button className="button button-primary" type="submit" disabled={starting}>{starting ? t('startingRun') : t('startRunAction')}</button></div>
            : <button className="button button-primary" type="submit" disabled={starting}>{starting ? t('startingRun') : t('startRunAction')}</button>}
        </form>
      </section></div> : null}
      <section className="detail-card"><div className="section-heading"><div><h3>{t('assets')}</h3></div><span className="badge badge-neutral">{detail.assets?.length ?? 0}</span></div>
        {!detail.assets || detail.assets.length === 0 ? <p className="muted-copy">{t('noAssets')}</p> : <div className="artifact-list">{detail.assets.map((asset) => <details className="package-asset" key={asset.relativePath}>
          <summary><span className="file-icon">↗</span><strong>{asset.relativePath}</strong><small>{asset.kind} · {formatBytes(asset.bytes)} · {asset.digest}</small></summary>
          {asset.preview ? <pre className="asset-preview">{asset.preview}</pre> : <p className="muted-copy">{t('noAssets')}</p>}
        </details>)}</div>}
      </section>
      <section className="detail-card"><div className="section-heading"><div><h3>{t('releases')}</h3></div><span className="badge badge-neutral">{detail.releases.length}</span></div>
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
  const [importingExample, setImportingExample] = useState<string>();
  const [importError, setImportError] = useState<string>();
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
    if (selected === undefined) {
      // URL 已无 package（←全部应用 / 侧栏导航 / 浏览器后退）：组件复用时必须作废弃中的详情请求并清空详情态，否则旧详情会残留到下一次打开其他应用。
      ++requestToken.current;
      requestController.current?.abort();
      setDetail(undefined); setDeleteConfirm(false); setUploadMessage(undefined); setRunStartedTaskId(undefined);
      return;
    }
    void select(selected);
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

  const importExample = async (example: ExampleApp) => {
    if (importingExample !== undefined) return;
    setImportingExample(example.appId); setImportError(undefined); setError(undefined);
    try {
      try {
        await packageJson(fetcher, `${apiBase}/v1/apps`, { method: 'POST', body: JSON.stringify({ appId: example.appId, name: example.name, description: example.description }) });
      } catch (cause) {
        // 应用已登记（409）不算失败：继续走 Release 登记，重复导入保持幂等。
        const failure = cause as PackageRequestError;
        if (failure?.status !== 409 && failure?.code !== 'APP_ALREADY_EXISTS') throw cause;
      }
      await packageJson<{ packageVersion: string }>(fetcher, `${apiBase}/v1/apps/${encodeURIComponent(example.appId)}/releases`, {
        method: 'POST', body: JSON.stringify({ files: example.files })
      });
      await loadList();
      window.location.assign(workspaceHref({ view: 'packages', packageId: example.appId }));
    } catch (cause) { setImportError(cause instanceof Error ? cause.message : t('importExampleFailed')); }
    finally { setImportingExample(undefined); }
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

  const startRun = async (request: { readonly task?: string; readonly params: Readonly<Record<string, string | number>> }) => {
    if (startGuard.current || detail === undefined) return;
    startGuard.current = true; setStarting(true); setError(undefined);
    try {
      const releaseId = detail.releases[0]?.releaseId;
      if (releaseId === undefined) throw new Error(t('packageNotFound'));
      const result = await packageJson<{ taskId: string }>(fetcher, `${apiBase}/v1/releases/${encodeURIComponent(releaseId)}/runs`, {
        method: 'POST', body: JSON.stringify({ ...(request.task === undefined ? {} : { task: request.task }), params: { ...request.params } })
      });
      setRunStartedTaskId(result.taskId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('runStartFailed')); }
    finally { startGuard.current = false; setStarting(false); }
  };

  return <section className="workspace-page packages-page" aria-label={t('packages')}>
    {packageId || (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('package'))
      ? <PackageDetailView detail={detail} loading={loading} starting={starting} error={error} runStartedTaskId={runStartedTaskId} uploading={uploading} uploadMessage={uploadMessage} deleting={deleting} deleteConfirm={deleteConfirm} onStartRun={startRun} onUploadVersion={uploadVersion} onRequestDelete={() => setDeleteConfirm(true)} onCancelDelete={() => setDeleteConfirm(false)} onConfirmDelete={confirmDelete} />
      : <PackageList packages={packages} loading={loading} creating={creating} importing={importingExample} importError={importError} error={error} onCreateApp={createApp} onImportExample={importExample} />}
  </section>;
}
