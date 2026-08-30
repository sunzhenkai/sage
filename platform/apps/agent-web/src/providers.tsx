import { useCallback, useEffect, useState } from 'react';
import { useLocale } from './locale.js';
import { SelectField } from './fields.js';
import { InlineNotice } from './feedback.js';
import { WorkspaceProvidersCard, type WorkspaceProviderView } from './workspace-providers.js';

/** GET/PUT /v1/run-agent/settings 的视图模型：默认模型（providerConnectionId 引用）+ 注册表条目可用性（不含任何密钥）。 */
interface RunAgentSettingsView {
  readonly unset: boolean;
  readonly providerConnectionId?: string;
  readonly providers?: ReadonlyArray<{ readonly id: string; readonly name?: string; readonly available: boolean; readonly reason?: string }>;
}

export function ProvidersApp({ fetcher = fetch }: { readonly fetcher?: typeof fetch }): React.JSX.Element {
  const { locale, setLocale, t } = useLocale();
  const [runAgent, setRunAgent] = useState<RunAgentSettingsView>();
  const [runAgentSaving, setRunAgentSaving] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();
  const [connections, setConnections] = useState<readonly WorkspaceProviderView[]>([]);
  const [connectionsLoaded, setConnectionsLoaded] = useState(false);
  // 设置子导航的当前位置：锚点跳转不触发路由，active 态由点击显式登记。
  const [activeSection, setActiveSection] = useState('providers-run-agent');
  const navItem = (section: string) => ({
    className: activeSection === section ? 'is-active' : undefined,
    ...(activeSection === section ? { 'aria-current': 'location' as const } : {}),
    onClick: () => setActiveSection(section)
  });

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

  return <section className="workspace-page providers-page" aria-label={t('providers')}>
    <header className="page-heading"><h1>{t('providers')}</h1></header>
    {notice && <InlineNotice>{notice}</InlineNotice>}
    <div className="settings-layout">
      <nav className="settings-nav" aria-label={t('configuration')}>
        <a href="#providers-run-agent" {...navItem('providers-run-agent')}>{t('runAgent')}</a>
        <a href="#providers-connections" {...navItem('providers-connections')}>{t('workspaceProviders')}</a>
        <a href="#providers-preferences" {...navItem('providers-preferences')}>{t('language')}</a>
      </nav>
      <div className="settings-content">
        <section id="providers-run-agent" className="panel system-runtime" aria-label={t('runAgent')}>
          <div>
            <h2>{t('runAgent')}</h2>
            <SelectField className="field-standalone" label={t('defaultModelLabel')} value={runAgent?.providerConnectionId ?? ''} disabled={runAgentSaving || runAgent === undefined} onChange={(value) => void saveRunAgent(value)}>
              <option value="">{t('runAgentUnset')}</option>
              {(runAgent?.providers ?? []).map((provider) => (
                <option key={provider.id} value={provider.id}>{`${modelLabel(provider.id, provider.name)}${provider.available ? '' : ` · ${t('workspaceProviderUnavailableOption')}`}`}</option>
              ))}
            </SelectField>
          </div>
          {(() => {
            if (runAgent === undefined || runAgent.unset) {
              return <span className="badge badge-warning">{t('runAgentUnsetWarning')}</span>;
            }
            // badge 在卡片内容盒内省略时，title 保留完整状态文案
            return selected !== undefined
              ? <span className={selected.available ? 'badge badge-success' : 'badge badge-warning'} title={selected.available ? t('connectionReady', { name: selected.name ?? selected.id }) : t('connectionUnavailable', { name: selected.name ?? selected.id })}>
                  {selected.available ? t('connectionReady', { name: selected.name ?? selected.id }) : t('connectionUnavailable', { name: selected.name ?? selected.id })}
                </span>
              : <span className="badge badge-warning" title={t('connectionUnavailable', { name: runAgent.providerConnectionId ?? '' })}>{t('connectionUnavailable', { name: runAgent.providerConnectionId ?? '' })}</span>;
          })()}
        </section>
        <section id="providers-connections">
          <WorkspaceProvidersCard fetcher={fetcher} connections={connections} connectionsLoaded={connectionsLoaded} {...(runAgent?.providerConnectionId === undefined ? {} : { defaultConnectionId: runAgent.providerConnectionId })} onConnectionsChanged={() => void reloadConnections()} onNotice={setNotice} />
        </section>
        <section id="providers-preferences" className="panel preferences-card" aria-label={t('language')}>
          <h2>{t('language')}</h2>
          <label className="locale-control"><span className="locale-copy">{t('language')}</span><select aria-label={t('languageSwitcher')} value={locale} onChange={(event) => setLocale(event.target.value as 'zh-CN' | 'en')}><option value="zh-CN">{t('chinese')}</option><option value="en">{t('english')}</option></select></label>
        </section>
      </div>
    </div>
  </section>;
}
