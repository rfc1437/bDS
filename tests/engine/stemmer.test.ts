/**
 * Stemmer Unit Tests
 *
 * Tests the REAL stemmer functions without any mocks.
 * The stemmer provides multilingual text stemming for FTS indexing.
 * 
 * Tests all branches including:
 * - Various languages
 * - ISO language code conversion
 * - Empty/null inputs
 * - FTS5 query operators (AND, OR, NOT)
 * - Quoted phrases
 * - Prefix searches
 * - Edge cases
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  stemText,
  stemQuery,
  stemWord,
  getSupportedLanguages,
  isoToStemmerLanguage,
  prepareForFTS,
  SupportedLanguage,
} from '../../src/main/engine/stemmer';

describe('stemmer', () => {
  describe('getSupportedLanguages', () => {
    it('should return an array of supported languages', () => {
      const languages = getSupportedLanguages();
      
      expect(Array.isArray(languages)).toBe(true);
      expect(languages.length).toBeGreaterThan(0);
      expect(languages).toContain('english');
    });

    it('should include common languages', () => {
      const languages = getSupportedLanguages();
      
      expect(languages).toContain('german');
      expect(languages).toContain('french');
      expect(languages).toContain('spanish');
    });
  });

  describe('isoToStemmerLanguage', () => {
    it('should convert ISO 639-1 codes to stemmer language names', () => {
      expect(isoToStemmerLanguage('en')).toBe('english');
      expect(isoToStemmerLanguage('de')).toBe('german');
      expect(isoToStemmerLanguage('fr')).toBe('french');
      expect(isoToStemmerLanguage('es')).toBe('spanish');
    });

    it('should handle locale codes with region (e.g., en-US)', () => {
      expect(isoToStemmerLanguage('en-US')).toBe('english');
      expect(isoToStemmerLanguage('de-DE')).toBe('german');
      expect(isoToStemmerLanguage('fr-FR')).toBe('french');
      expect(isoToStemmerLanguage('es-MX')).toBe('spanish');
    });

    it('should be case insensitive', () => {
      expect(isoToStemmerLanguage('EN')).toBe('english');
      expect(isoToStemmerLanguage('De')).toBe('german');
      expect(isoToStemmerLanguage('FR')).toBe('french');
    });

    it('should return english for unknown language codes', () => {
      expect(isoToStemmerLanguage('xx')).toBe('english');
      expect(isoToStemmerLanguage('unknown')).toBe('english');
      expect(isoToStemmerLanguage('')).toBe('english');
    });

    it('should handle all mapped ISO codes', () => {
      expect(isoToStemmerLanguage('ar')).toBe('arabic');
      expect(isoToStemmerLanguage('hy')).toBe('armenian');
      expect(isoToStemmerLanguage('eu')).toBe('basque');
      expect(isoToStemmerLanguage('ca')).toBe('catalan');
      expect(isoToStemmerLanguage('cs')).toBe('czech');
      expect(isoToStemmerLanguage('da')).toBe('danish');
      expect(isoToStemmerLanguage('nl')).toBe('dutch');
      expect(isoToStemmerLanguage('fi')).toBe('finnish');
      expect(isoToStemmerLanguage('hu')).toBe('hungarian');
      expect(isoToStemmerLanguage('it')).toBe('italian');
      expect(isoToStemmerLanguage('ga')).toBe('irish');
      expect(isoToStemmerLanguage('no')).toBe('norwegian');
      expect(isoToStemmerLanguage('nb')).toBe('norwegian');
      expect(isoToStemmerLanguage('nn')).toBe('norwegian');
      expect(isoToStemmerLanguage('pt')).toBe('portuguese');
      expect(isoToStemmerLanguage('ro')).toBe('romanian');
      expect(isoToStemmerLanguage('ru')).toBe('russian');
      expect(isoToStemmerLanguage('sl')).toBe('slovene');
      expect(isoToStemmerLanguage('sv')).toBe('swedish');
      expect(isoToStemmerLanguage('ta')).toBe('tamil');
      expect(isoToStemmerLanguage('tr')).toBe('turkish');
    });
  });

  describe('stemWord', () => {
    it('should stem English words correctly', () => {
      expect(stemWord('running', 'english')).toBe('run');
      expect(stemWord('dogs', 'english')).toBe('dog');
      expect(stemWord('played', 'english')).toBe('play');
      expect(stemWord('playing', 'english')).toBe('play');
    });

    it('should stem German words correctly', () => {
      expect(stemWord('häuser', 'german')).toBe('haus');
      expect(stemWord('Häuser', 'german')).toBe('haus');
    });

    it('should stem French words correctly', () => {
      expect(stemWord('chanter', 'french')).toBe('chant');
      expect(stemWord('chanteuse', 'french')).toBe('chanteux');
    });

    it('should default to English when no language specified', () => {
      expect(stemWord('running')).toBe('run');
      expect(stemWord('dogs')).toBe('dog');
    });

    it('should handle uppercase words by converting to lowercase', () => {
      expect(stemWord('RUNNING', 'english')).toBe('run');
      expect(stemWord('DOGS', 'english')).toBe('dog');
    });
  });

  describe('stemText', () => {
    it('should stem all words in a sentence', () => {
      const result = stemText('Running dogs are playing', 'english');
      expect(result).toContain('run');
      expect(result).toContain('dog');
    });

    it('should return empty string for empty input', () => {
      expect(stemText('', 'english')).toBe('');
      expect(stemText('   ', 'english')).toBe('');
    });

    it('should handle multiple spaces between words', () => {
      const result = stemText('Running   dogs   are   playing', 'english');
      const words = result.split(' ');
      expect(words).not.toContain('');
    });

    it('should handle German text correctly', () => {
      const result = stemText('Häuser Haus', 'german');
      expect(result).toContain('haus');
    });

    it('should handle text with numbers', () => {
      const result = stemText('Running 123 dogs', 'english');
      expect(result).toContain('run');
      expect(result).toContain('123');
      expect(result).toContain('dog');
    });

    it('should handle punctuation by extracting words', () => {
      const result = stemText('Hello, world! How are you?', 'english');
      expect(result).toContain('hello');
      expect(result).toContain('world');
    });

    it('should use default English language when not specified', () => {
      const result = stemText('Running dogs');
      expect(result).toContain('run');
      expect(result).toContain('dog');
    });

    it('should handle Unicode characters for non-ASCII languages', () => {
      // Russian text
      const russianResult = stemText('привет мир', 'russian');
      expect(russianResult.length).toBeGreaterThan(0);

      // Arabic text
      const arabicResult = stemText('مرحبا', 'arabic');
      expect(arabicResult.length).toBeGreaterThan(0);
    });
  });

  describe('stemQuery', () => {
    it('should stem simple queries', () => {
      const result = stemQuery('running dogs', 'english');
      expect(result).toContain('run');
      expect(result).toContain('dog');
    });

    it('should return empty string for empty query', () => {
      expect(stemQuery('', 'english')).toBe('');
      expect(stemQuery('   ', 'english')).toBe('');
    });

    it('should preserve AND operator in uppercase', () => {
      const result = stemQuery('running AND dogs', 'english');
      expect(result).toContain('AND');
      expect(result).toContain('run');
      expect(result).toContain('dog');
    });

    it('should preserve OR operator in uppercase', () => {
      const result = stemQuery('cats OR dogs', 'english');
      expect(result).toContain('OR');
      expect(result).toContain('cat');
      expect(result).toContain('dog');
    });

    it('should preserve NOT operator in uppercase', () => {
      const result = stemQuery('NOT dogs', 'english');
      expect(result).toContain('NOT');
      expect(result).toContain('dog');
    });

    it('should handle lowercase operators by stemming them', () => {
      // lowercase 'and', 'or', 'not' should be stemmed as regular words
      const andResult = stemQuery('and', 'english');
      // 'and' stemmed might be 'and' itself
      expect(andResult.length).toBeGreaterThan(0);
    });

    it('should stem words inside quoted phrases', () => {
      const result = stemQuery('"running fast"', 'english');
      expect(result).toContain('"');
      expect(result).toContain('run');
      expect(result).toContain('fast');
    });

    it('should keep quotes around stemmed phrase', () => {
      const result = stemQuery('"running dogs"', 'english');
      expect(result.startsWith('"')).toBe(true);
      expect(result.endsWith('"')).toBe(true);
    });

    it('should handle prefix searches with asterisk', () => {
      const result = stemQuery('runn*', 'english');
      expect(result).toContain('*');
      // The word part before * should be stemmed
      expect(result.includes('run')).toBe(true);
    });

    it('should handle prefix search when word results in empty after tokenization', () => {
      // Test with just asterisk (edge case)
      const result = stemQuery('*', 'english');
      // Should return the original match since no word part
      expect(result).toBe('*');
    });

    it('should handle complex queries with multiple operators', () => {
      const result = stemQuery('"running fast" AND dogs NOT cats', 'english');
      expect(result).toContain('AND');
      expect(result).toContain('NOT');
      expect(result).toContain('dog');
      expect(result).toContain('cat');
    });

    it('should clean up multiple spaces', () => {
      const result = stemQuery('running    dogs', 'english');
      expect(result).not.toContain('  ');
    });

    it('should use default English language when not specified', () => {
      const result = stemQuery('running dogs');
      expect(result).toContain('run');
      expect(result).toContain('dog');
    });

    it('should handle unquoted words that tokenize to empty', () => {
      // Special characters only
      const result = stemQuery('!!!', 'english');
      // Should result in empty string or just spaces
      expect(result.trim()).toBe('');
    });

    it('should handle mixed quoted and unquoted terms', () => {
      const result = stemQuery('dogs "running fast" cats', 'english');
      expect(result).toContain('dog');
      expect(result).toContain('cat');
      expect(result).toContain('"');
    });
  });

  describe('prepareForFTS', () => {
    it('should prepare text for FTS indexing by stemming', () => {
      const result = prepareForFTS('Running dogs are playing', 'english');
      expect(result).toContain('run');
      expect(result).toContain('dog');
    });

    it('should use default English when no language specified', () => {
      const result = prepareForFTS('Running dogs');
      expect(result).toContain('run');
      expect(result).toContain('dog');
    });

    it('should be identical to stemText', () => {
      const text = 'Running dogs are playing';
      expect(prepareForFTS(text, 'english')).toBe(stemText(text, 'english'));
    });
  });

  describe('stemmer caching', () => {
    it('should reuse cached stemmers for same language', () => {
      // Call multiple times with same language
      const result1 = stemWord('running', 'english');
      const result2 = stemWord('playing', 'english');
      
      // Results should be consistent
      expect(result1).toBe('run');
      expect(result2).toBe('play');
    });

    it('should support different languages in sequence', () => {
      const englishResult = stemWord('running', 'english');
      const germanResult = stemWord('häuser', 'german');
      const frenchResult = stemWord('chanter', 'french');
      
      expect(englishResult).toBe('run');
      expect(germanResult).toBe('haus');
      expect(frenchResult).toBe('chant');
    });
  });

  describe('edge cases', () => {
    it('should handle very long text', () => {
      const longText = 'running '.repeat(1000);
      const result = stemText(longText, 'english');
      expect(result.length).toBeGreaterThan(0);
      expect(result.split(' ').every(word => word === 'run' || word === '')).toBe(true);
    });

    it('should handle special Unicode characters', () => {
      const result = stemText('café résumé naïve', 'english');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle emoji by extracting adjacent words', () => {
      const result = stemText('running 🏃 dogs', 'english');
      expect(result).toContain('run');
      expect(result).toContain('dog');
    });

    it('should handle mixed case consistently', () => {
      const lower = stemText('running', 'english');
      const upper = stemText('RUNNING', 'english');
      const mixed = stemText('RuNnInG', 'english');
      
      expect(lower).toBe(upper);
      expect(lower).toBe(mixed);
    });
  });
});
