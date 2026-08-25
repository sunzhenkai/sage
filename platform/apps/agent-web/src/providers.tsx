import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { CatalogStatus, ModelCatalogItem, ModelCatalogPage, ProviderCatalogItem, ProviderCatalogPage } from '@sage/app-contracts';
import {
  applyCatalogSelection, loadProviderProfiles, profileCompletion, saveProfileSecret, saveProviderProfiles,
  secretPresent, validHttpsUrl, PROVIDER_SECRET_PREFIX, type AdapterKind, type BaseUrlSource, type ProviderProfileV2
} from './profiles.js';
import { useLocale } from './locale.js';
import { WorkspaceProvidersCard } from './workspace-providers.js';

type ConnectionCheckState = 'idle' | 'checking' | 'connected' | 'unauthorized' | 'unavailable';
type Draft = Omit<ProviderProfileV2, 'updatedAt'> & { apiKey: string };
type EditorState = { mode: 'idle' } | { mode: 'creating'; draft: Draft; nameDirty: boolean } | { mode: 'editing'; profileId: string; draft: Draft; nameDirty: boolean } | { mode: 'saving'; profileId?: string; draft: Draft; nameDirty: boolean };
/** GET/PUT /v1/run-agent/settings 的视图模型：默认 provider + 注册表条目可用性（不含任何密钥）。 */
interface RunAgentSettingsView {
  readonly defaultProvider: 'echo' | 'connection';
  readonly providerConnectionId?: string;
  readonly providers?: ReadonlyArray<{ readonly id: string; readonly name?: string; readonly available: boolean; readonly reason?: string }>;
}
const anyAvailableIn = (view: RunAgentSettingsView | undefined): boolean =>
  view?.providers?.some((provider) => provider.available) ?? false;
const connectionStatusIn = (view: RunAgentSettingsView | undefined): { readonly name: string; readonly available: boolean } | undefined => {
  const id = view?.providerConnectionId;
  if (view?.defaultProvider !== 'connection' || id === undefined) return undefined;
  const entry = view.providers?.find((provider) => provider.id === id);
  return { name: entry?.name ?? id, available: entry?.available ?? false };
};
const local = (): Storage | undefined => typeof window === 'undefined' ? undefined : window.localStorage;
const session = (): Storage | undefined => typeof window === 'undefined' ? undefined : window.sessionStorage;
const blank = (): Draft => ({ id: '', name: '', enabled: false, adapterKind: 'unassigned', baseUrlSource: 'none', apiKey: '' });
const draftOf = (profile: ProviderProfileV2): Draft => ({ ...profile, apiKey: '' });
const idOf = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || `profile-${Date.now()}`;
const safeMessage = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message : fallback;

