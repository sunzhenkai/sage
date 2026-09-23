import { useState, type ReactNode } from 'react'

import { Segmented, SettingsListContext } from '../components/ui'
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

// 三段式：层 2 = 当前层级的单一列表（general = 子菜单；connections = 连接 item 列表，
// 由 ProvidersView portal 填充，顶部提供返回子菜单入口）；层 3 = settings-body 内容区。
// 两类列表互斥呈现，禁止混合；总列数恒为三列（rail 在卡片外），禁止第四列嵌套。
export function SettingsView({
  api,
  tab,
  connection,
  panel,
}: {
  api: ApiCtx
  tab: SettingsTab
  connection?: string
  panel?: 'model'
}) {
  const { t } = useLocale()
  const [listItemsEl, setListItemsEl] = useState<HTMLDivElement | null>(null)

  return (
    <div className="view settings-view">
      <SettingsListContext.Provider value={listItemsEl}>
        <aside className="settings-list-pane">
          {tab === 'general' ? (
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
          ) : (
            <>
              <a
                className="rail-link settings-back"
                href={workspaceHref({ view: 'settings', tab: 'general' })}
              >
                <ChevronLeftIcon />
                <span className="rail-label">{t('settings.back')}</span>
              </a>
              <div className="settings-list-items" ref={setListItemsEl} />
            </>
          )}
        </aside>
        <div className="settings-body">
          {tab === 'connections' ? (
            <ProvidersView api={api} connection={connection} panel={panel} />
          ) : (
            <GeneralPanel />
          )}
        </div>
      </SettingsListContext.Provider>
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

// ---------- 列表栏图标（内联 SVG，与 rail 同款） ----------

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m14 6-6 6 6 6" />
    </svg>
  )
}

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
