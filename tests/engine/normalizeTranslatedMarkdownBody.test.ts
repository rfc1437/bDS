import { describe, it, expect } from 'vitest';
import { normalizeTranslatedMarkdownBody } from '../../src/main/engine/ai/tasks';

describe('normalizeTranslatedMarkdownBody', () => {
  const sourceContent = '# Hello\n\nThis is the source content.';

  it('strips English "content:" prefix', () => {
    const input = 'content:\n\n# Hallo\n\nDies ist der Inhalt.';
    expect(normalizeTranslatedMarkdownBody(input, sourceContent)).toBe(
      '# Hallo\n\nDies ist der Inhalt.',
    );
  });

  it('strips German "inhalt:" prefix', () => {
    const input = 'Inhalt:\n\nDer Inhalt hier.';
    expect(normalizeTranslatedMarkdownBody(input, sourceContent)).toBe(
      'Der Inhalt hier.',
    );
  });

  it('strips French "contenu:" prefix', () => {
    const input = 'Contenu:\n\nLe contenu ici.';
    expect(normalizeTranslatedMarkdownBody(input, sourceContent)).toBe(
      'Le contenu ici.',
    );
  });

  it('strips Italian "contenuto:" prefix', () => {
    const input = 'Contenuto:\n\nIl contenuto qui.';
    expect(normalizeTranslatedMarkdownBody(input, sourceContent)).toBe(
      'Il contenuto qui.',
    );
  });

  it('strips Spanish "contenido:" prefix', () => {
    const input = 'Contenido:\n\nEl contenido aqui.';
    expect(normalizeTranslatedMarkdownBody(input, sourceContent)).toBe(
      'El contenido aqui.',
    );
  });

  it('is case-insensitive', () => {
    const input = 'CONTENT:\n\nBody text.';
    expect(normalizeTranslatedMarkdownBody(input, sourceContent)).toBe(
      'Body text.',
    );
  });

  it('preserves content when source also has the prefix', () => {
    const sourceWithPrefix = 'content:\n\nSource body.';
    const input = 'Inhalt:\n\nTranslated body.';
    expect(normalizeTranslatedMarkdownBody(input, sourceWithPrefix)).toBe(
      'Inhalt:\n\nTranslated body.',
    );
  });

  it('returns empty string for empty/whitespace input', () => {
    expect(normalizeTranslatedMarkdownBody('', sourceContent)).toBe('');
    expect(normalizeTranslatedMarkdownBody('  \n  ', sourceContent)).toBe('');
  });

  it('returns content unchanged when no prefix is present', () => {
    const input = '# Normal markdown\n\nBody text.';
    expect(normalizeTranslatedMarkdownBody(input, sourceContent)).toBe(input);
  });
});
