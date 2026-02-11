/**
 * MetaEngine Unit Tests
 *
 * Tests the REAL MetaEngine class with mocked dependencies.
 * Following TDD best practices: mock external dependencies, test real implementation.
 * 
 * MetaEngine manages project metadata like available tags and categories,
 * keeping them in sync between the database (derived from posts) and
 * filesystem (meta/tags.json, meta/categories.json).
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock data stores
const mockFiles = new Map<string, string>();
const mockDirs = new Set<string>();
let mockPosts: any[] = [];

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn(async (filePath: string) => {
    if (mockFiles.has(filePath)) {
      return mockFiles.get(filePath);
    }
    const err = new Error(`ENOENT: no such file or directory, open '${filePath}'`) as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    throw err;
  }),
  writeFile: vi.fn(async (filePath: string, content: string) => {
    mockFiles.set(filePath, content);
  }),
  mkdir: vi.fn(async (dirPath: string) => {
    mockDirs.add(dirPath);
  }),
  access: vi.fn(async (filePath: string) => {
    if (!mockFiles.has(filePath) && !mockDirs.has(filePath)) {
      const err = new Error(`ENOENT: no such file or directory, access '${filePath}'`) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    }
  }),
}));

// Mock electron app
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/userData'),
  },
}));

// Create chainable mock for Drizzle ORM
function createSelectChain() {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    all: vi.fn().mockImplementation(() => Promise.resolve(mockPosts)),
    get: vi.fn().mockImplementation(() => Promise.resolve(undefined)),
  };
}

const mockLocalDb = {
  select: vi.fn(() => createSelectChain()),
};

// Mock the database module
vi.mock('../../src/main/database', () => ({
  getDatabase: vi.fn(() => ({
    getLocal: vi.fn(() => mockLocalDb),
  })),
}));

// Import after mocks are set up
import { MetaEngine } from '../../src/main/engine/MetaEngine';
import * as fs from 'fs/promises';

describe('MetaEngine', () => {
  let metaEngine: MetaEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFiles.clear();
    mockDirs.clear();
    mockPosts = [];
    metaEngine = new MetaEngine();
    metaEngine.setProjectContext('test-project');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Project Context', () => {
    it('should set and get project context', () => {
      metaEngine.setProjectContext('my-project');
      expect(metaEngine.getProjectContext()).toBe('my-project');
    });

    it('should return correct meta directory path', () => {
      metaEngine.setProjectContext('blog-project');
      const metaDir = metaEngine.getMetaDir();
      expect(metaDir).toContain('projects');
      expect(metaDir).toContain('blog-project');
      expect(metaDir).toContain('meta');
    });
  });

  describe('Tags Management', () => {
    it('should return empty array when no tags exist', async () => {
      const tags = await metaEngine.getTags();
      expect(tags).toEqual([]);
    });

    it('should add a new tag', async () => {
      await metaEngine.addTag('javascript');
      const tags = await metaEngine.getTags();
      expect(tags).toContain('javascript');
    });

    it('should not add duplicate tags', async () => {
      await metaEngine.addTag('typescript');
      await metaEngine.addTag('typescript');
      const tags = await metaEngine.getTags();
      expect(tags.filter(t => t === 'typescript')).toHaveLength(1);
    });

    it('should remove a tag', async () => {
      await metaEngine.addTag('react');
      await metaEngine.addTag('vue');
      await metaEngine.removeTag('react');
      const tags = await metaEngine.getTags();
      expect(tags).not.toContain('react');
      expect(tags).toContain('vue');
    });

    it('should persist tags to filesystem', async () => {
      await metaEngine.addTag('node');
      await metaEngine.saveTags();
      
      const metaDir = metaEngine.getMetaDir();
      const tagsPath = `${metaDir}\\tags.json`;
      expect(mockFiles.has(tagsPath) || mockFiles.has(tagsPath.replace(/\\/g, '/'))).toBe(true);
    });

    it('should load tags from filesystem', async () => {
      const metaDir = metaEngine.getMetaDir();
      const tagsPath = `${metaDir}\\tags.json`;
      mockFiles.set(tagsPath, JSON.stringify(['saved-tag-1', 'saved-tag-2']));
      
      await metaEngine.loadTags();
      const tags = await metaEngine.getTags();
      expect(tags).toContain('saved-tag-1');
      expect(tags).toContain('saved-tag-2');
    });
  });

  describe('Categories Management', () => {
    it('should return empty array when no categories exist', async () => {
      const categories = await metaEngine.getCategories();
      expect(categories).toEqual([]);
    });

    it('should add a new category', async () => {
      await metaEngine.addCategory('tutorials');
      const categories = await metaEngine.getCategories();
      expect(categories).toContain('tutorials');
    });

    it('should not add duplicate categories', async () => {
      await metaEngine.addCategory('news');
      await metaEngine.addCategory('news');
      const categories = await metaEngine.getCategories();
      expect(categories.filter(c => c === 'news')).toHaveLength(1);
    });

    it('should remove a category', async () => {
      await metaEngine.addCategory('reviews');
      await metaEngine.addCategory('guides');
      await metaEngine.removeCategory('reviews');
      const categories = await metaEngine.getCategories();
      expect(categories).not.toContain('reviews');
      expect(categories).toContain('guides');
    });

    it('should persist categories to filesystem', async () => {
      await metaEngine.addCategory('tech');
      await metaEngine.saveCategories();
      
      const metaDir = metaEngine.getMetaDir();
      const catPath = `${metaDir}\\categories.json`;
      expect(mockFiles.has(catPath) || mockFiles.has(catPath.replace(/\\/g, '/'))).toBe(true);
    });

    it('should load categories from filesystem', async () => {
      const metaDir = metaEngine.getMetaDir();
      const catPath = `${metaDir}\\categories.json`;
      mockFiles.set(catPath, JSON.stringify(['cat-1', 'cat-2']));
      
      await metaEngine.loadCategories();
      const categories = await metaEngine.getCategories();
      expect(categories).toContain('cat-1');
      expect(categories).toContain('cat-2');
    });
  });

  describe('Sync on Startup', () => {
    it('should export tags from posts to file if file does not exist', async () => {
      // Setup: posts have tags but no meta file exists
      mockPosts = [
        { tags: JSON.stringify(['tag1', 'tag2']) },
        { tags: JSON.stringify(['tag2', 'tag3']) },
      ];
      
      await metaEngine.syncOnStartup();
      
      const tags = await metaEngine.getTags();
      expect(tags).toContain('tag1');
      expect(tags).toContain('tag2');
      expect(tags).toContain('tag3');
    });

    it('should export categories from posts to file if file does not exist', async () => {
      mockPosts = [
        { categories: JSON.stringify(['cat1', 'cat2']) },
        { categories: JSON.stringify(['cat2', 'cat3']) },
      ];
      
      await metaEngine.syncOnStartup();
      
      const categories = await metaEngine.getCategories();
      expect(categories).toContain('cat1');
      expect(categories).toContain('cat2');
      expect(categories).toContain('cat3');
    });

    it('should merge file tags with database tags', async () => {
      // File has some tags
      const metaDir = metaEngine.getMetaDir();
      mockFiles.set(`${metaDir}\\tags.json`, JSON.stringify(['file-tag']));
      
      // Posts have different tags
      mockPosts = [
        { tags: JSON.stringify(['db-tag']) },
      ];
      
      await metaEngine.syncOnStartup();
      
      const tags = await metaEngine.getTags();
      expect(tags).toContain('file-tag');
      expect(tags).toContain('db-tag');
    });

    it('should merge file categories with database categories', async () => {
      const metaDir = metaEngine.getMetaDir();
      mockFiles.set(`${metaDir}\\categories.json`, JSON.stringify(['file-cat']));
      
      mockPosts = [
        { categories: JSON.stringify(['db-cat']) },
      ];
      
      await metaEngine.syncOnStartup();
      
      const categories = await metaEngine.getCategories();
      expect(categories).toContain('file-cat');
      expect(categories).toContain('db-cat');
    });

    it('should create meta directory if it does not exist', async () => {
      mockPosts = [{ tags: JSON.stringify(['test']), categories: JSON.stringify([]) }];
      
      await metaEngine.syncOnStartup();
      
      expect(fs.mkdir).toHaveBeenCalled();
    });

    it('should save merged results back to file', async () => {
      const metaDir = metaEngine.getMetaDir();
      mockFiles.set(`${metaDir}\\tags.json`, JSON.stringify(['existing']));
      mockPosts = [{ tags: JSON.stringify(['new-from-db']), categories: JSON.stringify([]) }];
      
      await metaEngine.syncOnStartup();
      
      expect(fs.writeFile).toHaveBeenCalled();
    });
  });

  describe('Tags/Categories from Posts', () => {
    it('should collect all unique tags from posts', async () => {
      mockPosts = [
        { tags: JSON.stringify(['a', 'b']) },
        { tags: JSON.stringify(['b', 'c']) },
        { tags: JSON.stringify(['c', 'd']) },
      ];
      
      const tags = await metaEngine.collectTagsFromPosts();
      expect(tags).toEqual(['a', 'b', 'c', 'd']);
    });

    it('should collect all unique categories from posts', async () => {
      mockPosts = [
        { categories: JSON.stringify(['x', 'y']) },
        { categories: JSON.stringify(['y', 'z']) },
      ];
      
      const categories = await metaEngine.collectCategoriesFromPosts();
      expect(categories).toEqual(['x', 'y', 'z']);
    });

    it('should handle posts with null/empty tags', async () => {
      mockPosts = [
        { tags: null },
        { tags: '' },
        { tags: JSON.stringify(['valid']) },
      ];
      
      const tags = await metaEngine.collectTagsFromPosts();
      expect(tags).toEqual(['valid']);
    });

    it('should handle posts with null/empty categories', async () => {
      mockPosts = [
        { categories: null },
        { categories: '' },
        { categories: JSON.stringify(['valid']) },
      ];
      
      const categories = await metaEngine.collectCategoriesFromPosts();
      expect(categories).toEqual(['valid']);
    });
  });

  describe('Event Emission', () => {
    it('should emit tagsChanged event when tags are modified', async () => {
      const handler = vi.fn();
      metaEngine.on('tagsChanged', handler);
      
      await metaEngine.addTag('new-tag');
      
      expect(handler).toHaveBeenCalledWith(expect.arrayContaining(['new-tag']));
    });

    it('should emit categoriesChanged event when categories are modified', async () => {
      const handler = vi.fn();
      metaEngine.on('categoriesChanged', handler);
      
      await metaEngine.addCategory('new-category');
      
      expect(handler).toHaveBeenCalledWith(expect.arrayContaining(['new-category']));
    });
  });
});
