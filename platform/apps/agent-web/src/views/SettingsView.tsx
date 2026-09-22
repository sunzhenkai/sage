import { useEffect, useRef, useState, type ReactNode } from 'react'

import { useFeedback } from '../components/Feedback'
import { Badge, EmptyState, ErrorBanner, LoadingBlock, Segmented } from '../components/ui'
import { useLocale, type TranslateFn } from '../i18n'
import { toUserMessage, type ApiCtx } from '../lib/api/client'
import { getRunAgentSettings, listProviderConnections, saveRunAgentSettings } from '../lib/api/providers'
import type { ProviderAvailability, RunAgentSettingsView, WorkspaceProviderView } from '../lib/api/types'
import { workspaceHref, type SettingsTab } from '../lib/router'

import './SettingsView.css'

// 子菜单数据驱动：追加新 tab 只需在数组里加一项。
const NAV_ITEMS: ReadonlyArray<{ key: SettingsTab; labelKey: string; icon: () => ReactNode }> = [
  { key: 'general', labelKey: 'settings.nav.general', icon: SlidersIcon },
  { key: 'model', labelKey: 'settings.nav.model', icon: CpuIcon },
]

export function SettingsView({ api, tab }: { api: ApiCtx; tab: SettingsTab }) {
  const { t } = useLocale()

  return (
    <div className="view">
      <div className="page settings-page">
        <nav className="settings-nav" aria-label={t('settings.title')}>
          {NAV_ITEMS.map((item) => (
            <a
              key={item.key}
              className={`rail-link${tab === item.key ? ' is-active' : ''}`}
              href={workspaceHref({ view: 'settings', tab: item.key })}
              aria-current={tab === item.key ? 'page' : undefined}
            >
              <item.icon />
              <span className="rail-label">{t(item.labelKey)}</span>
            </a>
          ))}
        </nav>
        <div className="settings-body">
          {tab === 'model' ? <ModelPanel api={api} /> : <GeneralPanel />}
        </div>
      </div>
    </div>
  )
}

// ---------- 通用：界面语言 ----------

function GeneralPanel() {
  const { locale, setLocale, t } = useLocale()

  return (
    <section className="card">
      <h2>{t('settings.general.title')}</h2>
      <div className="settings-language">
        <span className="settings-language-label">{t('providers.language')}</span>
        <Segmented
          value={locale}
          onChange={setLocale}
          ariaLabel={t('providers.language')}
          options={[
            { value: 'zh-CN', label: '简体中文' },
            { value: 'en', label: 'English' },
          ]}
        />
      </div>
    </section>
  )
}

// ---------- 模型：默认运行模型 ----------

function ModelPanel({ api }: { api: ApiCtx }) {
  const { t } = useLocale()
  const feedback = useFeedback()

  const [settings, setSettings] = useState<RunAgentSettingsView | null>(null)
  const [connections, setConnections] = useState<WorkspaceProviderView[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [savingId, setSavingId] = useState<string | null>(null)
  const savingRef = useRef(false)

  useEffect(() => {
    const ctrl = new AbortController()
    let alive = true
    setLoading(true)
    setError(null)
    Promise.all([getRunAgentSettings(api, ctrl.signal), listProviderConnections(api, ctrl.signal)])
      .then(([nextSettings, res]) => {
        if (!alive) return
        setSettings(nextSettings)
        setConnections(res?.connections ?? [])
      })
      .catch((loadError: unknown) => {
        if (alive) setError(toUserMessage(loadError))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
      ctrl.abort()
    }
  }, [api, version])

  const handleSelect = async (id: string) => {
    if (!id || savingRef.current) return
    savingRef.current = true
    setSavingId(id)
    try {
      const view = await saveRunAgentSettings(api, id)
      if (view) setSettings(view)
      feedback.success(t('providers.defaultModel.saved'))
    } catch (saveError: unknown) {
      feedback.error(t('providers.defaultModel.saveFailed'), { body: toUserMessage(saveError) })
    } finally {
      savingRef.current = false
      setSavingId(null)
    }
  }

  const availability = new Map((settings?.providers ?? []).map((p) => [p.id, p]))
  const selectedId = settings && !settings.unset ? settings.providerConnectionId : undefined

  return (
    <section className="card">
      <h2>{t('settings.model.title')}</h2>
      <p className="settings-note">{t('settings.model.description')}</p>

      {loading ? (
        <LoadingBlock title={t('common.loading')} />
      ) : error ? (
        <ErrorBanner
          title={t('common.notAvailable')}
          body={error}
          onRetry={() => setVersion((v) => v + 1)}
          retryLabel={t('common.retry')}
        />
      ) : !connections || connections.length === 0 ? (
        <EmptyState
          title={t('common.empty')}
          description={t('settings.model.emptyBody')}
          action={
            <a className="btn btn-primary btn-sm" href={workspaceHref({ view: 'providers' })}>
              {t('settings.model.emptyAction')}
            </a>
          }
        />
      ) : (
        <ul className="settings-model-list">
          {connections.map((connection) => (
            <ModelOption
              key={connection.id}
              connection={connection}
              availability={availability.get(connection.id)}
              checked={selectedId === connection.id}
              disabled={savingId !== null}
              onSelect={() => void handleSelect(connection.id)}
              t={t}
            />
          ))}
        </ul>
      )}
      {savingId && <p className="settings-note">{t('common.saving')}</p>}
    </section>
  )
}

function ModelOption({
  connection,
  availability,
  checked,
  disabled,
  onSelect,
  t,
}: {
  connection: WorkspaceProviderView
  availability?: ProviderAvailability
  checked: boolean
  disabled: boolean
  onSelect: () => void
  t: TranslateFn
}) {
  const modelLabel = connection.providerName && connection.modelName
    ? `${connection.providerName} / ${connection.modelName}`
    : connection.modelId

  return (
    <li className="settings-model-option">
      <label>
        <input
          type="radio"
          name="settings-default-model"
          checked={checked}
          disabled={disabled}
          onChange={onSelect}
        />
        <span className="settings-model-info">
          <span className="settings-model-title">
            <strong>{connection.name}</strong>
            <Badge tone="neutral">{connection.adapterKind}</Badge>
            {availability && !availability.available && (
              <Badge tone="warning">{t('common.notAvailable')}</Badge>
            )}
          </span>
          <span className="settings-model-meta">
            <span>{modelLabel}</span>
            <span className="mono">{connection.baseUrl}</span>
          </span>
          {availability?.reason && (
            <span className="settings-model-reason">{availability.reason}</span>
          )}
        </span>
      </label>
    </li>
  )
}

// ---------- 子菜单图标（内联 SVG，与 rail 同款） ----------

function SlidersIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
      <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
    </svg>
  )
}

function CpuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M9 2v2M15 2v2M9 22v-2M15 22v-2M2 9h2M2 15h2M20 9h2M20 15h2" />
    </svg>
  )
}
