import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import enJson from './locales/en.json';
import deJson from './locales/de.json';
import frJson from './locales/fr.json';
import itJson from './locales/it.json';
import esJson from './locales/es.json';

export type UiLanguage = 'en' | 'de' | 'fr' | 'it' | 'es';

export const UI_LANGUAGE_STORAGE_KEY = 'bds-ui-language';

const SUPPORTED_UI_LANGUAGES: UiLanguage[] = ['en', 'de', 'fr', 'it', 'es'];

type TranslationTable = Record<string, string>;

const en = enJson as TranslationTable;
const de = deJson as TranslationTable;
const fr = frJson as TranslationTable;
const it = itJson as TranslationTable;
const es = esJson as TranslationTable;

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
  const localized = uiCatalog[language]?.[key] ?? key;
  return interpolate(localized, params);
}

export interface I18nContextValue {
  language: UiLanguage;
  t: (key: string, params?: Record<string, string | number>) => string;
  setLanguage: (language: UiLanguage) => void;
  supportedLanguages: UiLanguage[];
}

const I18nContext = createContext<I18nContextValue>({
  language: 'en',
  t: (key, params) => translateUi('en', key, params),
  setLanguage: () => {},
  supportedLanguages: SUPPORTED_UI_LANGUAGES,
});

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<UiLanguage>('en');

  const setLanguage = useCallback((nextLanguage: UiLanguage) => {
    const normalized = resolveSupportedUiLanguage(nextLanguage);
    setLanguageState(normalized);
    try {
      localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, normalized);
    } catch {
      // Ignore storage errors and keep in-memory language state.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const persistedLanguage = (() => {
      try {
        const value = localStorage.getItem(UI_LANGUAGE_STORAGE_KEY);
        return value ? resolveSupportedUiLanguage(value) : null;
      } catch {
        return null;
      }
    })();

    if (persistedLanguage) {
      setLanguageState(persistedLanguage);
      return () => {
        cancelled = true;
      };
    }

    const detectLanguage = async () => {
      try {
        const systemLocale = await window.electronAPI?.app.getSystemLanguage?.();
        const locale = systemLocale || navigator.language;
        if (!cancelled) {
          setLanguageState(resolveUiLanguageFromSystemLocale(locale));
        }
      } catch {
        if (!cancelled) {
          setLanguageState(resolveUiLanguageFromSystemLocale(navigator.language));
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
      setLanguage,
      supportedLanguages: SUPPORTED_UI_LANGUAGES,
    }),
    [language, setLanguage]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
