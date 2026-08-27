import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ModelCatalogItem, ModelCatalogPage, ProviderCatalogItem, ProviderCatalogPage } from '@sage/app-contracts';
import { useLocale } from './locale.js';
import { SelectField, TextField } from './fields.js';
import { InlineNotice } from './feedback.js';

/** GET/POST/PUT/DELETE /v1/provider-connections 的视图模型：元数据 + 凭据在场布尔，永不携带密文或 key。 */
export interface WorkspaceProviderView {
  readonly id: string;
  readonly name: string;
  readonly source: 'user' | 'deployment-env';
  readonly adapterKind: 'openai-compatible' | 'anthropic';
  readonly baseUrl: string;
  readonly modelId: string;
  readonly providerName?: string;
  readonly modelName?: string;
  readonly enabled: boolean;
  readonly credentialPresent: boolean;
}

interface WorkspaceProviderDraft {
  readonly id?: string;
  readonly name: string;
  readonly adapterKind: 'openai-compatible' | 'anthropic';
  readonly baseUrl: string;
  readonly modelId: string;
  readonly apiKey: string;
  readonly providerName?: string;
  readonly modelName?: string;
}

const emptyDraft: WorkspaceProviderDraft = { name: '', adapterKind: 'openai-compatible', baseUrl: '', modelId: '', apiKey: '' };
/** Catalog 无协议字段：中性的 adapter 缺省（纯 UI 缺省，可改写，不进入任何服务端路由逻辑）。 */
const defaultAdapterKind = (providerId: string): WorkspaceProviderDraft['adapterKind'] => providerId === 'anthropic' ? 'anthropic' : 'openai-compatible';

