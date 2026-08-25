import { useEffect, useState } from 'react';
import { useLocale } from './locale.js';

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
}

const emptyDraft: WorkspaceProviderDraft = { name: '', adapterKind: 'anthropic', baseUrl: '', modelId: '', apiKey: '' };

export function WorkspaceProvidersCard({ fetcher, onNotice }: {
  readonly fetcher: typeof fetch;
  readonly onNotice: (message: string | undefined) => void;
}): React.JSX.Element {
  const { t } = useLocale();
  const [connections, setConnections] = useState<readonly WorkspaceProviderView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<WorkspaceProviderDraft | undefined>();
  const [saving, setSaving] = useState(false);

  const reload = (): Promise<void> => fetcher('/v1/provider-connections', { credentials: 'include' }).then(async (response) => {
    if (!response.ok) throw new Error(`Provider connections ${response.status}`);
    const body = await response.json() as { connections: readonly WorkspaceProviderView[] };
    setConnections(body.connections);
  }).catch((cause: unknown) => {
    onNotice(cause instanceof Error ? cause.message : t('workspaceProvidersUnavailable'));
  });

  useEffect(() => { void reload().finally(() => setLoaded(true)); }, [fetcher]);

  const startCreate = () => { setDraft({ ...emptyDraft }); onNotice(undefined); };
  const startEdit = (connection: WorkspaceProviderView) => {
    setDraft({
      id: connection.id, name: connection.name, adapterKind: connection.adapterKind,
      baseUrl: connection.baseUrl, modelId: connection.modelId, apiKey: ''
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
        name: draft.name.trim(), adapterKind: draft.adapterKind, baseUrl: draft.baseUrl.trim(), modelId: draft.modelId.trim()
      };
      if (draft.apiKey !== '') payload.apiKey = draft.apiKey;
      const response = draft.id === undefined
        ? await fetcher('/v1/provider-connections', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
        : await fetcher(`/v1/provider-connections/${encodeURIComponent(draft.id)}`, { method: 'PUT', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => undefined) as { error?: { message?: string } } | undefined;
      if (!response.ok) throw new Error(body?.error?.message ?? `Provider connection ${response.status}`);
      setDraft(undefined);
      onNotice(t('workspaceProviderSaved'));
      await reload();
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
      await reload();
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
      {loaded && connections.length === 0 && <p className="muted-copy">{t('noWorkspaceProviders')}</p>}
      {draft === undefined
        ? <button className="button button-secondary" type="button" onClick={startCreate}>{t('addWorkspaceProvider')}</button>
        : <form className="workspace-provider-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <label className="field"><span>{t('displayName')}</span>
            <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
          <label className="field"><span>{t('adapterKind')}</span>
            <select value={draft.adapterKind} onChange={(event) => setDraft({ ...draft, adapterKind: event.target.value as WorkspaceProviderDraft['adapterKind'] })}>
              <option value="anthropic">{t('anthropic')}</option>
              <option value="openai-compatible">{t('openAiCompatible')}</option>
            </select></label>
          <label className="field"><span>{t('baseUrl')}</span>
            <input value={draft.baseUrl} placeholder="https://api.example.com" onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} /></label>
          <label className="field"><span>{t('model')}</span>
            <input value={draft.modelId} onChange={(event) => setDraft({ ...draft, modelId: event.target.value })} /></label>
          <label className="field field-wide"><span>{t('apiKeyServer')}</span>
            <input type="password" value={draft.apiKey} placeholder={draft.id === undefined ? t('apiKeyRequiredPlaceholder') : t('apiKeyRotatePlaceholder')} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} /></label>
          <div className="form-actions">
            <button className="button" type="submit" disabled={saving}>{saving ? t('saving') : t('saveWorkspaceProvider')}</button>
            <button className="button button-secondary" type="button" onClick={() => setDraft(undefined)}>{t('cancel')}</button>
          </div>
        </form>}
    </div>
  </section>;
}
