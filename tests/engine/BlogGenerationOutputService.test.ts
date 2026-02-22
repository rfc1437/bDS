import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  copyPreviewAssets,
  normalizeGeneratedUrlPath,
  urlPathToHtmlIndexPath,
  writeFileIfHashChanged,
  writeHtmlPage,
} from '../../src/main/engine/BlogGenerationOutputService';

function makeTempName(): string {
  return `bds-generation-output-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

describe('BlogGenerationOutputService', () => {
  it('normalizes URL paths and maps them to html index file paths', () => {
    expect(normalizeGeneratedUrlPath('')).toBe('/');
    expect(normalizeGeneratedUrlPath('/a/b/')).toBe('/a/b');
    expect(urlPathToHtmlIndexPath('/tmp/html', '/')).toBe('/tmp/html/index.html');
    expect(urlPathToHtmlIndexPath('/tmp/html', '/a/b')).toBe('/tmp/html/a/b/index.html');
  });

  it('writes only when generated hash changes', async () => {
    const tempRoot = path.join('/tmp', makeTempName());
    await mkdir(tempRoot, { recursive: true });
    const filePath = path.join(tempRoot, 'a.txt');

    const getHash = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('same-hash');
    const setHash = vi.fn().mockResolvedValue(undefined);
    const hashFn = vi.fn().mockReturnValue('same-hash');

    const changed = await writeFileIfHashChanged({
      projectId: 'p',
      filePath,
      relativePath: 'a.txt',
      content: 'hello',
      getGeneratedFileHash: getHash,
      setGeneratedFileHash: setHash,
      computeHash: hashFn,
    });

    const unchanged = await writeFileIfHashChanged({
      projectId: 'p',
      filePath,
      relativePath: 'a.txt',
      content: 'hello',
      getGeneratedFileHash: getHash,
      setGeneratedFileHash: setHash,
      computeHash: hashFn,
    });

    expect(changed).toBe(true);
    expect(unchanged).toBe(false);
    expect(await readFile(filePath, 'utf-8')).toBe('hello');
  });

  it('writes html pages under index.html route directories', async () => {
    const tempRoot = path.join('/tmp', makeTempName());
    const htmlDir = path.join(tempRoot, 'html');
    await mkdir(htmlDir, { recursive: true });

    await writeHtmlPage({
      projectId: 'p',
      htmlDir,
      urlPath: 'section/page',
      content: '<html/>',
      getGeneratedFileHash: async () => null,
      setGeneratedFileHash: async () => undefined,
      computeHash: () => 'h',
    });

    const saved = await readFile(path.join(htmlDir, 'section', 'page', 'index.html'), 'utf-8');
    expect(saved).toBe('<html/>');
  });

  it('reuses in-run hash cache to avoid repeated hash reads for same file', async () => {
    const tempRoot = path.join('/tmp', makeTempName());
    await mkdir(tempRoot, { recursive: true });
    const filePath = path.join(tempRoot, 'cached.txt');
    const hashCache = new Map<string, string | null>();

    const getHash = vi.fn().mockResolvedValue(null);
    const setHash = vi.fn().mockResolvedValue(undefined);
    const hashFn = vi.fn().mockReturnValue('h1');

    await writeFileIfHashChanged({
      projectId: 'p',
      filePath,
      relativePath: 'cached.txt',
      content: 'hello',
      getGeneratedFileHash: getHash,
      setGeneratedFileHash: setHash,
      computeHash: hashFn,
      hashCache,
    });

    await writeFileIfHashChanged({
      projectId: 'p',
      filePath,
      relativePath: 'cached.txt',
      content: 'hello',
      getGeneratedFileHash: getHash,
      setGeneratedFileHash: setHash,
      computeHash: hashFn,
      hashCache,
    });

    expect(getHash).toHaveBeenCalledTimes(1);
  });

  it('avoids repeated directory ensure calls when known directory cache is provided', async () => {
    const tempRoot = path.join('/tmp', makeTempName());
    const htmlDir = path.join(tempRoot, 'html');
    await mkdir(htmlDir, { recursive: true });

    const ensureDirectory = vi.fn(async (dirPath: string) => {
      await mkdir(dirPath, { recursive: true });
    });

    const knownDirectories = new Set<string>();

    await writeHtmlPage({
      projectId: 'p',
      htmlDir,
      urlPath: 'section/page',
      content: '<html/>',
      getGeneratedFileHash: async () => null,
      setGeneratedFileHash: async () => undefined,
      computeHash: () => 'h',
      ensureDirectory,
      knownDirectories,
    });

    await writeHtmlPage({
      projectId: 'p',
      htmlDir,
      urlPath: 'section/page',
      content: '<html/>',
      getGeneratedFileHash: async () => 'h',
      setGeneratedFileHash: async () => undefined,
      computeHash: () => 'h',
      ensureDirectory,
      knownDirectories,
    });

    expect(ensureDirectory).toHaveBeenCalledTimes(1);
  });

  it('copies preview assets with hash checks so unchanged files are not rewritten', async () => {
    const tempRoot = path.join('/tmp', makeTempName());
    const htmlDir = path.join(tempRoot, 'html');
    await mkdir(htmlDir, { recursive: true });

    const hashStore = new Map<string, string>();
    const getHash = vi.fn(async (_projectId: string, relativePath: string) => hashStore.get(relativePath) ?? null);
    const setHash = vi.fn(async (_projectId: string, relativePath: string, hash: string) => {
      hashStore.set(relativePath, hash);
    });

    const hashCache = new Map<string, string | null>();

    await copyPreviewAssets(htmlDir, {
      projectId: 'project-a',
      hashCache,
      previewAssets: {
        'runtime.js': {
          contentType: 'application/javascript; charset=utf-8',
          sourceText: 'console.log("runtime");',
        },
      },
      previewImageAssets: {
        'pixel.png': {
          modulePath: 'virtual:pixel.png',
          contentType: 'image/png',
        },
      },
      readModuleFile: async (modulePath: string) => {
        if (modulePath === 'virtual:pixel.png') {
          return Buffer.from([0, 1, 2, 3]);
        }
        throw new Error(`Unexpected module path: ${modulePath}`);
      },
      getGeneratedFileHash: getHash,
      setGeneratedFileHash: setHash,
    });

    await copyPreviewAssets(htmlDir, {
      projectId: 'project-a',
      hashCache,
      previewAssets: {
        'runtime.js': {
          contentType: 'application/javascript; charset=utf-8',
          sourceText: 'console.log("runtime");',
        },
      },
      previewImageAssets: {
        'pixel.png': {
          modulePath: 'virtual:pixel.png',
          contentType: 'image/png',
        },
      },
      readModuleFile: async (modulePath: string) => {
        if (modulePath === 'virtual:pixel.png') {
          return Buffer.from([0, 1, 2, 3]);
        }
        throw new Error(`Unexpected module path: ${modulePath}`);
      },
      getGeneratedFileHash: getHash,
      setGeneratedFileHash: setHash,
    });

    expect(setHash).toHaveBeenCalledTimes(2);
    expect(await readFile(path.join(htmlDir, 'assets', 'runtime.js'), 'utf-8')).toBe('console.log("runtime");');
    const imageContent = await readFile(path.join(htmlDir, 'images', 'pixel.png'));
    expect(Array.from(imageContent)).toEqual([0, 1, 2, 3]);
  });
});
