/**
 * Multilingual text stemming utility using Snowball stemmers.
 * Used to normalize text before indexing in FTS5 and before searching.
 * 
 * Supports 24 languages including: English, German, French, Spanish, Italian,
 * Portuguese, Dutch, Russian, Arabic, and more.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const snowballFactory = require('snowball-stemmers');

export type SupportedLanguage =
  | 'arabic'
  | 'armenian'
  | 'basque'
  | 'catalan'
  | 'czech'
  | 'danish'
  | 'dutch'
  | 'english'
  | 'finnish'
  | 'french'
  | 'german'
  | 'hungarian'
  | 'italian'
  | 'irish'
  | 'norwegian'
  | 'porter'
  | 'portuguese'
  | 'romanian'
  | 'russian'
  | 'spanish'
  | 'slovene'
  | 'swedish'
  | 'tamil'
  | 'turkish';

/**
 * Map of ISO 639-1 language codes to Snowball stemmer language names.
 * Falls back to 'english' for unsupported codes.
 */
const isoToSnowball: Record<string, SupportedLanguage> = {
  ar: 'arabic',
  hy: 'armenian',
  eu: 'basque',
  ca: 'catalan',
  cs: 'czech',
  da: 'danish',
  nl: 'dutch',
  en: 'english',
  fi: 'finnish',
  fr: 'french',
  de: 'german',
  hu: 'hungarian',
  it: 'italian',
  ga: 'irish',
  no: 'norwegian',
  nb: 'norwegian',
  nn: 'norwegian',
  pt: 'portuguese',
  ro: 'romanian',
  ru: 'russian',
  es: 'spanish',
  sl: 'slovene',
  sv: 'swedish',
  ta: 'tamil',
  tr: 'turkish',
};

/**
 * Convert an ISO 639-1 language code to a Snowball stemmer language name.
 * Returns 'english' as fallback for unknown codes.
 * 
 * @param isoCode - ISO 639-1 language code (e.g., 'en', 'de', 'fr')
 * @returns Snowball language name (e.g., 'english', 'german', 'french')
 */
export function isoToStemmerLanguage(isoCode: string): SupportedLanguage {
  const normalized = isoCode.toLowerCase().split('-')[0]; // Handle 'en-US' -> 'en'
  return isoToSnowball[normalized] || 'english';
}

interface Stemmer {
  stem(word: string): string;
}

// Cache stemmers to avoid recreating them
const stemmerCache = new Map<SupportedLanguage, Stemmer>();

/**
 * Get a stemmer instance for a given language.
 * Stemmers are cached for reuse.
 */
function getStemmer(language: SupportedLanguage): Stemmer {
  let stemmer = stemmerCache.get(language);
  if (!stemmer) {
    stemmer = snowballFactory.newStemmer(language) as Stemmer;
    stemmerCache.set(language, stemmer);
  }
  return stemmer;
}

/**
 * Get all supported language codes.
 */
export function getSupportedLanguages(): SupportedLanguage[] {
  return snowballFactory.algorithms() as SupportedLanguage[];
}

/**
 * Tokenize text into words.
 * Uses Unicode-aware word splitting to handle non-ASCII languages.
 */
function tokenize(text: string): string[] {
  // Match Unicode word characters (letters, marks, numbers)
  // This handles languages like German (häuser), Russian (привет), Arabic, etc.
  const wordPattern = /[\p{L}\p{M}\p{N}]+/gu;
  const matches = text.match(wordPattern);
  return matches || [];
}

/**
 * Stem a single word using the specified language stemmer.
 */
export function stemWord(word: string, language: SupportedLanguage = 'english'): string {
  const stemmer = getStemmer(language);
  return stemmer.stem(word.toLowerCase());
}

/**
 * Stem all words in a text and return the stemmed text.
 * Words are joined with spaces.
 * 
 * @param text - The text to stem
 * @param language - The language to use for stemming (default: 'english')
 * @returns Text with all words replaced by their stems
 * 
 * @example
 * stemText('Running runners run', 'english') // 'run runner run'
 * stemText('Häuser Haus', 'german') // 'haus haus'
 */
export function stemText(text: string, language: SupportedLanguage = 'english'): string {
  if (!text) return '';
  
  const words = tokenize(text);
  const stemmer = getStemmer(language);
  
  const stemmedWords = words.map(word => stemmer.stem(word.toLowerCase()));
  return stemmedWords.join(' ');
}

/**
 * Prepare a search query by stemming all words.
 * This ensures searches match stemmed content in the FTS index.
 * 
 * FTS5 query syntax is preserved:
 * - Quoted phrases are stemmed but kept quoted
 * - Boolean operators (AND, OR, NOT) are preserved
 * - Prefix searches (word*) have the word part stemmed
 * 
 * @param query - The search query from the user
 * @param language - The language for stemming
 * @returns Query with words stemmed for FTS5
 * 
 * @example
 * stemQuery('running dogs', 'english') // 'run dog'
 * stemQuery('"running fast"', 'english') // '"run fast"'
 */
export function stemQuery(query: string, language: SupportedLanguage = 'english'): string {
  if (!query) return '';
  
  const stemmer = getStemmer(language);
  
  // Handle quoted phrases - stem words inside quotes but keep quotes
  const result = query.replace(
    /"([^"]+)"|(\S+)/g,
    (match, quoted, unquoted) => {
      if (quoted) {
        // Stem words in quoted phrase
        const words = tokenize(quoted);
        const stemmed = words.map(w => stemmer.stem(w.toLowerCase())).join(' ');
        return `"${stemmed}"`;
      }
      
      // Check for FTS5 operators
      const upper = unquoted.toUpperCase();
      if (upper === 'AND' || upper === 'OR' || upper === 'NOT') {
        return upper;
      }
      
      // Handle prefix searches (word*)
      if (unquoted.endsWith('*')) {
        const wordPart = unquoted.slice(0, -1);
        const words = tokenize(wordPart);
        if (words.length > 0) {
          return stemmer.stem(words[0].toLowerCase()) + '*';
        }
        return match;
      }
      
      // Regular word - stem it
      const words = tokenize(unquoted);
      if (words.length > 0) {
        return stemmer.stem(words[0].toLowerCase());
      }
      return '';
    }
  );
  
  // Clean up multiple spaces
  return result.replace(/\s+/g, ' ').trim();
}

/**
 * Prepare content for FTS indexing.
 * Stems all text and produces a string suitable for FTS5 insertion.
 * 
 * Also stores the original text after the stemmed text (separated by a special marker)
 * so that snippet() can show the original words. However, we'll use a simpler approach:
 * just return stemmed text for matching.
 * 
 * @param text - The original content
 * @param language - The language for stemming
 * @returns Stemmed text for FTS5 indexing
 */
export function prepareForFTS(text: string, language: SupportedLanguage = 'english'): string {
  return stemText(text, language);
}
