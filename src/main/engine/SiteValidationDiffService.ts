import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface SiteValidationDiffResult {
  missingUrlPaths: string[];
  extraUrlPaths: string[];
  expectedUrlCount: number;
  existingHtmlUrlCount: number;
}

interface CompareSitemapToHtmlParams {
  sitemapXml: string;
  baseUrl: string;
  htmlDir: string;
}

function normalizeUrlPath(urlPath: string): string {
  const trimmed = (urlPath || '').trim();
  if (!trimmed || trimmed === '/') {
    return '/';
  }

  const noQuery = trimmed.split('?')[0]?.split('#')[0] ?? '';
  const withoutSlashes = noQuery.replace(/^\/+|\/+$/g, '');
  return withoutSlashes ? `/${withoutSlashes}` : '/';
}

function sitemapLocToProjectPath(loc: string, baseUrl: string): string {
  try {
    const locUrl = new URL(loc);
    const base = new URL(baseUrl);
    const locPath = locUrl.pathname.replace(/\/+$/, '');
    const basePath = base.pathname.replace(/\/+$/, '');

    if (basePath && locPath.startsWith(basePath)) {
      const stripped = locPath.slice(basePath.length);
      return normalizeUrlPath(stripped || '/');
    }

    return normalizeUrlPath(locPath || '/');
  } catch {
    return normalizeUrlPath(loc);
  }
}

function extractSitemapLocs(sitemapXml: string): string[] {
  const matches = sitemapXml.matchAll(/<loc>(.*?)<\/loc>/g);
  const locs: string[] = [];
  for (const match of matches) {
    const value = match[1]?.trim();
    if (value) {
      locs.push(value);
    }
  }
  return locs;
}

async function collectHtmlIndexPaths(htmlDir: string): Promise<Set<string>> {
  const existingHtmlPathSet = new Set<string>();

  const collectIndexPaths = async (dir: string, relativePrefix = ''): Promise<void> => {
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true, encoding: 'utf8' });
    } catch {
      return;
    }

    for (const entry of entries) {
      const nextRelative = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
      const nextPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await collectIndexPaths(nextPath, nextRelative);
        continue;
      }

      if (!entry.isFile() || entry.name !== 'index.html') {
        continue;
      }

      const normalizedRelative = nextRelative.replace(/(^|\/)index\.html$/, '');
      existingHtmlPathSet.add(normalizeUrlPath(normalizedRelative ? `/${normalizedRelative}` : '/'));
    }
  };

  await collectIndexPaths(htmlDir);
  return existingHtmlPathSet;
}

export async function compareSitemapToHtml(params: CompareSitemapToHtmlParams): Promise<SiteValidationDiffResult> {
  const expectedPathSet = new Set(
    extractSitemapLocs(params.sitemapXml)
      .map((loc) => sitemapLocToProjectPath(loc, params.baseUrl))
      .map((value) => normalizeUrlPath(value)),
  );

  const existingHtmlPathSet = await collectHtmlIndexPaths(params.htmlDir);

  const missingUrlPaths = Array.from(expectedPathSet)
    .filter((value) => !existingHtmlPathSet.has(value))
    .sort();

  const extraUrlPaths = Array.from(existingHtmlPathSet)
    .filter((value) => !expectedPathSet.has(value))
    .sort();

  return {
    missingUrlPaths,
    extraUrlPaths,
    expectedUrlCount: expectedPathSet.size,
    existingHtmlUrlCount: existingHtmlPathSet.size,
  };
}
