import type { ReactNode } from 'react'

import { Segmented } from '../components/ui'
import { useLocale } from '../i18n'
import type { ApiCtx } from '../lib/api/client'
import { workspaceHref, type SettingsTab } from '../lib/router'
import { ProvidersView } from './ProvidersView'

import './SettingsView.css'

// 子菜单数据驱动：追加新 tab 只需在数组里加一项。
const NAV_ITEMS: ReadonlyArray<{ key: SettingsTab; labelKey: string; icon: () => ReactNode }> = [
  { key: 'general', labelKey: 'settings.nav.general', icon: SlidersIcon },
  { key: 'connections', labelKey: 'settings.nav.connections', icon: PlugIcon },
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
          {tab === 'connections' ? (
            <div className="settings-connections">
              <ProvidersView api={api} />
            </div>
          ) : (
            <GeneralPanel />
          )}
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

// ---------- 子菜单图标（内联 SVG，与 rail 同款） ----------

function SlidersIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
      <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
    </svg>
  )
}

function PlugIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 7V3M15 7V3M7 7h10v5a5 5 0 0 1-10 0V7Zm5 10v4" />
    </svg>
  )
}
