import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface SiteValidationDiffResult {
  missingUrlPaths: string[];
  extraUrlPaths: string[];
  updatedPostUrlPaths: string[];
  expectedUrlCount: number;
  existingHtmlUrlCount: number;
}

export interface PostTimestampCheck {
  postUrlPath: string;
  postFilePath: string;
  generatedUpdatedAtMs?: number;
}

interface CompareSitemapToHtmlParams {
  sitemapXml: string;
  baseUrl: string;
  htmlDir: string;
  postTimestampChecks?: PostTimestampCheck[];
  additionalExpectedPaths?: string[];
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

async function collectHtmlIndexPaths(htmlDir: string): Promise<{
  existingHtmlPathSet: Set<string>;
  zeroByteHtmlPathSet: Set<string>;
}> {
  const existingHtmlPathSet = new Set<string>();
  const zeroByteHtmlPathSet = new Set<string>();

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
      const normalizedUrlPath = normalizeUrlPath(normalizedRelative ? `/${normalizedRelative}` : '/');

      try {
        const stats = await fs.stat(nextPath);
        if (stats.size <= 0) {
          zeroByteHtmlPathSet.add(normalizedUrlPath);
          continue;
        }
      } catch {
        zeroByteHtmlPathSet.add(normalizedUrlPath);
        continue;
      }

      existingHtmlPathSet.add(normalizedUrlPath);
    }
  };

  await collectIndexPaths(htmlDir);
  return {
    existingHtmlPathSet,
    zeroByteHtmlPathSet,
  };
}

export async function compareSitemapToHtml(params: CompareSitemapToHtmlParams): Promise<SiteValidationDiffResult> {
  const expectedPathSet = new Set(
    extractSitemapLocs(params.sitemapXml)
      .map((loc) => sitemapLocToProjectPath(loc, params.baseUrl))
      .map((value) => normalizeUrlPath(value)),
  );

  if (Array.isArray(params.additionalExpectedPaths)) {
    for (const p of params.additionalExpectedPaths) {
      expectedPathSet.add(normalizeUrlPath(p));
    }
  }

  const { existingHtmlPathSet, zeroByteHtmlPathSet } = await collectHtmlIndexPaths(params.htmlDir);

  const missingUrlPaths = Array.from(expectedPathSet)
    .filter((value) => !existingHtmlPathSet.has(value))
    .sort();

  const extraUrlPaths = Array.from(existingHtmlPathSet)
    .filter((value) => !expectedPathSet.has(value))
    .concat(Array.from(zeroByteHtmlPathSet).filter((value) => !expectedPathSet.has(value)))
    .filter((value, index, array) => array.indexOf(value) === index)
    .sort();

  const updatedPostPathSet = new Set<string>();
  const postTimestampChecks = Array.isArray(params.postTimestampChecks) ? params.postTimestampChecks : [];
  for (const check of postTimestampChecks) {
    const normalizedPostUrlPath = normalizeUrlPath(check.postUrlPath);
    if (!expectedPathSet.has(normalizedPostUrlPath)) {
      continue;
    }

    if (missingUrlPaths.includes(normalizedPostUrlPath)) {
      continue;
    }

    const htmlPath = path.join(params.htmlDir, normalizedPostUrlPath === '/' ? 'index.html' : normalizedPostUrlPath.slice(1), 'index.html');

    let htmlStat: Awaited<ReturnType<typeof fs.stat>>;
    let postStat: Awaited<ReturnType<typeof fs.stat>>;

    try {
      htmlStat = await fs.stat(htmlPath);
      postStat = await fs.stat(check.postFilePath);
    } catch {
      continue;
    }

    const generatedUpdatedAtMs = typeof check.generatedUpdatedAtMs === 'number'
      ? check.generatedUpdatedAtMs
      : 0;
    const effectiveGeneratedAtMs = Math.max(htmlStat.mtimeMs, generatedUpdatedAtMs);

    if (postStat.mtimeMs > effectiveGeneratedAtMs) {
      updatedPostPathSet.add(normalizedPostUrlPath);
    }
  }

  const updatedPostUrlPaths = Array.from(updatedPostPathSet.values()).sort();

  return {
    missingUrlPaths,
    extraUrlPaths,
    updatedPostUrlPaths,
    expectedUrlCount: expectedPathSet.size,
    existingHtmlUrlCount: existingHtmlPathSet.size,
  };
}
