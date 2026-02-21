import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import enJson from './locales/en.json';
import deJson from './locales/de.json';
import frJson from './locales/fr.json';
import itJson from './locales/it.json';
import esJson from './locales/es.json';

export type UiLanguage = 'en' | 'de' | 'fr' | 'it' | 'es';

type TranslationTable = Record<string, string>;

const en = enJson as TranslationTable;
const de = { ...en, ...(deJson as TranslationTable) };
const fr = { ...en, ...(frJson as TranslationTable) };
const it = { ...en, ...(itJson as TranslationTable) };
const es = { ...en, ...(esJson as TranslationTable) };

const uiCatalog: Record<UiLanguage, TranslationTable> = { en, de, fr, it, es };

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) {
    return template;
  }

  return Object.entries(params).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template
  );
}

export function resolveSupportedUiLanguage(language: string | undefined | null): UiLanguage {
  const normalized = (language || '').trim().toLowerCase();
  if (!normalized) {
    return 'en';
  }

  const base = normalized.split('-')[0];
  if (base === 'de' || base === 'fr' || base === 'it' || base === 'es' || base === 'en') {
    return base;
  }

  return 'en';
}

export function resolveUiLanguageFromSystemLocale(systemLocale: string | undefined | null): UiLanguage {
  return resolveSupportedUiLanguage(systemLocale);
}

export function translateUi(
  language: UiLanguage,
  key: string,
  params?: Record<string, string | number>
): string {
  const localized = uiCatalog[language]?.[key] ?? uiCatalog.en[key] ?? key;
  return interpolate(localized, params);
}

export interface I18nContextValue {
  language: UiLanguage;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue>({
  language: 'en',
  t: (key, params) => translateUi('en', key, params),
});

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguage] = useState<UiLanguage>('en');

  useEffect(() => {
    let cancelled = false;

    const detectLanguage = async () => {
      try {
        const systemLocale = await window.electronAPI?.app.getSystemLanguage?.();
        const locale = systemLocale || navigator.language;
        if (!cancelled) {
          setLanguage(resolveUiLanguageFromSystemLocale(locale));
        }
      } catch {
        if (!cancelled) {
          setLanguage(resolveUiLanguageFromSystemLocale(navigator.language));
        }
      }
    };

    void detectLanguage();

    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      t: (key, params) => translateUi(language, key, params),
    }),
    [language]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
