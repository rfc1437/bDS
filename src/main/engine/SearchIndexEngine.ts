import * as path from 'path';

export interface SearchIndexOptions {
  htmlDir: string;
  mainLanguage: string;
  additionalLanguages: string[];
  onProgress?: (progress: number, message?: string) => void;
}

export interface SearchIndexLanguageResult {
  language: string;
  pageCount: number;
}

export interface SearchIndexResult {
  languageIndexes: SearchIndexLanguageResult[];
}

/**
 * Build Pagefind search indexes for a generated static site.
 *
 * For single-language sites, creates one index at `{htmlDir}/pagefind/`.
 * For multilingual sites, creates per-language indexes:
 *   - main language: `{htmlDir}/pagefind/` (indexes root html)
 *   - additional languages: `{htmlDir}/{lang}/pagefind/` (indexes `{htmlDir}/{lang}/`)
 */
export async function buildSearchIndex(options: SearchIndexOptions): Promise<SearchIndexResult> {
  const { htmlDir, mainLanguage, additionalLanguages, onProgress } = options;
  const pagefind = await import('pagefind');

  const languages = [mainLanguage, ...additionalLanguages];
  const results: SearchIndexLanguageResult[] = [];

  try {
    for (let i = 0; i < languages.length; i++) {
      const lang = languages[i];
      const isMain = lang === mainLanguage;
      const sourceDir = isMain ? htmlDir : path.join(htmlDir, lang);
      const outputDir = isMain
        ? path.join(htmlDir, 'pagefind')
        : path.join(htmlDir, lang, 'pagefind');

      const progressBase = Math.floor((i / languages.length) * 100);
      const progressSpan = Math.floor(100 / languages.length);

      onProgress?.(progressBase, `Indexing search for ${lang}...`);

      const { errors: createErrors, index } = await pagefind.createIndex({ forceLanguage: lang });
      if (createErrors.length > 0 || !index) {
        throw new Error(`Pagefind createIndex failed for ${lang}: ${createErrors.join(', ')}`);
      }

      try {
        const { errors: addErrors, page_count } = await index.addDirectory({ path: sourceDir });
        if (addErrors.length > 0) {
          throw new Error(`Pagefind addDirectory failed for ${lang}: ${addErrors.join(', ')}`);
        }

        onProgress?.(progressBase + Math.floor(progressSpan * 0.7), `Writing search index for ${lang}...`);

        const { errors: writeErrors } = await index.writeFiles({ outputPath: outputDir });
        if (writeErrors.length > 0) {
          throw new Error(`Pagefind writeFiles failed for ${lang}: ${writeErrors.join(', ')}`);
        }

        results.push({ language: lang, pageCount: page_count });
      } finally {
        await index.deleteIndex();
      }
    }

    onProgress?.(100, 'Search indexes built');
    return { languageIndexes: results };
  } finally {
    await pagefind.close();
  }
}
