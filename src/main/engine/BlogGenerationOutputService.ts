import * as crypto from 'node:crypto';
import * as fs from 'fs/promises';
import * as path from 'node:path';
import { getGeneratedFileHash, setGeneratedFileHash } from '../database/generatedFileHashStore';
import { PREVIEW_ASSETS, PREVIEW_IMAGE_ASSETS } from './PageRenderer';

export function normalizeGeneratedUrlPath(urlPath: string): string {
  const trimmed = (urlPath || '').trim();
  if (!trimmed || trimmed === '/') {
    return '/';
  }

  const noQuery = trimmed.split('?')[0]?.split('#')[0] ?? '';
  const withoutSlashes = noQuery.replace(/^\/+|\/+$/g, '');
  return withoutSlashes ? `/${withoutSlashes}` : '/';
}

export function urlPathToHtmlIndexPath(htmlDir: string, urlPath: string): string {
  const normalizedPath = normalizeGeneratedUrlPath(urlPath);
  if (normalizedPath === '/') {
    return path.join(htmlDir, 'index.html');
  }

  return path.join(htmlDir, normalizedPath.slice(1), 'index.html');
}

export function computeContentHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export async function writeFileIfHashChanged(params: {
  projectId: string;
  filePath: string;
  relativePath: string;
  content: string;
  hashCache?: Map<string, string | null>;
  getGeneratedFileHash?: (projectId: string, relativePath: string) => Promise<string | null>;
  setGeneratedFileHash?: (projectId: string, relativePath: string, hash: string) => Promise<void>;
  computeHash?: (content: string) => string;
}): Promise<boolean> {
  const getHash = params.getGeneratedFileHash ?? getGeneratedFileHash;
  const setHash = params.setGeneratedFileHash ?? setGeneratedFileHash;
  const hashFn = params.computeHash ?? computeContentHash;

  const hash = hashFn(params.content);
  let previousHash: string | null;
  if (params.hashCache && params.hashCache.has(params.relativePath)) {
    previousHash = params.hashCache.get(params.relativePath) ?? null;
  } else {
    previousHash = await getHash(params.projectId, params.relativePath);
    params.hashCache?.set(params.relativePath, previousHash);
  }

  if (previousHash === hash) {
    return false;
  }

  await fs.writeFile(params.filePath, params.content, 'utf-8');
  await setHash(params.projectId, params.relativePath, hash);
  params.hashCache?.set(params.relativePath, hash);
  return true;
}

export async function writeHtmlPage(params: {
  projectId: string;
  htmlDir: string;
  urlPath: string;
  content: string;
  knownDirectories?: Set<string>;
  hashCache?: Map<string, string | null>;
  ensureDirectory?: (dirPath: string) => Promise<void>;
  getGeneratedFileHash?: (projectId: string, relativePath: string) => Promise<string | null>;
  setGeneratedFileHash?: (projectId: string, relativePath: string, hash: string) => Promise<void>;
  computeHash?: (content: string) => string;
}): Promise<boolean> {
  const normalizedPath = params.urlPath.replace(/^\//, '');
  const filePath = normalizedPath
    ? path.join(params.htmlDir, normalizedPath, 'index.html')
    : path.join(params.htmlDir, 'index.html');
  const relativePath = normalizedPath ? `${normalizedPath}/index.html` : 'index.html';
  const directoryPath = path.dirname(filePath);
  const ensureDirectory = params.ensureDirectory ?? (async (dirPath: string) => {
    await fs.mkdir(dirPath, { recursive: true });
  });

  if (params.knownDirectories) {
    if (!params.knownDirectories.has(directoryPath)) {
      await ensureDirectory(directoryPath);
      params.knownDirectories.add(directoryPath);
    }
  } else {
    await ensureDirectory(directoryPath);
  }

  return writeFileIfHashChanged({
    projectId: params.projectId,
    filePath,
    relativePath,
    content: params.content,
    hashCache: params.hashCache,
    getGeneratedFileHash: params.getGeneratedFileHash,
    setGeneratedFileHash: params.setGeneratedFileHash,
    computeHash: params.computeHash,
  });
}

export async function copyPreviewAssets(htmlDir: string): Promise<void> {
  const assetsDir = path.join(htmlDir, 'assets');
  const imagesDir = path.join(htmlDir, 'images');
  await fs.mkdir(assetsDir, { recursive: true });
  await fs.mkdir(imagesDir, { recursive: true });

  for (const [filename, definition] of Object.entries(PREVIEW_ASSETS)) {
    const destPath = path.join(assetsDir, filename);
    const content = definition.sourceText !== undefined
      ? Buffer.from(definition.sourceText, 'utf-8')
      : await fs.readFile(require.resolve(definition.modulePath as string));
    await fs.writeFile(destPath, content);
  }

  for (const [filename, definition] of Object.entries(PREVIEW_IMAGE_ASSETS)) {
    const sourcePath = require.resolve(definition.modulePath);
    const destPath = path.join(imagesDir, filename);
    const content = await fs.readFile(sourcePath);
    await fs.writeFile(destPath, content);
  }
}
