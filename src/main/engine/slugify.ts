import { transliterate } from 'transliteration';

/**
 * Generate a URL-safe slug from a string.
 *
 * - Transliterates umlauts and accented characters to ASCII equivalents
 *   using the `transliteration` package for broad Unicode coverage
 * - Removes non-alphanumeric characters (except hyphens used as separators)
 * - Separates words with normal hyphens (U+002D)
 * - Collapses consecutive separators into a single hyphen
 * - Strips leading/trailing hyphens
 */
export function slugify(input: string): string {
  return transliterate(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
