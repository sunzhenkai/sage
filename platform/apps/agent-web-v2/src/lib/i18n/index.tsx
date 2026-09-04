import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { readStorage, writeStorage } from "../storage";
import zhCN, { type Messages } from "./messages.zh-CN";
import en from "./messages.en";

export type Locale = "zh-CN" | "en";

export const LOCALE_STORAGE_KEY = "sage.web.locale";

const dictionaries: Record<Locale, Messages> = { "zh-CN": zhCN, en };

function isLocale(value: unknown): value is Locale {
  return value === "zh-CN" || value === "en";
}

/**
 * Locale detection (spec §4.1): stored preference, then navigator languages
 * (`zh*` → zh-CN, `en*` → en), finally zh-CN.
 */
export function detectLocale(): Locale {
  const stored = readStorage(LOCALE_STORAGE_KEY);
  if (isLocale(stored)) return stored;
  const candidates: readonly string[] = [
    ...(typeof navigator !== "undefined" && navigator.languages ? navigator.languages : []),
    ...(typeof navigator !== "undefined" && navigator.language ? [navigator.language] : []),
  ];
  for (const candidate of candidates) {
    const lower = candidate.toLowerCase();
    if (lower.startsWith("zh")) return "zh-CN";
    if (lower.startsWith("en")) return "en";
  }
  return "zh-CN";
}

type DottedKey<M> = {
  [K in keyof M & string]: M[K] extends string ? K : `${K}.${DottedKey<M[K]>}`;
}[keyof M & string];

export type MessageKey = DottedKey<Messages>;

function lookup(messages: Messages, key: MessageKey): string {
  let node: unknown = messages;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return key;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : key;
}

export type TranslateFn = (key: MessageKey, params?: Record<string, string | number>) => string;

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: TranslateFn;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => detectLocale());

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    writeStorage(LOCALE_STORAGE_KEY, next);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const t = useCallback<TranslateFn>(
    (key, params) => {
      let text = lookup(dictionaries[locale], key);
      if (params) {
        for (const [name, value] of Object.entries(params)) {
          text = text.replaceAll(`{${name}}`, String(value));
        }
      }
      return text;
    },
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used within I18nProvider");
  return context;
}
