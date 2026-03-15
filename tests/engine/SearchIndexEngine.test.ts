import { describe, expect, it, vi, beforeEach } from 'vitest';
import { buildSearchIndex } from '../../src/main/engine/SearchIndexEngine';

// Mock pagefind module
const mockDeleteIndex = vi.fn().mockResolvedValue(null);
const mockAddDirectory = vi.fn().mockResolvedValue({ errors: [], page_count: 5 });
const mockWriteFiles = vi.fn().mockResolvedValue({ errors: [], outputPath: '/out/pagefind' });
const mockIndex = {
  addDirectory: mockAddDirectory,
  writeFiles: mockWriteFiles,
  deleteIndex: mockDeleteIndex,
};
const mockCreateIndex = vi.fn().mockResolvedValue({ errors: [], index: mockIndex });
const mockClose = vi.fn().mockResolvedValue(null);

vi.mock('pagefind', () => ({
  createIndex: (...args: unknown[]) => mockCreateIndex(...args),
  close: (...args: unknown[]) => mockClose(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateIndex.mockResolvedValue({ errors: [], index: mockIndex });
  mockAddDirectory.mockResolvedValue({ errors: [], page_count: 5 });
  mockWriteFiles.mockResolvedValue({ errors: [], outputPath: '/out/pagefind' });
});

describe('SearchIndexEngine', () => {
  describe('buildSearchIndex', () => {
    it('creates a pagefind index for a single language', async () => {
      const result = await buildSearchIndex({
        htmlDir: '/site/html',
        mainLanguage: 'en',
        additionalLanguages: [],
      });

      expect(mockCreateIndex).toHaveBeenCalledTimes(1);
      expect(mockCreateIndex).toHaveBeenCalledWith({ forceLanguage: 'en' });
      expect(mockAddDirectory).toHaveBeenCalledWith({ path: '/site/html' });
      expect(mockWriteFiles).toHaveBeenCalledWith({ outputPath: '/site/html/pagefind' });
      expect(mockDeleteIndex).toHaveBeenCalled();
      expect(result.languageIndexes).toHaveLength(1);
      expect(result.languageIndexes[0]).toEqual({ language: 'en', pageCount: 5 });
    });

    it('creates per-language indexes for multilingual sites', async () => {
      mockAddDirectory
        .mockResolvedValueOnce({ errors: [], page_count: 10 })
        .mockResolvedValueOnce({ errors: [], page_count: 3 })
        .mockResolvedValueOnce({ errors: [], page_count: 4 });

      const result = await buildSearchIndex({
        htmlDir: '/site/html',
        mainLanguage: 'en',
        additionalLanguages: ['de', 'fr'],
      });

      // Main language index: indexes root html dir
      expect(mockCreateIndex).toHaveBeenCalledTimes(3);
      expect(mockCreateIndex).toHaveBeenNthCalledWith(1, { forceLanguage: 'en' });
      expect(mockCreateIndex).toHaveBeenNthCalledWith(2, { forceLanguage: 'de' });
      expect(mockCreateIndex).toHaveBeenNthCalledWith(3, { forceLanguage: 'fr' });

      // Main lang indexes root, additional langs index their subdirectory
      expect(mockAddDirectory).toHaveBeenNthCalledWith(1, { path: '/site/html' });
      expect(mockAddDirectory).toHaveBeenNthCalledWith(2, { path: '/site/html/de' });
      expect(mockAddDirectory).toHaveBeenNthCalledWith(3, { path: '/site/html/fr' });

      // Each writes to its own pagefind directory
      expect(mockWriteFiles).toHaveBeenNthCalledWith(1, { outputPath: '/site/html/pagefind' });
      expect(mockWriteFiles).toHaveBeenNthCalledWith(2, { outputPath: '/site/html/de/pagefind' });
      expect(mockWriteFiles).toHaveBeenNthCalledWith(3, { outputPath: '/site/html/fr/pagefind' });

      expect(result.languageIndexes).toHaveLength(3);
      expect(result.languageIndexes[0]).toEqual({ language: 'en', pageCount: 10 });
      expect(result.languageIndexes[1]).toEqual({ language: 'de', pageCount: 3 });
      expect(result.languageIndexes[2]).toEqual({ language: 'fr', pageCount: 4 });
    });

    it('calls close() after indexing', async () => {
      await buildSearchIndex({
        htmlDir: '/site/html',
        mainLanguage: 'en',
        additionalLanguages: [],
      });

      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it('calls close() even when indexing fails', async () => {
      mockCreateIndex.mockResolvedValue({ errors: ['failed'], index: undefined });

      await expect(buildSearchIndex({
        htmlDir: '/site/html',
        mainLanguage: 'en',
        additionalLanguages: [],
      })).rejects.toThrow('failed');

      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it('throws when createIndex returns errors', async () => {
      mockCreateIndex.mockResolvedValue({ errors: ['some error'], index: undefined });

      await expect(buildSearchIndex({
        htmlDir: '/site/html',
        mainLanguage: 'en',
        additionalLanguages: [],
      })).rejects.toThrow('some error');
    });

    it('throws when addDirectory returns errors', async () => {
      mockAddDirectory.mockResolvedValue({ errors: ['dir error'], page_count: 0 });

      await expect(buildSearchIndex({
        htmlDir: '/site/html',
        mainLanguage: 'en',
        additionalLanguages: [],
      })).rejects.toThrow('dir error');
    });

    it('throws when writeFiles returns errors', async () => {
      mockWriteFiles.mockResolvedValue({ errors: ['write error'], outputPath: '' });

      await expect(buildSearchIndex({
        htmlDir: '/site/html',
        mainLanguage: 'en',
        additionalLanguages: [],
      })).rejects.toThrow('write error');
    });

    it('reports progress via onProgress callback', async () => {
      const onProgress = vi.fn();

      await buildSearchIndex({
        htmlDir: '/site/html',
        mainLanguage: 'en',
        additionalLanguages: ['de'],
        onProgress,
      });

      expect(onProgress).toHaveBeenCalled();
      // First call should be 0% or low, last should be 100%
      const calls = onProgress.mock.calls;
      expect(calls[calls.length - 1][0]).toBe(100);
    });
  });
});
