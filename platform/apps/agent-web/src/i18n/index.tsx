import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

import type { LocaleTag } from '../lib/format'
import { readStorage, writeStorage, STORAGE_KEYS } from '../lib/storage'
import { en } from './en'
import { zhCN } from './zh-CN'

export type Messages = typeof zhCN

export const dictionaries: Record<LocaleTag, Messages> = { 'zh-CN': zhCN, en }

export function detectInitialLocale(): LocaleTag {
  const saved = readStorage(STORAGE_KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en') return saved
  const candidates = [...(navigator.languages ?? []), navigator.language]
  for (const candidate of candidates) {
    if (!candidate) continue
    if (candidate.toLowerCase().startsWith('zh')) return 'zh-CN'
    if (candidate.toLowerCase().startsWith('en')) return 'en'
  }
  return 'zh-CN'
}

export function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  return template.replaceAll(/\{(\w+)\}/g, (raw, name: string) => (name in vars ? String(vars[name]) : raw))
}

export type TranslateFn = (key: string, vars?: Record<string, string | number>) => string

function resolve(messages: Messages, key: string): string | undefined {
  let current: unknown = messages
  for (const part of key.split('.')) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return typeof current === 'string' ? current : undefined
}

export function translate(messages: Messages, key: string, vars?: Record<string, string | number>): string {
  const template = resolve(messages, key)
  if (template === undefined) return key
  return interpolate(template, vars)
}

interface LocaleContextValue {
  locale: LocaleTag
  setLocale: (locale: LocaleTag) => void
  t: TranslateFn
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<LocaleTag>(detectInitialLocale)

  const setLocale = useCallback((next: LocaleTag) => {
    setLocaleState(next)
    document.documentElement.lang = next
    writeStorage(STORAGE_KEYS.locale, next)
  }, [])

  const value = useMemo<LocaleContextValue>(() => {
    const messages = dictionaries[locale]
    return { locale, setLocale, t: (key, vars) => translate(messages, key, vars) }
  }, [locale, setLocale])

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext)
  if (!value) throw new Error('useLocale must be used within LocaleProvider')
  return value
}
