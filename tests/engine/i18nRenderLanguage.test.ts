import { describe, expect, it } from 'vitest';
import {
  resolveSupportedRenderLanguage,
  resolveRenderLanguageFromProjectPreferences,
  translateRender,
} from '../../src/main/shared/i18n';

describe('render i18n', () => {
  it('resolves rendering language from project preferences', () => {
    expect(resolveRenderLanguageFromProjectPreferences('de')).toBe('de');
    expect(resolveRenderLanguageFromProjectPreferences('fr-CA')).toBe('fr');
    expect(resolveRenderLanguageFromProjectPreferences(undefined)).toBe('en');
  });

  it('normalizes render language values', () => {
    expect(resolveSupportedRenderLanguage('it')).toBe('it');
    expect(resolveSupportedRenderLanguage('es-AR')).toBe('es');
    expect(resolveSupportedRenderLanguage('pt-BR')).toBe('en');
    expect(resolveSupportedRenderLanguage('')).toBe('en');
  });

  it('translates render keys with fallback', () => {
    expect(translateRender('de', 'render.pagination.newer')).toBe('neuer');
    expect(translateRender('es', 'render.pagination.older')).toBe('más antiguo');
    expect(translateRender('fr', 'missing.key')).toBe('missing.key');
  });
});
