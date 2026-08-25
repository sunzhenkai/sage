import { useEffect, useState } from 'react';
import { useLocale } from './locale.js';
import { WorkspaceProvidersCard } from './workspace-providers.js';

/** GET/PUT /v1/run-agent/settings 的视图模型：必选 provider + 注册表条目可用性（不含任何密钥）。 */
interface RunAgentSettingsView {
  readonly unset: boolean;
  readonly providerConnectionId?: string;
  readonly providers?: ReadonlyArray<{ readonly id: string; readonly name?: string; readonly available: boolean; readonly reason?: string }>;
}

const LEGACY_PROFILE_KEYS = ['sage.provider-profiles.v2', 'sage.provider-profiles.v1'] as const;
const LEGACY_PROFILE_DISMISSED_KEY = 'sage.provider-profiles.deprecated.v1';

export function ProvidersApp({ fetcher = fetch }: { readonly fetcher?: typeof fetch }): React.JSX.Element {
  const { t } = useLocale();
  const [runAgent, setRunAgent] = useState<RunAgentSettingsView>();
  const [runAgentSaving, setRunAgentSaving] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();
  const [legacyProfiles, setLegacyProfiles] = useState(false);

  useEffect(() => { void fetcher('/v1/run-agent/settings', { credentials: 'include' }).then(async (response) => {
    if (!response.ok) throw new Error(`Run agent settings ${response.status}`);
    setRunAgent(await response.json() as RunAgentSettingsView);
  }).catch((cause) => setNotice(cause instanceof Error ? cause.message : t('runAgentUnavailable'))); }, [fetcher, t]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storage = window.localStorage;
    if (storage.getItem(LEGACY_PROFILE_DISMISSED_KEY) === '1') return;
    if (LEGACY_PROFILE_KEYS.some((key) => storage.getItem(key) !== null)) setLegacyProfiles(true);
  }, []);

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

  const dismissLegacyProfiles = () => {
    if (typeof window !== 'undefined') window.localStorage.setItem(LEGACY_PROFILE_DISMISSED_KEY, '1');
    setLegacyProfiles(false);
  };

  const selected = runAgent?.providers?.find((provider) => provider.id === runAgent.providerConnectionId);

  return <section className="workspace-page providers-page">
    <header className="page-heading"><div><p className="eyebrow">{t('workspaceSettings')}</p><h1>{t('providers')}</h1><p className="page-subtitle">{t('providersSubtitleUnified')}</p></div></header>
    {legacyProfiles && <div className="inline-notice" role="status">
      <strong>{t('legacyProfilesTitle')}</strong>
      <p>{t('legacyProfilesNotice')}</p>
      <button className="button button-secondary" type="button" onClick={dismissLegacyProfiles}>{t('dismissNoticeText')}</button>
    </div>}
    <section className="panel system-runtime" aria-label={t('runAgent')}>
      <div>
        <p className="eyebrow">{t('workspaceSettings')}</p>
        <h2>{t('runAgent')}</h2>
        <small>{t('runAgentSubtitle')}</small>
        <label className="field" style={{ maxWidth: 420, marginTop: 12 }}>
          <span>{t('defaultProviderLabel')}</span>
          <select aria-label={t('defaultProviderLabel')} value={runAgent?.providerConnectionId ?? ''} disabled={runAgentSaving || runAgent === undefined} onChange={(event) => void saveRunAgent(event.target.value)}>
            <option value="">{t('runAgentUnset')}</option>
            {(runAgent?.providers ?? []).map((provider) => (
              <option key={provider.id} value={provider.id}>{provider.name ?? provider.id}{provider.available ? '' : ` · ${t('workspaceProviderUnavailableOption')}`}</option>
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
    <WorkspaceProvidersCard fetcher={fetcher} onNotice={setNotice} />
    {notice && <div className="inline-notice" role="status">{notice}</div>}
  </section>;
}
