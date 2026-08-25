import { useCallback, useEffect, useState } from 'react';
import { useLocale } from './locale.js';
import { WorkspaceProvidersCard, type WorkspaceProviderView } from './workspace-providers.js';

/** GET/PUT /v1/run-agent/settings 的视图模型：默认模型（providerConnectionId 引用）+ 注册表条目可用性（不含任何密钥）。 */
interface RunAgentSettingsView {
  readonly unset: boolean;
  readonly providerConnectionId?: string;
  readonly providers?: ReadonlyArray<{ readonly id: string; readonly name?: string; readonly available: boolean; readonly reason?: string }>;
}

export function ProvidersApp({ fetcher = fetch }: { readonly fetcher?: typeof fetch }): React.JSX.Element {
  const { t } = useLocale();
  const [runAgent, setRunAgent] = useState<RunAgentSettingsView>();
  const [runAgentSaving, setRunAgentSaving] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();
  const [connections, setConnections] = useState<readonly WorkspaceProviderView[]>([]);
  const [connectionsLoaded, setConnectionsLoaded] = useState(false);

  useEffect(() => { void fetcher('/v1/run-agent/settings', { credentials: 'include' }).then(async (response) => {
    if (!response.ok) throw new Error(`Run agent settings ${response.status}`);
    setRunAgent(await response.json() as RunAgentSettingsView);
  }).catch((cause) => setNotice(cause instanceof Error ? cause.message : t('runAgentUnavailable'))); }, [fetcher, t]);

  const reloadConnections = useCallback((): Promise<void> => fetcher('/v1/provider-connections', { credentials: 'include' }).then(async (response) => {
    if (!response.ok) throw new Error(`Provider connections ${response.status}`);
    const body = await response.json() as { connections: readonly WorkspaceProviderView[] };
    setConnections(body.connections);
  }).catch((cause) => {
    setNotice(cause instanceof Error ? cause.message : t('workspaceProvidersUnavailable'));
  }).finally(() => setConnectionsLoaded(true)), [fetcher, t]);

  useEffect(() => { void reloadConnections(); }, [reloadConnections]);

  const saveRunAgent = async (selection: string) => {
    if (runAgentSaving || selection === '') return;
    setRunAgentSaving(true);
    try {
      const response = await fetcher('/v1/run-agent/settings', {
        method: 'PUT', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ providerConnectionId: selection })
      });
      if (!response.ok) throw new Error(`Run agent settings ${response.status}`);
      setRunAgent(await response.json() as RunAgentSettingsView);
      setNotice(t('runAgentSaved'));
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : t('runAgentSaveFailed'));
    } finally {
      setRunAgentSaving(false);
    }
  };

  const selected = runAgent?.providers?.find((provider) => provider.id === runAgent.providerConnectionId);
  const modelLabel = (id: string, name: string | undefined): string => {
    const connection = connections.find((entry) => entry.id === id);
    const model = connection?.modelName ?? connection?.modelId;
    return `${name ?? id}${model === undefined ? '' : ` · ${model}`}`;
  };

  return <section className="workspace-page providers-page">
    <header className="page-heading"><div><p className="eyebrow">{t('workspaceSettings')}</p><h1>{t('providers')}</h1><p className="page-subtitle">{t('providersSubtitleUnified')}</p></div></header>
    <section className="panel system-runtime" aria-label={t('runAgent')}>
      <div>
        <p className="eyebrow">{t('workspaceSettings')}</p>
        <h2>{t('runAgent')}</h2>
        <small>{t('runAgentSubtitle')}</small>
        <label className="field" style={{ maxWidth: 420, marginTop: 12 }}>
          <span>{t('defaultModelLabel')}</span>
          <select aria-label={t('defaultModelLabel')} value={runAgent?.providerConnectionId ?? ''} disabled={runAgentSaving || runAgent === undefined} onChange={(event) => void saveRunAgent(event.target.value)}>
            <option value="">{t('runAgentUnset')}</option>
            {(runAgent?.providers ?? []).map((provider) => (
              <option key={provider.id} value={provider.id}>{`${modelLabel(provider.id, provider.name)}${provider.available ? '' : ` · ${t('workspaceProviderUnavailableOption')}`}`}</option>
            ))}
          </select>
        </label>
      </div>
      {(() => {
        if (runAgent === undefined || runAgent.unset) {
          return <span className="badge badge-warning">{t('runAgentUnsetWarning')}</span>;
        }
        return selected !== undefined
          ? <span className={selected.available ? 'badge badge-success' : 'badge badge-warning'}>
              {selected.available ? t('connectionReady', { name: selected.name ?? selected.id }) : t('connectionUnavailable', { name: selected.name ?? selected.id })}
            </span>
          : <span className="badge badge-warning">{t('connectionUnavailable', { name: runAgent.providerConnectionId ?? '' })}</span>;
      })()}
    </section>
    <WorkspaceProvidersCard fetcher={fetcher} connections={connections} connectionsLoaded={connectionsLoaded} onConnectionsChanged={() => void reloadConnections()} onNotice={setNotice} />
    {notice && <div className="inline-notice" role="status">{notice}</div>}
  </section>;
}
