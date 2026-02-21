import { describe, expect, it } from 'vitest';
import {
  translateUi,
  resolveSupportedUiLanguage,
  resolveUiLanguageFromSystemLocale,
} from '../../src/renderer/i18n';

describe('renderer i18n', () => {
  it('resolves supported ui language from OS locale', () => {
    expect(resolveUiLanguageFromSystemLocale('de-DE')).toBe('de');
    expect(resolveUiLanguageFromSystemLocale('fr-CH')).toBe('fr');
    expect(resolveUiLanguageFromSystemLocale('pt-BR')).toBe('en');
  });

  it('normalizes explicit ui language values', () => {
    expect(resolveSupportedUiLanguage('it')).toBe('it');
    expect(resolveSupportedUiLanguage('es-MX')).toBe('es');
    expect(resolveSupportedUiLanguage('')).toBe('en');
  });

  it('returns translated text with english fallback', () => {
    expect(translateUi('de', 'common.save')).toBe('Speichern');
    expect(translateUi('fr', 'common.cancel')).toBe('Annuler');
    expect(translateUi('de', 'settings.language.english')).toBe('Englisch');
    expect(translateUi('it', 'missing.key')).toBe('missing.key');
  });
});