export function WorkspaceProvidersCard({ fetcher, connections, connectionsLoaded, onConnectionsChanged, onNotice }: {
  readonly fetcher: typeof fetch;
  readonly connections: readonly WorkspaceProviderView[];
  readonly connectionsLoaded: boolean;
  readonly onConnectionsChanged: () => void;
  readonly onNotice: (message: string | undefined) => void;
}): React.JSX.Element {
  const { t } = useLocale();
  const [draft, setDraft] = useState<WorkspaceProviderDraft | undefined>();
  const [saving, setSaving] = useState(false);

  const startCreate = () => { setDraft({ ...emptyDraft }); onNotice(undefined); };
  const startEdit = (connection: WorkspaceProviderView) => {
    setDraft({
      id: connection.id, name: connection.name, adapterKind: connection.adapterKind,
      baseUrl: connection.baseUrl, modelId: connection.modelId, apiKey: '',
      ...(connection.providerName === undefined ? {} : { providerName: connection.providerName }),
      ...(connection.modelName === undefined ? {} : { modelName: connection.modelName })
    });
    onNotice(undefined);
  };

  const save = async () => {
    if (draft === undefined || saving) return;
    if (!draft.name.trim() || !draft.baseUrl.trim() || !draft.modelId.trim() || (!draft.id && !draft.apiKey)) {
      onNotice(t('workspaceProviderRequired'));
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: draft.name.trim(), adapterKind: draft.adapterKind, baseUrl: draft.baseUrl.trim(), modelId: draft.modelId.trim(),
        ...(draft.providerName === undefined || draft.providerName.trim() === '' ? {} : { providerName: draft.providerName.trim() }),
        ...(draft.modelName === undefined || draft.modelName.trim() === '' ? {} : { modelName: draft.modelName.trim() })
      };
      if (draft.apiKey !== '') payload.apiKey = draft.apiKey;
      const response = draft.id === undefined
        ? await fetcher('/v1/provider-connections', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
        : await fetcher(`/v1/provider-connections/${encodeURIComponent(draft.id)}`, { method: 'PUT', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => undefined) as { error?: { message?: string } } | undefined;
      if (!response.ok) throw new Error(body?.error?.message ?? `Provider connection ${response.status}`);
      setDraft(undefined);
      onNotice(t('workspaceProviderSaved'));
      onConnectionsChanged();
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : t('workspaceProviderSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (connection: WorkspaceProviderView) => {
    if (saving) return;
    setSaving(true);
    try {
      const response = await fetcher(`/v1/provider-connections/${encodeURIComponent(connection.id)}`, { method: 'DELETE', credentials: 'include' });
      const body = await response.json().catch(() => undefined) as { error?: { message?: string } } | undefined;
      if (!response.ok) throw new Error(body?.error?.message ?? `Provider connection ${response.status}`);
      onNotice(t('workspaceProviderDeleted'));
      onConnectionsChanged();
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : t('workspaceProviderDeleteFailed'));
    } finally {
      setSaving(false);
    }
  };

  return <section className="panel system-runtime workspace-providers" aria-label={t('workspaceProviders')}>
    <div>
      <p className="eyebrow">{t('workspaceSettings')}</p>
      <h2>{t('workspaceProviders')}</h2>
      <small>{t('workspaceProvidersSubtitle')}</small>
      <div className="profile-stack">
        {connections.map((connection) => <div className="profile-card" key={connection.id}>
          <span className="provider-mark">{connection.source === 'deployment-env' ? '⚙' : '◆'}</span>
          <span className="profile-card-copy">
            <strong>{connection.name}</strong>
            <small>
              {connection.providerName ?? connection.name} · {connection.modelName ?? connection.modelId}
              {' · '}
              {connection.source === 'deployment-env' ? t('sourceDeploymentEnv') : t('sourceUser')}
            </small>
          </span>
          <span className={`profile-state ${connection.credentialPresent ? 'profile-state-on' : ''}`}>
            {connection.credentialPresent ? t('credentialPresent') : t('credentialMissing')}
          </span>
          {connection.source === 'user' && <>
            <button className="icon-button" type="button" aria-label={t('editWorkspaceProvider', { name: connection.name })} onClick={() => startEdit(connection)}>✎</button>
            <button className="icon-button" type="button" aria-label={t('deleteWorkspaceProvider', { name: connection.name })} disabled={saving} onClick={() => void remove(connection)}>✕</button>
          </>}
        </div>)}
      </div>
      {connectionsLoaded && connections.length === 0 && <p className="muted-copy">{t('noWorkspaceProviders')}</p>}
      <div className="panel-actions">
        <button className="button button-secondary" type="button" onClick={startCreate}>{t('addWorkspaceProvider')}</button>
      </div>
      {draft !== undefined && <WorkspaceProviderDialog
        fetcher={fetcher} draft={draft} saving={saving}
        onDraftChange={setDraft} onSubmit={() => void save()} onClose={() => setDraft(undefined)}
      />}
    </div>
  </section>;
}

type CatalogAvailability = 'loading' | 'available' | 'unavailable';

/** 添加/编辑工作区 provider 的 modal：Catalog（models.dev 快照）辅助选择 provider/model 并预填，目录不可用时降级手工录入。 */
function WorkspaceProviderDialog({ fetcher, draft, saving, onDraftChange, onSubmit, onClose }: {
  readonly fetcher: typeof fetch;
  readonly draft: WorkspaceProviderDraft;
  readonly saving: boolean;
  readonly onDraftChange: (draft: WorkspaceProviderDraft) => void;
  readonly onSubmit: () => void;
  readonly onClose: () => void;
}): React.JSX.Element {
  const { t } = useLocale();
  const [catalog, setCatalog] = useState<CatalogAvailability>('loading');
  const [snapshotChanged, setSnapshotChanged] = useState(false);
  const [providers, setProviders] = useState<readonly ProviderCatalogItem[]>([]);
  const [providerNextCursor, setProviderNextCursor] = useState<string>();
  const [providerQuery, setProviderQuery] = useState(draft.id === undefined ? '' : draft.providerName ?? '');
  const [providerOpen, setProviderOpen] = useState(false);
  const [providerIndex, setProviderIndex] = useState(0);
  const [providerLoading, setProviderLoading] = useState(false);
  const [providerReloadToken, setProviderReloadToken] = useState(0);
  const [selectedProviderId, setSelectedProviderId] = useState<string>();
  const [models, setModels] = useState<readonly ModelCatalogItem[]>([]);
  const [modelNextCursor, setModelNextCursor] = useState<string>();
  const [modelQuery, setModelQuery] = useState(draft.id === undefined ? '' : draft.modelName ?? '');
  const [modelOpen, setModelOpen] = useState(false);
  const [modelIndex, setModelIndex] = useState(0);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelReloadToken, setModelReloadToken] = useState(0);
  const nameDirty = useRef(draft.id !== undefined);
  const adapterDirty = useRef(draft.id !== undefined);
  const baseUrlDirty = useRef(draft.id !== undefined);
  const providerToken = useRef(0);
  const modelToken = useRef(0);
  const [syncing, setSyncing] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<string | undefined>();

  const patch = (changes: Partial<WorkspaceProviderDraft>) => onDraftChange({ ...draft, ...changes });

  const selectProvider = (provider: ProviderCatalogItem) => {
    setSelectedProviderId(provider.providerId);
    setModels([]); setModelNextCursor(undefined); setModelQuery(''); setModelIndex(0);
    patch({
      ...(adapterDirty.current ? {} : { adapterKind: defaultAdapterKind(provider.providerId) }),
      providerName: provider.name,
      ...(nameDirty.current ? {} : { name: provider.name })
    });
    setProviderQuery(provider.name);
    setProviderOpen(false); setModelOpen(true);
  };

  const selectModel = (model: ModelCatalogItem) => {
    const provider = providers.find((item) => item.providerId === model.providerId);
    patch({
      modelId: model.modelId,
      modelName: model.name,
      ...(baseUrlDirty.current ? {} : { baseUrl: model.effectiveBaseUrl ?? '' }),
      ...(nameDirty.current ? {} : { name: provider === undefined ? model.modelId : `${provider.name} · ${model.name}` })
    });
    setModelQuery(model.name);
    setModelOpen(false);
  };

  /** 手动刷新目录：触发 manual sync，轮询 attempt 至终态后从最新快照重载列表第一页；限流/授权/失败以稳定文案提示，不自动重试。 */
  const refreshCatalog = async () => {
    if (syncing) return;
    setSyncing(true);
    setRefreshNotice(undefined);
    try {
      const response = await fetcher('/v1/provider-catalog/sync', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: '{}' });
      const body = await response.json().catch(() => undefined) as { attemptId?: string; error?: { code?: string; message?: string; retryAfterSeconds?: number } } | undefined;
      if (response.status === 429) {
        setRefreshNotice(t('catalogSyncRateLimited', { seconds: body?.error?.retryAfterSeconds ?? 60 }));
        return;
      }
      if (response.status === 403) {
        setRefreshNotice(t('catalogSyncForbidden'));
        return;
      }
      if (!response.ok) throw new Error(body?.error?.message ?? `Catalog sync ${response.status}`);
      const attemptId = body?.attemptId;
      if (typeof attemptId === 'string' && attemptId.length > 0) {
        for (let attempt = 0; attempt < 10; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          const attemptResponse = await fetcher(`/v1/provider-catalog/sync/${encodeURIComponent(attemptId)}`, { credentials: 'include' }).catch(() => undefined);
          if (attemptResponse === undefined || !attemptResponse.ok) break;
          const attemptBody = await attemptResponse.json().catch(() => undefined) as { status?: string } | undefined;
          if (attemptBody?.status === 'succeeded' || attemptBody?.status === 'not_modified' || attemptBody?.status === 'failed' || attemptBody?.status === 'cancelled') break;
        }
      }
      setRefreshNotice(t('catalogSyncReloaded'));
      setProviderReloadToken((value) => value + 1);
      if (selectedProviderId !== undefined) setModelReloadToken((value) => value + 1);
    } catch {
      setRefreshNotice(t('catalogSyncFailed'));
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    const token = ++providerToken.current;
    const controller = new AbortController();
    setProviderLoading(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ limit: '100' });
      if (providerQuery.trim()) params.set('q', providerQuery.trim());
      void fetcher(`/v1/provider-catalog/providers?${params}`, { credentials: 'include', signal: controller.signal }).then(async (response) => {
        if (response.status === 409) { setSnapshotChanged(true); setProviderReloadToken((value) => value + 1); return; }
        if (!response.ok) throw new Error(`Catalog providers ${response.status}`);
        const page = await response.json() as ProviderCatalogPage;
        if (providerToken.current !== token || controller.signal.aborted) return;
        setCatalog('available');
        setProviders(page.items);
        setProviderNextCursor(page.nextCursor);
        setProviderIndex(0);
      }).catch(() => {
        if (controller.signal.aborted || providerToken.current !== token) return;
        setCatalog('unavailable');
      }).finally(() => { if (providerToken.current === token) setProviderLoading(false); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [providerQuery, providerReloadToken, fetcher]);

  useEffect(() => {
    if (selectedProviderId === undefined) { setModels([]); setModelNextCursor(undefined); setModelLoading(false); return; }
    const token = ++modelToken.current;
    const controller = new AbortController();
    setModelLoading(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ limit: '100', providerId: selectedProviderId, status: 'all' });
      if (modelQuery.trim()) params.set('q', modelQuery.trim());
      void fetcher(`/v1/provider-catalog/models?${params}`, { credentials: 'include', signal: controller.signal }).then(async (response) => {
        if (response.status === 409) { setSnapshotChanged(true); setModelReloadToken((value) => value + 1); return; }
        if (!response.ok) throw new Error(`Catalog models ${response.status}`);
        const page = await response.json() as ModelCatalogPage;
        if (modelToken.current !== token || controller.signal.aborted) return;
        setModels(page.items);
        setModelNextCursor(page.nextCursor);
        setModelIndex(0);
      }).catch(() => {
        if (controller.signal.aborted || modelToken.current !== token) return;
        setCatalog('unavailable');
      }).finally(() => { if (modelToken.current === token) setModelLoading(false); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [selectedProviderId, modelQuery, modelReloadToken, fetcher]);

  const loadMoreProviders = () => {
    if (providerNextCursor === undefined) return;
    const params = new URLSearchParams({ limit: '100', cursor: providerNextCursor });
    if (providerQuery.trim()) params.set('q', providerQuery.trim());
    void fetcher(`/v1/provider-catalog/providers?${params}`, { credentials: 'include' }).then(async (response) => {
      if (response.status === 409) { setSnapshotChanged(true); setProviderReloadToken((value) => value + 1); return; }
      if (!response.ok) throw new Error(`Catalog providers ${response.status}`);
      const page = await response.json() as ProviderCatalogPage;
      setProviders((current) => [...current, ...page.items.filter((item) => !current.some((existing) => existing.providerId === item.providerId))]);
      setProviderNextCursor(page.nextCursor);
    }).catch(() => setProviderNextCursor(undefined));
  };

  const loadMoreModels = () => {
    if (modelNextCursor === undefined || selectedProviderId === undefined) return;
    const params = new URLSearchParams({ limit: '100', cursor: modelNextCursor, providerId: selectedProviderId, status: 'all' });
    if (modelQuery.trim()) params.set('q', modelQuery.trim());
    void fetcher(`/v1/provider-catalog/models?${params}`, { credentials: 'include' }).then(async (response) => {
      if (response.status === 409) { setSnapshotChanged(true); setModelReloadToken((value) => value + 1); return; }
      if (!response.ok) throw new Error(`Catalog models ${response.status}`);
      const page = await response.json() as ModelCatalogPage;
      setModels((current) => [...current, ...page.items.filter((item) => !current.some((existing) => existing.modelId === item.modelId))]);
      setModelNextCursor(page.nextCursor);
    }).catch(() => setModelNextCursor(undefined));
  };

  const keyboard = <T,>(event: KeyboardEvent<HTMLInputElement>, items: readonly T[], index: number, setIndex: (value: number) => void, choose: (item: T) => void, close: () => boolean) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setIndex(Math.min(items.length - 1, index + 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setIndex(Math.max(0, index - 1)); }
    else if (event.key === 'Enter' && items[index]) { event.preventDefault(); choose(items[index]!); }
    else if (event.key === 'Escape') { event.preventDefault(); close(); }
  };

  return <div className="provider-modal-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="provider-modal" role="dialog" aria-modal="true" aria-label={draft.id === undefined ? t('providerDialogAddTitle') : t('providerDialogEditTitle')} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } }}>
      <form className="workspace-provider-form provider-editor panel" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        <div className="panel-heading">
          <div>
            <span className="eyebrow">{t('workspaceSettings')}</span>
            <h2>{draft.id === undefined ? t('providerDialogAddTitle') : t('providerDialogEditTitle')}</h2>
          </div>
        </div>
        <div className="form-grid">
          {snapshotChanged && <InlineNotice className="field-wide">{t('catalogUpdatedNotice')}</InlineNotice>}
          {refreshNotice && <InlineNotice className="field-wide">{refreshNotice}</InlineNotice>}
          {catalog === 'unavailable' && <InlineNotice className="field-wide">{t('catalogUnavailableManual')}</InlineNotice>}
          {catalog !== 'unavailable' && <>
            <div className="field field-wide combobox-field">
              <div className="catalog-refresh-row">
                <span>{t('providers')}</span>
                <button className="button button-secondary catalog-refresh-button" type="button" disabled={syncing} onClick={() => void refreshCatalog()}>{syncing ? t('catalogSyncing') : t('refreshCatalog')}</button>
              </div>
              <div className="combobox-control">
                <input role="combobox" aria-label={t('providerSearch')} aria-controls="provider-options" aria-expanded={providerOpen} aria-autocomplete="list" value={providerQuery} onChange={(event) => { setProviderQuery(event.target.value); setProviderOpen(true); }} onFocus={() => setProviderOpen(true)} onBlur={() => setProviderOpen(false)} onKeyDown={(event) => keyboard(event, providers, providerIndex, setProviderIndex, selectProvider, () => { if (!providerOpen) return false; setProviderOpen(false); return true; })} placeholder={t('searchProvidersPlaceholder')} />
                <span className="combobox-chevron" aria-hidden="true">▾</span>
              </div>
              <div id="provider-options" role="listbox" className="catalog-options" hidden={!providerOpen} onMouseDown={(event) => event.preventDefault()}>
                {providerLoading && <p className="catalog-empty">{t('loading')}</p>}
                {!providerLoading && providers.length === 0 && <p className="catalog-empty">{t('noProviders')}</p>}
                {providers.map((provider, index) => <button role="option" aria-selected={index === providerIndex} type="button" key={provider.providerId} onClick={() => selectProvider(provider)}>{provider.name}<small>{provider.providerId}</small></button>)}
                {providerNextCursor !== undefined && !providerLoading && <button type="button" className="catalog-empty" onClick={loadMoreProviders}>{t('loadMore')}</button>}
              </div>
            </div>
            <div className="field field-wide combobox-field">
              <span>{t('model')}</span>
              <div className="combobox-control">
                <input role="combobox" aria-label={t('modelSearch')} aria-controls="model-options" aria-expanded={modelOpen && selectedProviderId !== undefined} aria-autocomplete="list" disabled={selectedProviderId === undefined} value={modelQuery} onChange={(event) => { setModelQuery(event.target.value); setModelOpen(true); }} onFocus={() => setModelOpen(true)} onBlur={() => setModelOpen(false)} onKeyDown={(event) => keyboard(event, models, modelIndex, setModelIndex, selectModel, () => { if (!modelOpen) return false; setModelOpen(false); return true; })} placeholder={t('selectModelPlaceholder')} />
                <span className="combobox-chevron" aria-hidden="true">▾</span>
              </div>
              <div id="model-options" role="listbox" className="catalog-options" hidden={!modelOpen || selectedProviderId === undefined} onMouseDown={(event) => event.preventDefault()}>
                {modelLoading && <p className="catalog-empty">{t('loading')}</p>}
                {!modelLoading && models.length === 0 && <p className="catalog-empty">{t('noModels')}</p>}
                {models.map((model, index) => <button role="option" aria-selected={index === modelIndex} type="button" key={model.modelId} onClick={() => selectModel(model)}>{model.name}<small>{model.modelId} · {model.status}</small></button>)}
                {modelNextCursor !== undefined && !modelLoading && <button type="button" className="catalog-empty" onClick={loadMoreModels}>{t('loadMore')}</button>}
              </div>
            </div>
          </>}
          <TextField wide label={t('displayName')} value={draft.name} onChange={(value) => { nameDirty.current = true; patch({ name: value }); }} />
          <SelectField label={t('adapterKind')} value={draft.adapterKind} onChange={(value) => { adapterDirty.current = true; patch({ adapterKind: value as WorkspaceProviderDraft['adapterKind'] }); }}>
            <option value="anthropic">{t('anthropic')}</option>
            <option value="openai-compatible">{t('openAiCompatible')}</option>
          </SelectField>
          <TextField label={t('baseUrl')} value={draft.baseUrl} placeholder="https://api.example.com" onChange={(value) => { baseUrlDirty.current = true; patch({ baseUrl: value }); }} />
          <TextField label={t('model')} value={draft.modelId} onChange={(value) => {
            if (value === draft.modelId) { patch({}); return; }
            const { modelName: _stale, ...rest } = draft; void _stale;
            onDraftChange({ ...rest, modelId: value });
          }} />
          <TextField wide type="password" label={t('apiKeyServer')} value={draft.apiKey} placeholder={draft.id === undefined ? t('apiKeyRequiredPlaceholder') : t('apiKeyRotatePlaceholder')} onChange={(value) => patch({ apiKey: value })} />
          <div className="form-actions field-wide">
            <button className="button" type="submit" disabled={saving}>{saving ? t('saving') : t('saveWorkspaceProvider')}</button>
            <button className="button button-secondary" type="button" onClick={onClose}>{t('cancel')}</button>
          </div>
        </div>
      </form>
    </div>
  </div>;
}
