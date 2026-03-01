import { describe, expect, it } from 'vitest';
import { slugify } from '../../src/main/engine/slugify';

describe('slugify', () => {
  describe('basic transformations', () => {
    it('lowercases the input', () => {
      expect(slugify('Hello World')).toBe('hello-world');
    });

    it('replaces spaces with hyphens', () => {
      expect(slugify('hello world')).toBe('hello-world');
    });

    it('collapses multiple spaces into a single hyphen', () => {
      expect(slugify('Multiple   Spaces   Here')).toBe('multiple-spaces-here');
    });

    it('removes leading and trailing hyphens', () => {
      expect(slugify('---Test---')).toBe('test');
    });

    it('handles numbers in input', () => {
      expect(slugify('10 Tips for Testing')).toBe('10-tips-for-testing');
    });

    it('returns empty string for empty input', () => {
      expect(slugify('')).toBe('');
    });

    it('returns empty string for whitespace-only input', () => {
      expect(slugify('   ')).toBe('');
    });
  });

  describe('umlaut and special character transliteration', () => {
    it('transliterates German umlauts', () => {
      expect(slugify('Über die Brücke')).toBe('uber-die-brucke');
      expect(slugify('Ärger')).toBe('arger');
      expect(slugify('schön')).toBe('schon');
    });

    it('transliterates ß to ss', () => {
      expect(slugify('Straße')).toBe('strasse');
      expect(slugify('Großmutter')).toBe('grossmutter');
    });

    it('transliterates French accented characters', () => {
      expect(slugify('Café Test')).toBe('cafe-test');
      expect(slugify('crème brûlée')).toBe('creme-brulee');
      expect(slugify('naïve')).toBe('naive');
    });

    it('transliterates Nordic characters', () => {
      expect(slugify('Ångström')).toBe('angstrom');
      expect(slugify('Ærø')).toBe('aero');
      expect(slugify('Ødegaard')).toBe('odegaard');
    });

    it('transliterates Spanish characters', () => {
      expect(slugify('España')).toBe('espana');
      expect(slugify('niño')).toBe('nino');
    });

    it('transliterates Polish characters', () => {
      expect(slugify('Łódź')).toBe('lodz');
    });

    it('transliterates Czech characters', () => {
      expect(slugify('Dvořák')).toBe('dvorak');
      expect(slugify('Háček')).toBe('hacek');
    });
  });

  describe('special characters removal', () => {
    it('removes punctuation', () => {
      expect(slugify('Hello, World! How are you?')).toBe('hello-world-how-are-you');
    });

    it('removes brackets and parentheses', () => {
      expect(slugify('Hello (World) [Test]')).toBe('hello-world-test');
    });

    it('removes symbols', () => {
      expect(slugify('Hello @World #Test $100')).toBe('hello-world-test-100');
    });

    it('removes emoji and non-Latin characters', () => {
      expect(slugify('Hello 🌍 World')).toBe('hello-world');
    });
  });

  describe('word separation', () => {
    it('separates words with normal hyphens', () => {
      const result = slugify('Hello World');
      expect(result).toBe('hello-world');
      // Verify it's a normal hyphen (U+002D), not en-dash or em-dash
      expect(result.charCodeAt(5)).toBe(0x2d);
    });

    it('converts en-dashes and em-dashes to hyphens', () => {
      expect(slugify('hello–world')).toBe('hello-world'); // en-dash
      expect(slugify('hello—world')).toBe('hello-world'); // em-dash
    });

    it('collapses consecutive special chars into single hyphen', () => {
      expect(slugify('hello!!!world')).toBe('hello-world');
      expect(slugify('hello...world')).toBe('hello-world');
    });
  });
});
