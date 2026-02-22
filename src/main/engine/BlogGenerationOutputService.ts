import * as crypto from 'node:crypto';
import * as fs from 'fs/promises';
import * as path from 'node:path';
import { getGeneratedFileHash, setGeneratedFileHash } from '../database/generatedFileHashStore';
import { PREVIEW_ASSETS, PREVIEW_IMAGE_ASSETS } from './PageRenderer';

type PreviewAssetMap = Record<string, { contentType: string; modulePath?: string; sourceText?: string }>;
type PreviewImageAssetMap = Record<string, { modulePath: string; contentType: string }>;

function toBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) {
    return value;
  }

  if (typeof value === 'string') {
    return Buffer.from(value, 'utf-8');
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }

  return Buffer.alloc(0);
}

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

export function computeBufferHash(content: Buffer): string {
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

export async function copyPreviewAssets(htmlDir: string, options?: {
  projectId?: string;
  hashCache?: Map<string, string | null>;
  previewAssets?: PreviewAssetMap;
  previewImageAssets?: PreviewImageAssetMap;
  readModuleFile?: (modulePath: string) => Promise<Buffer>;
  getGeneratedFileHash?: (projectId: string, relativePath: string) => Promise<string | null>;
  setGeneratedFileHash?: (projectId: string, relativePath: string, hash: string) => Promise<void>;
}): Promise<void> {
  const assetsDir = path.join(htmlDir, 'assets');
  const imagesDir = path.join(htmlDir, 'images');
  await fs.mkdir(assetsDir, { recursive: true });
  await fs.mkdir(imagesDir, { recursive: true });

  const projectId = options?.projectId;
  const hashCache = options?.hashCache;
  const readModuleFile = options?.readModuleFile ?? (async (modulePath: string) => toBuffer(await fs.readFile(require.resolve(modulePath))));
  const getHash = options?.getGeneratedFileHash ?? getGeneratedFileHash;
  const setHash = options?.setGeneratedFileHash ?? setGeneratedFileHash;
  const previewAssets = options?.previewAssets ?? PREVIEW_ASSETS;
  const previewImageAssets = options?.previewImageAssets ?? PREVIEW_IMAGE_ASSETS;

  const writeBinaryIfHashChanged = async (filePath: string, relativePath: string, content: Buffer): Promise<void> => {
    if (!projectId) {
      await fs.writeFile(filePath, content);
      return;
    }

    const hash = computeBufferHash(content);
    let previousHash: string | null;
    if (hashCache && hashCache.has(relativePath)) {
      previousHash = hashCache.get(relativePath) ?? null;
    } else {
      previousHash = await getHash(projectId, relativePath);
      hashCache?.set(relativePath, previousHash);
    }

    if (previousHash === hash) {
      return;
    }

    await fs.writeFile(filePath, content);
    await setHash(projectId, relativePath, hash);
    hashCache?.set(relativePath, hash);
  };

  for (const [filename, definition] of Object.entries(previewAssets)) {
    const destPath = path.join(assetsDir, filename);
    const relativePath = path.posix.join('assets', filename);
    const content = definition.sourceText !== undefined
      ? Buffer.from(definition.sourceText, 'utf-8')
      : toBuffer(await readModuleFile(definition.modulePath as string));

    await writeBinaryIfHashChanged(destPath, relativePath, content);
  }

  for (const [filename, definition] of Object.entries(previewImageAssets)) {
    const destPath = path.join(imagesDir, filename);
    const relativePath = path.posix.join('images', filename);
    const content = toBuffer(await readModuleFile(definition.modulePath));

    await writeBinaryIfHashChanged(destPath, relativePath, content);
  }
}
