import { describe, expect, it } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import {
  I18nProvider,
  UI_LANGUAGE_STORAGE_KEY,
  useI18n,
  translateUi,
  resolveSupportedUiLanguage,
  resolveUiLanguageFromSystemLocale,
} from '../../src/renderer/i18n';

const LanguageProbe: React.FC = () => {
  const { language, t } = useI18n();
  return React.createElement(
    React.Fragment,
    null,
    React.createElement('span', { 'data-testid': 'language' }, language),
    React.createElement('span', { 'data-testid': 'save-label' }, t('common.save')),
  );
};

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

  it('uses system locale for ui language when no persisted choice exists', async () => {
    localStorage.removeItem(UI_LANGUAGE_STORAGE_KEY);
    (window.electronAPI.app as { getSystemLanguage?: () => Promise<string> }).getSystemLanguage = async () => 'de-DE';

    render(React.createElement(I18nProvider, null, React.createElement(LanguageProbe)));

    expect(await screen.findByTestId('language')).toHaveTextContent('de');
    expect(screen.getByTestId('save-label')).toHaveTextContent('Speichern');
  });

  it('uses persisted ui language over system locale', async () => {
    localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, 'fr');
    (window.electronAPI.app as { getSystemLanguage?: () => Promise<string> }).getSystemLanguage = async () => 'de-DE';

    render(React.createElement(I18nProvider, null, React.createElement(LanguageProbe)));

    expect(await screen.findByTestId('language')).toHaveTextContent('fr');
    expect(screen.getByTestId('save-label')).toHaveTextContent('Enregistrer');
  });
});
