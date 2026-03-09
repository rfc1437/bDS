import enJson from './i18n/locales/en.json';
import deJson from './i18n/locales/de.json';
import frJson from './i18n/locales/fr.json';
import itJson from './i18n/locales/it.json';
import esJson from './i18n/locales/es.json';

export type SupportedLanguage = 'en' | 'de' | 'fr' | 'it' | 'es';
export const SUPPORTED_RENDER_LANGUAGES: SupportedLanguage[] = ['en', 'de', 'fr', 'it', 'es'];

/**
 * Canonical list of languages supported for post and media translations.
 * Used by both AI tasks and the Blog Languages UI.
 */
export const SUPPORTED_POST_LANGUAGES: readonly SupportedLanguage[] = SUPPORTED_RENDER_LANGUAGES;

export const POST_LANGUAGE_FLAGS: Record<SupportedLanguage, string> = {
  en: '🇬🇧',
  de: '🇩🇪',
  fr: '🇫🇷',
  it: '🇮🇹',
  es: '🇪🇸',
};

type TranslationMap = Record<string, string>;

const en = enJson as TranslationMap;
const de = deJson as TranslationMap;
const fr = frJson as TranslationMap;
const it = itJson as TranslationMap;
const es = esJson as TranslationMap;

const catalog: Record<SupportedLanguage, TranslationMap> = { en, de, fr, it, es };

function normalizeLanguage(input: string | undefined | null): SupportedLanguage {
  const normalized = (input || '').trim().toLowerCase();
  if (!normalized) {
    return 'en';
  }

  const base = normalized.split('-')[0];
  if (base === 'en' || base === 'de' || base === 'fr' || base === 'it' || base === 'es') {
    return base;
  }

  return 'en';
}

export function resolveSupportedRenderLanguage(language: string | undefined | null): SupportedLanguage {
  return normalizeLanguage(language);
}

export function resolveRenderLanguageFromProjectPreferences(mainLanguage: string | undefined | null): SupportedLanguage {
  return normalizeLanguage(mainLanguage);
}

export function resolveSupportedUiLanguage(language: string | undefined | null): SupportedLanguage {
  return normalizeLanguage(language);
}

export function resolveUiLanguageFromSystemLocale(systemLocale: string | undefined | null): SupportedLanguage {
  return normalizeLanguage(systemLocale);
}

export function getRenderTranslations(language: SupportedLanguage): Record<string, string> {
  return catalog[language] ?? catalog.en;
}

export function translateRender(language: SupportedLanguage, key: string): string {
  return catalog[language]?.[key] ?? key;
}

export function translateMenu(language: SupportedLanguage, key: string): string {
  return catalog[language]?.[key] ?? key;
}
