import { useEffect, useRef, useState } from 'react';
import { workspaceHref } from './workspace.js';
import { useLocale } from './locale.js';

export interface PackageSummaryView {
  readonly packageId: string;
  readonly latestVersion: string;
  readonly releaseCount: number;
  readonly latestContentDigest: string;
  readonly updatedAt: string;
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

export function PackageList({ packages, loading }: { readonly packages: readonly PackageSummaryView[]; readonly loading: boolean }) {
  const { t, formatDateTime } = useLocale();
  return <section className="package-list-section" aria-label={t('packages')}>
    <div className="task-list-heading"><div><p className="eyebrow">{t('durableExecution')}</p><h2>{packages.length} {packages.length === 1 ? t('asset') : t('packages')}</h2></div><span className="muted-copy">{t('mostRecentFirst')}</span></div>
    {loading && packages.length === 0 ? <div className="loading-state"><span className="loading-spinner" /><strong>{t('loadingTaskProjections')}</strong></div>
      : packages.length === 0 ? <div className="empty-panel"><span className="empty-orb">▤</span><h3>{t('noPackages')}</h3><p>{t('noPackagesHint')}</p></div>
      : <div className="task-table">{packages.map((item) => <a className="task-row" key={item.packageId} href={workspaceHref({ view: 'packages', packageId: item.packageId })}>
        <span className="task-row-icon">▤</span><span className="task-row-main"><strong className="task-id-link">{item.packageId}</strong><small>{t('latestVersion')} · {item.latestVersion} · {t('releaseCount', { count: item.releaseCount })}</small></span>
        <span className="status-badge status-neutral">{item.latestVersion}</span><span className="task-row-target"><time dateTime={item.updatedAt}>{formatDateTime(item.updatedAt)}</time></span><span className="task-row-chevron">→</span>
      </a>)}</div>}
  </section>;
}

export function PackageDetailView({ detail, loading, starting, error, runStartedTaskId, onStartRun }: {
  readonly detail?: PackageDetailView | undefined;
  readonly loading: boolean;
  readonly starting: boolean;
  readonly error?: string | undefined;
  readonly runStartedTaskId?: string | undefined;
  readonly onStartRun: (input: string) => void | Promise<void>;
}) {
  const { t, formatDateTime } = useLocale();
  const [input, setInput] = useState('');
  const [inputError, setInputError] = useState<string>();
  const manifest = detail?.manifest;
  return <article className="task-detail">
    <header className="detail-heading"><div><a className="back-link" href={workspaceHref({ view: 'packages' })}>← {t('allPackages')}</a>
      <div className="detail-title"><span className="task-row-icon">▤</span><div><p className="eyebrow">{t('packageDetail')}</p><h2>{detail?.packageId ?? ''}</h2></div>{detail && <span className="status-badge status-neutral">{manifest?.version ?? detail.releases[0]?.packageVersion ?? ''}</span>}</div>
    </div><button className="button button-secondary" type="button" disabled={loading} onClick={() => window.location.reload()}>↻ {t('refresh')}</button></header>
    {error ? <div className="error-banner" role="alert"><span>!</span><div><strong>{t('packageDataUnavailable')}</strong><p>{error}</p></div></div> : null}
    {runStartedTaskId ? <div className="success-banner" role="status"><span>✓</span><p>{t('runStarted')}</p><a className="button button-primary" href={workspaceHref({ view: 'tasks', taskId: runStartedTaskId })}>{t('viewRun')} <span>→</span></a></div> : null}
    {loading && !detail ? <div className="loading-state"><span className="loading-spinner" /><strong>{t('loadingTaskProjections')}</strong></div> : detail === undefined ? null : <>
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
        <form className="form-grid" onSubmit={(event) => { event.preventDefault(); if (input.trim().length === 0) { setInputError(t('runInputRequired')); return; } setInputError(undefined); onStartRun(input.trim()); }}>
          <label className="field field-wide"><span>{t('runInput')}</span><textarea aria-label={t('runInput')} value={input} rows={4} maxLength={100_000} onChange={(event) => setInput(event.target.value)} placeholder={t('runInputPlaceholder')} /></label>
          {inputError ? <p className="inline-notice -error" role="alert">{inputError}</p> : null}
          <div className="form-actions"><button className="button button-primary" type="submit" disabled={starting}>{starting ? t('startingRun') : t('startRunAction')}</button></div>
        </form>
      </section></div> : null}
      <section className="detail-card"><div className="section-heading"><div><span className="eyebrow">{t('assets')}</span><h3>{t('assets')}</h3></div><span className="badge badge-neutral">{detail.assets?.length ?? 0}</span></div>
        {!detail.assets || detail.assets.length === 0 ? <p className="muted-copy">{t('noAssets')}</p> : <div className="artifact-list">{detail.assets.map((asset) => <details className="package-asset" key={asset.relativePath}>
          <summary><span className="file-icon">↗</span><strong>{asset.relativePath}</strong><small>{asset.kind} · {formatBytes(asset.bytes)} · {asset.digest}</small></summary>
          {asset.preview ? <pre className="asset-preview">{asset.preview}</pre> : <p className="muted-copy">{t('noAssets')}</p>}
        </details>)}</div>}
      </section>
      <section className="detail-card"><div className="section-heading"><div><span className="eyebrow">{t('releaseHistory')}</span><h3>{t('releases')}</h3></div><span className="badge badge-neutral">{detail.releases.length}</span></div>
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
  const [error, setError] = useState<string>();
  const [runStartedTaskId, setRunStartedTaskId] = useState<string>();
  const requestToken = useRef(0);
  const requestController = useRef<AbortController | undefined>(undefined);
  const startGuard = useRef(false);

  const loadList = async () => {
    try {
      setError(undefined);
      setPackages((await packageJson<{ packages: PackageSummaryView[] }>(fetcher, `${apiBase}/v1/packages`)).packages);
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
      setError(undefined); setLoading(true);
      const result = await packageJson<PackageDetailView>(fetcher, `${apiBase}/v1/packages/${encodeURIComponent(selectedPackageId)}`, { signal: controller.signal });
      if (requestToken.current !== token || controller.signal.aborted) return;
      setDetail(result);
    } catch (cause) {
      if (requestToken.current === token && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : t('packageDataUnavailable'));
    } finally { if (requestToken.current === token) setLoading(false); }
  };
  useEffect(() => {
    const selected = packageId ?? (typeof window === 'undefined' ? undefined : new URLSearchParams(window.location.search).get('package') ?? undefined);
    if (selected) void select(selected);
    return () => requestController.current?.abort();
  }, [apiBase, fetcher, packageId]);

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
    {packageId || (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('package')) ? <PackageDetailView detail={detail} loading={loading} starting={starting} error={error} runStartedTaskId={runStartedTaskId} onStartRun={startRun} /> : <PackageList packages={packages} loading={loading} />}
  </section>;
}
