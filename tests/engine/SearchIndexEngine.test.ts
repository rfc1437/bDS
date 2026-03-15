import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockSpawn } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
  default: { spawn: mockSpawn },
}));

function createMockProc(exitCode = 0, stdout = 'Indexed 5 pages\n', stderr = '') {
  const stdoutCbs: ((data: Buffer) => void)[] = [];
  const stderrCbs: ((data: Buffer) => void)[] = [];
  const closeCbs: ((...args: unknown[]) => void)[] = [];

  return {
    stdout: {
      on: vi.fn((_event: string, cb: (data: Buffer) => void) => {
        stdoutCbs.push(cb);
      }),
    },
    stderr: {
      on: vi.fn((_event: string, cb: (data: Buffer) => void) => {
        stderrCbs.push(cb);
      }),
    },
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'error') return;
      if (event === 'close') {
        closeCbs.push(cb);
        Promise.resolve().then(() => {
          for (const fn of stdoutCbs) fn(Buffer.from(stdout));
          for (const fn of stderrCbs) if (stderr) fn(Buffer.from(stderr));
          for (const fn of closeCbs) fn(exitCode);
        });
      }
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSpawn.mockImplementation(() => createMockProc(0, 'Indexed 5 pages\n'));
});

describe('SearchIndexEngine', () => {
  describe('buildSearchIndex', () => {
    it('spawns pagefind binary for a single language', async () => {
      const { buildSearchIndex } = await import('../../src/main/engine/SearchIndexEngine');

      const result = await buildSearchIndex({
        htmlDir: '/site/html',
        mainLanguage: 'en',
        additionalLanguages: [],
      });

      expect(mockSpawn).toHaveBeenCalledTimes(1);
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toEqual(expect.arrayContaining([
        '--site', '/site/html',
        '--force-language', 'en',
        '--output-path', '/site/html/pagefind',
      ]));
      expect(result.languageIndexes).toHaveLength(1);
      expect(result.languageIndexes[0]).toEqual({ language: 'en', pageCount: 5 });
    });

    it('spawns pagefind once per language for multilingual sites', async () => {
      const { buildSearchIndex } = await import('../../src/main/engine/SearchIndexEngine');

      const result = await buildSearchIndex({
        htmlDir: '/site/html',
        mainLanguage: 'en',
        additionalLanguages: ['de', 'fr'],
      });

      expect(mockSpawn).toHaveBeenCalledTimes(3);
      const calls = mockSpawn.mock.calls;

      expect(calls[0][1]).toContain('en');
      expect(calls[1][1]).toContain('de');
      expect(calls[2][1]).toContain('fr');

      expect(result.languageIndexes).toHaveLength(3);
    });

    it('writes per-language output to language subdirectories', async () => {
      const { buildSearchIndex } = await import('../../src/main/engine/SearchIndexEngine');

      await buildSearchIndex({
        htmlDir: '/site/html',
        mainLanguage: 'en',
        additionalLanguages: ['de'],
      });

      const calls = mockSpawn.mock.calls;

      const mainArgs = calls[0][1] as string[];
      const mainOutputIdx = mainArgs.indexOf('--output-path');
      expect(mainArgs[mainOutputIdx + 1]).toBe('/site/html/pagefind');

      const deArgs = calls[1][1] as string[];
      const deOutputIdx = deArgs.indexOf('--output-path');
      expect(deArgs[deOutputIdx + 1]).toBe('/site/html/de/pagefind');
    });

    it('throws when pagefind exits with non-zero code', async () => {
      mockSpawn.mockImplementation(() => createMockProc(1, '', 'Something went wrong'));
      const { buildSearchIndex } = await import('../../src/main/engine/SearchIndexEngine');

      await expect(buildSearchIndex({
        htmlDir: '/site/html',
        mainLanguage: 'en',
        additionalLanguages: [],
      })).rejects.toThrow('Pagefind exited with code 1');
    });

    it('parses page count from pagefind output', async () => {
      mockSpawn.mockImplementation(() => createMockProc(0, 'Running Pagefind\nIndexed 42 pages\nDone'));
      const { buildSearchIndex } = await import('../../src/main/engine/SearchIndexEngine');

      const result = await buildSearchIndex({
        htmlDir: '/site/html',
        mainLanguage: 'en',
        additionalLanguages: [],
      });

      expect(result.languageIndexes[0].pageCount).toBe(42);
    });

    it('reports progress via onProgress callback', async () => {
      const { buildSearchIndex } = await import('../../src/main/engine/SearchIndexEngine');
      const onProgress = vi.fn();

      await buildSearchIndex({
        htmlDir: '/site/html',
        mainLanguage: 'en',
        additionalLanguages: ['de'],
        onProgress,
      });

      expect(onProgress).toHaveBeenCalled();
      const calls = onProgress.mock.calls;
      expect(calls[calls.length - 1][0]).toBe(100);
    });
  });
});