export function ProvidersApp({ fetcher = fetch }: { readonly fetcher?: typeof fetch }) {
  const { t, formatDateTime } = useLocale();
  const initial = useMemo(() => local() ? loadProviderProfiles(local()!) : { profiles: [], warnings: [], migrated: false }, []);
  const [profiles, setProfiles] = useState<readonly ProviderProfileV2[]>(initial.profiles);
  const [editor, setEditor] = useState<EditorState>({ mode: 'idle' });
  const [notice, setNotice] = useState<string | undefined>(initial.error ?? initial.warnings[0]);
  const [syncing, setSyncing] = useState(false);
  const [connectionStates, setConnectionStates] = useState<Record<string, ConnectionCheckState>>({});
  const [catalog, setCatalog] = useState<CatalogStatus>();
  const [runAgent, setRunAgent] = useState<RunAgentSettingsView>();
  const [runAgentSaving, setRunAgentSaving] = useState(false);
  const [providerQuery, setProviderQuery] = useState(''); const [modelQuery, setModelQuery] = useState('');
  const [providers, setProviders] = useState<readonly ProviderCatalogItem[]>([]); const [models, setModels] = useState<readonly ModelCatalogItem[]>([]);
  const [providerPage, setProviderPage] = useState<Pick<ProviderCatalogPage, 'snapshotId'|'activeSince'>>();
  const [modelPage, setModelPage] = useState<Pick<ModelCatalogPage, 'snapshotId'|'activeSince'>>();
  const [providerIndex, setProviderIndex] = useState(0); const [modelIndex, setModelIndex] = useState(0);
  const [providerOpen, setProviderOpen] = useState(false); const [modelOpen, setModelOpen] = useState(false);
  const [providerLoading, setProviderLoading] = useState(false); const [modelLoading, setModelLoading] = useState(false);
  const providerToken = useRef(0); const modelToken = useRef(0); const checkConnectionToken = useRef(0); const syncCatalogToken = useRef(0); const baseUrlRef = useRef<HTMLInputElement>(null); const providerInputRef = useRef<HTMLInputElement>(null); const addButtonRef = useRef<HTMLButtonElement>(null);
  const draft = editor.mode === 'idle' ? undefined : editor.draft;

  useEffect(() => { void fetcher('/v1/provider-catalog/status', { credentials: 'include' }).then(async (response) => {
    if (!response.ok) throw new Error(`Catalog status ${response.status}`); setCatalog(await response.json() as CatalogStatus);
  }).catch((cause) => setNotice(safeMessage(cause, t('catalogUnavailable')))); }, [fetcher]);

  useEffect(() => { void fetcher('/v1/run-agent/settings', { credentials: 'include' }).then(async (response) => {
    if (!response.ok) throw new Error(`Run agent settings ${response.status}`); setRunAgent(await response.json() as RunAgentSettingsView);
  }).catch((cause) => setNotice(safeMessage(cause, t('runAgentUnavailable')))); }, [fetcher]);

  const saveRunAgent = async (selection: string) => {
    if (runAgentSaving) return;
    setRunAgentSaving(true);
    const payload = selection.startsWith('connection:')
      ? { defaultProvider: 'connection', providerConnectionId: selection.slice('connection:'.length) }
      : { defaultProvider: selection };
    try {
      const response = await fetcher('/v1/run-agent/settings', {
        method: 'PUT', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(`Run agent settings ${response.status}`);
      setRunAgent(await response.json() as RunAgentSettingsView);
      setNotice(t('runAgentSaved'));
    } catch (cause) {
      setNotice(safeMessage(cause, t('runAgentSaveFailed')));
    } finally {
      setRunAgentSaving(false);
    }
  };

  useEffect(() => {
    if (editor.mode === 'idle') { setProviderLoading(false); setProviderOpen(false); setModelOpen(false); return; }
    const token = ++providerToken.current; const controller = new AbortController();
    setProviderLoading(true);
    const timer = setTimeout(() => { const params = new URLSearchParams({ limit: '30' }); if (providerQuery.trim()) params.set('q', providerQuery.trim());
      void fetcher(`/v1/provider-catalog/providers?${params}`, { credentials: 'include', signal: controller.signal }).then(async (response) => {
        if (response.status === 409) { setNotice(t('catalogUpdatedProviders')); setProviderQuery(''); return; }
        if (!response.ok) throw new Error(`Catalog providers ${response.status}`); const page = await response.json() as ProviderCatalogPage;
        if (providerToken.current !== token || controller.signal.aborted) return; setProviders(page.items); setProviderPage(page); setProviderIndex(0);
      }).catch((cause) => { if (!controller.signal.aborted) setNotice(safeMessage(cause, t('catalogUnavailable'))); })
        .finally(() => { if (providerToken.current === token) setProviderLoading(false); }); }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [editor.mode, providerQuery, fetcher]);

  useEffect(() => {
    if (!draft?.providerId) { setModels([]); setModelLoading(false); return; }
    const token = ++modelToken.current; const controller = new AbortController();
    setModelLoading(true);
    const timer = setTimeout(() => { const params = new URLSearchParams({ limit: '30', providerId: draft.providerId!, status: 'all' }); if (modelQuery.trim()) params.set('q', modelQuery.trim());
      void fetcher(`/v1/provider-catalog/models?${params}`, { credentials: 'include', signal: controller.signal }).then(async (response) => {
        if (response.status === 409) { setNotice(t('catalogUpdatedModels')); setModelQuery(''); return; }
        if (!response.ok) throw new Error(`Catalog models ${response.status}`); const page = await response.json() as ModelCatalogPage;
        if (modelToken.current !== token || controller.signal.aborted) return; setModels(page.items); setModelPage(page); setModelIndex(0);
      }).catch((cause) => { if (!controller.signal.aborted) setNotice(safeMessage(cause, t('catalogUnavailable'))); })
        .finally(() => { if (modelToken.current === token) setModelLoading(false); }); }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [draft?.providerId, editor.mode, modelQuery, fetcher]);

  useEffect(() => {
    if (editor.mode !== 'creating') return;
    setProviderOpen(true);
    providerInputRef.current?.focus();
  }, [editor.mode]);

  const previousEditorMode = useRef(editor.mode);
  useEffect(() => {
    const wasCreating = previousEditorMode.current === 'creating';
    previousEditorMode.current = editor.mode;
    if (wasCreating && editor.mode === 'idle') addButtonRef.current?.focus();
  }, [editor.mode]);

  const update = (patch: Partial<Draft>, nameDirty = false, clear: readonly (keyof Draft)[] = []) => setEditor((current) => {
    if (current.mode === 'idle') return current;
    const next = { ...current.draft, ...patch } as Draft;
    for (const key of clear) delete (next as unknown as Record<string, unknown>)[key];
    return { ...current, draft: next, nameDirty: current.nameDirty || nameDirty };
  });
  const edit = (profile: ProviderProfileV2) => { setEditor({ mode: 'editing', profileId: profile.id, draft: draftOf(profile), nameDirty: true }); setNotice(undefined); };
  const createProfile = () => { setEditor({ mode: 'creating', draft: blank(), nameDirty: false }); setProviderQuery(''); setModelQuery(''); setProviders([]); setModels([]); setNotice(undefined); };
  const selectProvider = (provider: ProviderCatalogItem) => {
    const preserveName = editor.mode !== 'idle' && editor.nameDirty;
    update({ providerId: provider.providerId, providerName: provider.name, ...(!preserveName ? { name: provider.name } : {}), baseUrlSource: 'none', ...(providerPage ? { catalogSnapshotId: providerPage.snapshotId, catalogActiveSince: providerPage.activeSince } : {}) }, false, ['modelId', 'modelName', 'baseUrl']);
    setProviderQuery(provider.name); setModelQuery(''); setModels([]); setProviderOpen(false); setModelOpen(true);
  };
  const selectModel = (model: ModelCatalogItem) => {
    const provider = providers.find((item) => item.providerId === model.providerId);
    if (!provider || !providerPage || !modelPage || providerPage.snapshotId !== modelPage.snapshotId) { setNotice(t('reloadCatalog')); return; }
    const mapped = applyCatalogSelection(provider, model, modelPage);
    update(mapped); setModelQuery(model.name); setModelOpen(false);
  };
  const keyboard = <T,>(event: KeyboardEvent<HTMLInputElement>, items: readonly T[], index: number, setIndex: (value: number) => void, choose: (item: T) => void, close: () => boolean) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setIndex(Math.min(items.length - 1, index + 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setIndex(Math.max(0, index - 1)); }
    else if (event.key === 'Enter' && items[index]) { event.preventDefault(); choose(items[index]!); }
    else if (event.key === 'Escape') { event.preventDefault(); close(); }
  };
  const save = () => {
    if (editor.mode === 'idle' || editor.mode === 'saving') return;
    const draft = editor.draft;
    const id = draft.id || idOf(draft.name);
    if (!draft.name.trim() || !draft.providerId || !draft.modelId) { setNotice(t('nameProviderModelRequired')); return; }
    if (draft.enabled && draft.adapterKind !== 'unassigned' && !validHttpsUrl(draft.baseUrl)) { setNotice(t('validHttpsRequired')); baseUrlRef.current?.focus(); return; }
    const profile: ProviderProfileV2 = { ...draft, id, name: draft.name.trim(), updatedAt: new Date().toISOString() };
    const { apiKey: _secret, ...metadata } = profile as ProviderProfileV2 & { apiKey?: string }; void _secret;
    setEditor({ mode: 'saving', profileId: id, draft, nameDirty: editor.nameDirty });
    const next = [...profiles.filter((item) => item.id !== id), metadata];
    try {
      if (local()) saveProviderProfiles(local()!, next);
      if (draft.apiKey && session()) saveProfileSecret(session()!, id, draft.apiKey);
      setProfiles(next);
      setEditor(editor.mode === 'creating' ? { mode: 'idle' } : { mode: 'editing', profileId: id, draft: { ...draftOf(metadata), apiKey: '' }, nameDirty: true });
      setNotice(t('savedMetadata', { name: metadata.name }));
    }
    catch (cause) { setEditor(editor); setNotice(safeMessage(cause, t('catalogUnavailable'))); }
  };

  const checkConnection = async (profile: ProviderProfileV2) => {
    const key = session()?.getItem(`${PROVIDER_SECRET_PREFIX}${profile.id}`) ?? '';
    if (!profile.baseUrl || !profile.modelId) { setConnectionStates((current) => ({ ...current, [profile.id]: 'unavailable' })); setNotice(t('selectModelBeforeCheck')); return; }
    if (!key) { setConnectionStates((current) => ({ ...current, [profile.id]: 'unavailable' })); setNotice(t('enterApiKeyBeforeCheck')); return; }
    const token = ++checkConnectionToken.current;
    setConnectionStates((current) => ({ ...current, [profile.id]: 'checking' }));
    try {
      const response = await fetcher('/v1/provider-catalog/check-connection', {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ adapterKind: profile.adapterKind, baseUrl: profile.baseUrl, modelId: profile.modelId, apiKey: key })
      });
      const body = await response.json().catch(() => undefined) as { status?: ConnectionCheckState; message?: string; error?: { message?: string } } | undefined;
      if (!response.ok) throw new Error(body?.error?.message ?? 'Connection check failed');
      const status = body?.status;
      if (status !== 'connected' && status !== 'unauthorized' && status !== 'unavailable') throw new Error('Connection check failed');
      setConnectionStates((current) => ({ ...current, [profile.id]: status }));
      if (checkConnectionToken.current === token) setNotice(body?.message ?? (status === 'connected' ? t('providerConnected') : t('providerUnavailable')));
    } catch (cause) {
      setConnectionStates((current) => ({ ...current, [profile.id]: 'unavailable' }));
      if (checkConnectionToken.current === token) setNotice(safeMessage(cause, t('catalogUnavailable')));
    }
  };

  const syncCatalog = async () => {
    if (syncing) return;
    const token = ++syncCatalogToken.current;
    setSyncing(true); setNotice(undefined);
    try {
      const response = await fetcher('/v1/provider-catalog/sync', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: '{}' });
      if (syncCatalogToken.current !== token) return;
      const body = await response.json().catch(() => undefined) as { attemptId?: string; status?: string; error?: { message?: string } } | undefined;
      if (!response.ok) throw new Error(body?.error?.message ?? `Catalog sync ${response.status}`);
      setNotice(t('catalogSyncStatus', { status: body?.status ?? 'queued' }) + (body?.attemptId ? t('catalogSyncAttempt', { attempt: body.attemptId }) : ''));
    } catch (cause) {
      if (syncCatalogToken.current !== token) return;
      setNotice(safeMessage(cause, t('catalogUnavailable')));
    }
    finally { setSyncing(false); }
  };

  const completionLabel = (status: ReturnType<typeof profileCompletion>['status']) => status === 'Available metadata' ? t('profileReady') : status === 'Incomplete' ? t('profileIncomplete') : t('profileOff');
  const editorForm = draft ? <form className="provider-editor panel" onSubmit={(event) => { event.preventDefault(); save(); }}>
    <div className="panel-heading"><div><span className="eyebrow">{editor.mode === 'creating' ? t('newProfile') : t('editProfile')}</span><h2 id={editor.mode === 'creating' ? 'provider-dialog-title' : undefined}>{draft.name || t('untitledProvider')}</h2></div><span className="badge badge-neutral">{completionLabel(profileCompletion({ ...draft, updatedAt: new Date(0).toISOString() }).status)}</span></div>
    <div className="form-grid">
      <div className="field field-wide combobox-field">
        <span>{t('provider')}</span>
        <div className="combobox-control">
          <input ref={providerInputRef} role="combobox" aria-label={t('providerSearch')} aria-controls="provider-options" aria-expanded={providerOpen} aria-autocomplete="list" value={providerQuery} onChange={(event) => { setProviderQuery(event.target.value); setProviderOpen(true); }} onFocus={() => setProviderOpen(true)} onBlur={() => setProviderOpen(false)} onKeyDown={(event) => keyboard(event, providers, providerIndex, setProviderIndex, selectProvider, () => { if (!providerOpen) return false; setProviderOpen(false); return true; })} placeholder={t('searchProviders')} />
          <span className="combobox-chevron" aria-hidden="true">▾</span>
        </div>
        <div id="provider-options" role="listbox" className="catalog-options" hidden={!providerOpen} onMouseDown={(event) => event.preventDefault()}>
          {providerLoading && <p className="catalog-empty">{t('loading')}</p>}
          {!providerLoading && providers.length === 0 && <p className="catalog-empty">{t('noProviders')}</p>}
          {providers.map((provider, index) => <button role="option" aria-selected={index === providerIndex} type="button" key={provider.providerId} onClick={() => selectProvider(provider)}>{provider.name}<small>{provider.providerId}</small></button>)}
        </div>
      </div>
      <label className="field field-wide"><span>{t('displayName')}</span><input aria-label={t('displayName')} value={draft.name} onChange={(event) => update({ name: event.target.value }, true)} placeholder={t('providerNamePlaceholder')} /></label>
      <div className="field field-wide combobox-field">
        <span>{t('model')}</span>
        <div className="combobox-control">
          <input role="combobox" aria-label={t('modelSearch')} aria-controls="model-options" aria-expanded={modelOpen && Boolean(draft.providerId)} aria-autocomplete="list" disabled={!draft.providerId} value={modelQuery} onChange={(event) => { setModelQuery(event.target.value); setModelOpen(true); }} onFocus={() => setModelOpen(true)} onBlur={() => setModelOpen(false)} onKeyDown={(event) => keyboard(event, models, modelIndex, setModelIndex, selectModel, () => { if (!modelOpen) return false; setModelOpen(false); return true; })} placeholder={t('selectModel')} />
          <span className="combobox-chevron" aria-hidden="true">▾</span>
        </div>
        <div id="model-options" role="listbox" className="catalog-options" hidden={!modelOpen || !draft.providerId} onMouseDown={(event) => event.preventDefault()}>
          {modelLoading && <p className="catalog-empty">{t('loading')}</p>}
          {!modelLoading && models.length === 0 && <p className="catalog-empty">{t('noModels')}</p>}
          {models.map((model, index) => <button role="option" aria-selected={index === modelIndex} type="button" key={model.modelId} onClick={() => selectModel(model)}>{model.name}<small>{model.modelId} · {model.status}</small></button>)}
        </div>
      </div>
      <label className="field"><span>{t('adapterKind')}</span><select value={draft.adapterKind} onChange={(event) => update({ adapterKind: event.target.value as AdapterKind })}><option value="unassigned">{t('unassignedMetadata')}</option><option value="openai-compatible">{t('openAiCompatible')}</option><option value="anthropic">{t('anthropic')}</option></select></label>
      <label className="field"><span>{t('baseUrl')}</span><input ref={baseUrlRef} value={draft.baseUrl ?? ''} onChange={(event) => event.target.value ? update({ baseUrl: event.target.value, baseUrlSource: 'manual' as BaseUrlSource }) : update({ baseUrlSource: 'none' }, false, ['baseUrl'])} placeholder={t('baseUrlPlaceholder')} /><small>{t('sourceNote', { source: draft.baseUrlSource })}</small></label>
      <label className="field field-wide"><span>{t('apiKey')}</span><input type="password" autoComplete="off" value={draft.apiKey} onChange={(event) => update({ apiKey: event.target.value })} placeholder={draft.id && session() && secretPresent(session()!, draft.id) ? t('configuredThisTab') : t('notConfiguredThisTab')} /></label>
      <label className="toggle-field field-wide"><input type="checkbox" checked={draft.enabled} onChange={(event) => update({ enabled: event.target.checked })} /><span><strong>{t('availableMetadata')}</strong><small>{t('doesNotMean')}</small></span></label>
    </div>
    <footer className="form-actions"><button className="button button-secondary" type="button" onClick={() => { setEditor({ mode: 'idle' }); setNotice(undefined); }}>{t('cancel')}</button><button className="button button-primary" disabled={editor.mode === 'saving'} type="submit">{editor.mode === 'saving' ? t('saving') : t('saveProfile')}</button></footer>
  </form> : null;

  const catalogLabel = catalog?.availability === 'available' ? t('catalogAvailable') : catalog?.availability === 'stale' ? t('catalogStale') : t('catalogUnavailable');
  return <section className="workspace-page providers-page">
    <header className="page-heading"><div><p className="eyebrow">{t('workspaceSettings')}</p><h1>{t('providers')}</h1><p className="page-subtitle">{t('providersSubtitle')}</p></div><button ref={addButtonRef} className="button button-secondary" type="button" onClick={createProfile}>{t('addProvider')}</button></header>
    <section className="panel system-runtime" aria-label={t('systemRuntime')}><div><p className="eyebrow">{t('systemRuntime')}</p><h2>{t('localPiHarness')}</h2><small>{t('readOnlyExecution')}</small></div><span className="badge badge-success">{t('inUse')}</span></section>
    <section className="panel system-runtime" aria-label={t('runAgent')}>
      <div>
        <p className="eyebrow">{t('workspaceSettings')}</p>
        <h2>{t('runAgent')}</h2>
        <small>{t('runAgentSubtitle')}</small>
        <label className="field" style={{ maxWidth: 420, marginTop: 12 }}>
          <span>{t('defaultProviderLabel')}</span>
          <select aria-label={t('defaultProviderLabel')} value={runAgent?.defaultProvider === 'connection' ? `connection:${runAgent.providerConnectionId ?? ''}` : 'echo'} disabled={runAgentSaving || runAgent === undefined} onChange={(event) => void saveRunAgent(event.target.value)}>
            <option value="echo">{t('providerOptionEcho')}</option>
            {(runAgent?.providers ?? []).map((provider) => (
              <option key={provider.id} value={`connection:${provider.id}`}>{t('providerOptionConnection', { name: provider.name ?? provider.id })}</option>
            ))}
          </select>
        </label>
      </div>
      {runAgent && (() => {
        const connection = connectionStatusIn(runAgent);
        if (connection !== undefined) {
          return <span className={connection.available ? 'badge badge-success' : 'badge badge-warning'}>
            {connection.available ? t('connectionReady', { name: connection.name }) : t('connectionUnavailable', { name: connection.name })}
          </span>;
        }
        return anyAvailableIn(runAgent)
          ? <span className="badge">{t('offlineModeActive')}</span>
          : <span className="badge badge-warning">{t('noUsableWorkspaceProvider')}</span>;
      })()}
    </section>
    <WorkspaceProvidersCard fetcher={fetcher} onNotice={setNotice} />
    <div className="catalog-state-row"><p className="catalog-state" role="status">{catalogLabel}{catalog?.lastCheckedAt ? ` · ${t('checked', { value: formatDateTime(catalog.lastCheckedAt) })}` : ''}</p><button className="button button-secondary" type="button" disabled={syncing} onClick={() => void syncCatalog()}>{syncing ? t('syncing') : t('syncCatalog')}</button></div>
    {notice && <div className="inline-notice" role="status">{notice}</div>}
    <div className="provider-layout"><aside className="provider-list panel" aria-label={t('externalProfiles')}><div className="panel-heading"><div><span className="eyebrow">{t('externalProfiles')}</span><h2>{t('configured', { count: profiles.length })}</h2></div></div><div className="profile-stack">{profiles.map((profile) => { const completion = profileCompletion(profile); const state = connectionStates[profile.id] ?? 'idle'; const stateLabel = state === 'checking' ? t('checking') : state === 'connected' ? t('connected') : state === 'unauthorized' ? t('unauthorized') : state === 'unavailable' ? t('profileUnavailable') : t('check'); return <div className={`profile-card ${editor.mode === 'editing' && editor.profileId === profile.id ? 'is-active' : ''}`} role="button" tabIndex={0} key={profile.id} onClick={() => edit(profile)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); edit(profile); } }}><span className="provider-mark">◇</span><span className="profile-card-copy"><strong>{profile.name}</strong><small>{profile.providerName ?? t('providerUnassigned')} · {profile.modelName ?? t('modelUnassigned')}</small></span><span className={`profile-state ${completion.status === 'Available metadata' ? 'profile-state-on' : ''}`}>{completion.status === 'Available metadata' ? t('profileReady') : completion.status === 'Incomplete' ? t('profileIncomplete') : t('profileOff')}</span><button className={`icon-button connection-check-button connection-check-${state}`} type="button" aria-label={t('checkConnection', { name: profile.name })} title={stateLabel} disabled={state === 'checking'} onClick={(event) => { event.stopPropagation(); void checkConnection(profile); }}>{state === 'checking' ? '…' : state === 'connected' ? '✓' : state === 'unauthorized' ? '!' : state === 'unavailable' ? '×' : '↻'}</button></div>; })}</div>{profiles.length === 0 && <p className="muted-copy">{t('noExternalProfiles')}</p>}<div className="info-callout"><strong>{t('runtimeBoundary')}</strong><span>{t('profilesNeverEnter')}</span></div></aside>
      {editor.mode === 'idle' ? <section className="provider-editor panel empty-panel"><h3>{t('selectOrAdd')}</h3><p>{t('localPiOnly')}</p></section> : editor.mode === 'creating' ? <div className="provider-modal-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) { setEditor({ mode: 'idle' }); setNotice(undefined); } }}><div className="provider-modal" role="dialog" aria-modal="true" aria-labelledby="provider-dialog-title" onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setEditor({ mode: 'idle' }); setNotice(undefined); } }}>{editorForm}</div></div> : editorForm}
    </div>
  </section>;
}
