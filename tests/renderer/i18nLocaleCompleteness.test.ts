import { describe, expect, it } from 'vitest';
import en from '../../src/renderer/i18n/locales/en.json';
import de from '../../src/renderer/i18n/locales/de.json';
import fr from '../../src/renderer/i18n/locales/fr.json';
import itLocale from '../../src/renderer/i18n/locales/it.json';
import es from '../../src/renderer/i18n/locales/es.json';

type LocaleMap = Record<string, string>;

const locales: Record<string, LocaleMap> = {
  de: de as LocaleMap,
  fr: fr as LocaleMap,
  it: itLocale as LocaleMap,
  es: es as LocaleMap,
};

describe('renderer locale completeness', () => {
  const englishKeys = Object.keys(en as LocaleMap).sort();

  it('all renderer locales contain exactly the english key set', () => {
    for (const [locale, messages] of Object.entries(locales)) {
      const localeKeys = Object.keys(messages).sort();

      expect(localeKeys, `Locale ${locale} is missing or has extra keys`).toEqual(englishKeys);
    }
  });
});
