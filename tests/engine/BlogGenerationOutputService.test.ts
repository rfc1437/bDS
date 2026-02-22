import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
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
});
