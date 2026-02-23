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
import * as path from 'path';

// Mock data stores
const mockFiles = new Map<string, string>();
const mockDirs = new Set<string>();
let mockPosts: any[] = [];
let mockProject: any = null;

// Helper to normalize paths (handle both Windows and Unix separators)
const normalizePath = (p: string): string => p.replace(/\\/g, '/');

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn(async (filePath: string) => {
    const normalizedPath = filePath.replace(/\\/g, '/');
    if (mockFiles.has(normalizedPath)) {
      return mockFiles.get(normalizedPath);
    }
    const err = new Error(`ENOENT: no such file or directory, open '${filePath}'`) as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    throw err;
  }),
  writeFile: vi.fn(async (filePath: string, content: string) => {
    const normalizedPath = filePath.replace(/\\/g, '/');
    mockFiles.set(normalizedPath, content);
  }),
  mkdir: vi.fn(async (dirPath: string) => {
    const normalizedPath = dirPath.replace(/\\/g, '/');
    mockDirs.add(normalizedPath);
  }),
  access: vi.fn(async (filePath: string) => {
    const normalizedPath = filePath.replace(/\\/g, '/');
    if (!mockFiles.has(normalizedPath) && !mockDirs.has(normalizedPath)) {
      const err = new Error(`ENOENT: no such file or directory, access '${filePath}'`) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    }
  }),
  rename: vi.fn(async (oldPath: string, newPath: string) => {
    const normalizedOldPath = oldPath.replace(/\\/g, '/');
    const normalizedNewPath = newPath.replace(/\\/g, '/');
    const content = mockFiles.get(normalizedOldPath);
    if (content === undefined) {
      const err = new Error(`ENOENT: no such file or directory, rename '${oldPath}' -> '${newPath}'`) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    }
    mockFiles.set(normalizedNewPath, content);
    mockFiles.delete(normalizedOldPath);
  }),
  unlink: vi.fn(async (filePath: string) => {
    const normalizedPath = filePath.replace(/\\/g, '/');
    if (!mockFiles.has(normalizedPath)) {
      const err = new Error(`ENOENT: no such file or directory, unlink '${filePath}'`) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    }
    mockFiles.delete(normalizedPath);
  }),
}));

// Mock electron app
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/userData'),
  },
}));

// Create chainable mock for Drizzle ORM  
let lastQueriedTable: string | null = null;

function createSelectChain() {
  const chain: any = {
    from: vi.fn().mockImplementation((table) => {
      // Drizzle table objects have [Symbol.for('drizzle:Name')] or _.name
      lastQueriedTable = table?.[Symbol.for('drizzle:Name')] || table?._?.name || null;
      return chain;
    }),
    where: vi.fn().mockReturnThis(),
    all: vi.fn().mockImplementation(() => Promise.resolve(mockPosts)),
    get: vi.fn().mockImplementation(() => {
      // Return project data if querying projects table
      if (lastQueriedTable === 'projects') {
        return Promise.resolve(mockProject);
      }
      return Promise.resolve(undefined);
    }),
  };
  chain.where = vi.fn().mockReturnValue(chain);
  return chain;
}

const mockLocalDb = {
  select: vi.fn(() => createSelectChain()),
  update: vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    })),
  })),
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

  // Default project for tests that call syncOnStartup
  const defaultMockProject = {
    id: 'test-project',
    name: 'Test Project',
    description: 'A test project',
    slug: 'test-project',
    createdAt: new Date(),
    updatedAt: new Date(),
    isActive: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFiles.clear();
    mockDirs.clear();
    mockPosts = [];
    mockProject = defaultMockProject; // Default to valid project
    lastQueriedTable = null;
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

    it('should keep tags in memory only (TagEngine handles persistence)', async () => {
      await metaEngine.addTag('node');
      
      // Tags are now kept in memory only - TagEngine handles file persistence
      const tags = await metaEngine.getTags();
      expect(tags).toContain('node');
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
      const catPath = normalizePath(`${metaDir}/categories.json`);
      expect(mockFiles.has(catPath)).toBe(true);
    });

    it('should load categories from filesystem', async () => {
      const metaDir = metaEngine.getMetaDir();
      const catPath = normalizePath(`${metaDir}/categories.json`);
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

    it('should populate tags from database posts only', async () => {
      // Tags are now populated from posts only, no file merging
      // (TagEngine handles tag persistence with colors)
      mockPosts = [
        { tags: JSON.stringify(['db-tag-1', 'db-tag-2']) },
      ];
      
      await metaEngine.syncOnStartup();
      
      const tags = await metaEngine.getTags();
      expect(tags).toContain('db-tag-1');
      expect(tags).toContain('db-tag-2');
    });

    it('should merge file categories with database categories', async () => {
      const metaDir = metaEngine.getMetaDir();
      mockFiles.set(normalizePath(`${metaDir}/categories.json`), JSON.stringify(['file-cat']));
      
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

    it('should save category changes back to file', async () => {
      const metaDir = metaEngine.getMetaDir();
      mockFiles.set(normalizePath(`${metaDir}/categories.json`), JSON.stringify(['existing-cat']));
      mockPosts = [{ tags: JSON.stringify([]), categories: JSON.stringify(['new-cat-from-db']) }];
      
      await metaEngine.syncOnStartup();
      
      // Categories are saved to file, tags are not (handled by TagEngine)
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

    it('should handle posts with invalid JSON tags (gracefully skip)', async () => {
      mockPosts = [
        { tags: 'not-valid-json{[' },
        { tags: JSON.stringify(['valid-tag']) },
      ];
      
      const tags = await metaEngine.collectTagsFromPosts();
      expect(tags).toEqual(['valid-tag']);
    });

    it('should handle posts with invalid JSON categories (gracefully skip)', async () => {
      mockPosts = [
        { categories: 'invalid json here}' },
        { categories: JSON.stringify(['valid-cat']) },
      ];
      
      const categories = await metaEngine.collectCategoriesFromPosts();
      expect(categories).toEqual(['valid-cat']);
    });

    it('should ignore empty and whitespace-only taxonomy entries from posts', async () => {
      mockPosts = [
        {
          tags: JSON.stringify([' valid-tag ', '', '   ']),
          categories: JSON.stringify([' valid-cat ', '', '   ']),
        },
      ];

      const tags = await metaEngine.collectTagsFromPosts();
      const categories = await metaEngine.collectCategoriesFromPosts();

      expect(tags).toEqual(['valid-tag']);
      expect(categories).toEqual(['valid-cat']);
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

  describe('Project Metadata Management', () => {
    it('should return null when no project metadata exists', async () => {
      const metadata = await metaEngine.getProjectMetadata();
      expect(metadata).toBeNull();
    });

    it('should set project metadata', async () => {
      await metaEngine.setProjectMetadata({
        name: 'My Blog',
        description: 'A personal blog about technology',
      });
      
      const metadata = await metaEngine.getProjectMetadata();
      expect(metadata).toEqual(expect.objectContaining({
        name: 'My Blog',
        description: 'A personal blog about technology',
      }));
    });

    it('should update project name only', async () => {
      await metaEngine.setProjectMetadata({
        name: 'Original Name',
        description: 'Original description',
      });
      
      await metaEngine.updateProjectMetadata({ name: 'Updated Name' });
      
      const metadata = await metaEngine.getProjectMetadata();
      expect(metadata?.name).toBe('Updated Name');
      expect(metadata?.description).toBe('Original description');
    });

    it('should update project description only', async () => {
      await metaEngine.setProjectMetadata({
        name: 'My Blog',
        description: 'Old description',
      });
      
      await metaEngine.updateProjectMetadata({ description: 'New description' });
      
      const metadata = await metaEngine.getProjectMetadata();
      expect(metadata?.name).toBe('My Blog');
      expect(metadata?.description).toBe('New description');
    });

    it('should persist project metadata to filesystem', async () => {
      await metaEngine.setProjectMetadata({
        name: 'Test Project',
        description: 'Test description',
      });
      
      const metaDir = metaEngine.getMetaDir();
      const projectPath = normalizePath(`${metaDir}/project.json`);
      expect(mockFiles.has(projectPath)).toBe(true);
      
      // Verify content
      const content = mockFiles.get(projectPath);
      const parsed = JSON.parse(content!);
      expect(parsed.name).toBe('Test Project');
      expect(parsed.description).toBe('Test description');
    });

    it('should not persist dataPath to filesystem project metadata', async () => {
      await metaEngine.setProjectMetadata({
        name: 'Test Project',
        dataPath: '/custom/project/path',
      });

      const metaDir = metaEngine.getMetaDir();
      const projectPath = normalizePath(`${metaDir}/project.json`);
      const content = mockFiles.get(projectPath);
      const parsed = JSON.parse(content!);

      expect(parsed.dataPath).toBeUndefined();
    });

    it('should load project metadata from filesystem', async () => {
      const metaDir = metaEngine.getMetaDir();
      const projectPath = normalizePath(`${metaDir}/project.json`);
      mockFiles.set(projectPath, JSON.stringify({
        name: 'Loaded Project',
        description: 'Loaded description',
      }));
      
      await metaEngine.loadProjectMetadata();
      
      const metadata = await metaEngine.getProjectMetadata();
      expect(metadata?.name).toBe('Loaded Project');
      expect(metadata?.description).toBe('Loaded description');
    });

    it('should handle ENOENT error when loading project metadata (no file)', async () => {
      // No file exists, should set metadata to null
      await metaEngine.loadProjectMetadata();
      
      const metadata = await metaEngine.getProjectMetadata();
      expect(metadata).toBeNull();
    });

    it('should throw non-ENOENT errors when loading project metadata', async () => {
      // Spy on console.error to suppress expected error output
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      // Mock readFile to throw a non-ENOENT error
      const originalReadFile = vi.mocked(fs.readFile);
      originalReadFile.mockRejectedValueOnce(Object.assign(new Error('Permission denied'), { code: 'EACCES' }));
      
      await expect(metaEngine.loadProjectMetadata()).rejects.toThrow('Permission denied');
      
      // Verify error was logged before rethrowing
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[MetaEngine] Failed to load project metadata:',
        expect.any(Error)
      );
      
      consoleErrorSpy.mockRestore();
    });

    it('should set and get defaultAuthor in project metadata', async () => {
      await metaEngine.setProjectMetadata({
        name: 'My Blog',
        description: 'A blog',
        defaultAuthor: 'John Doe',
      });
      
      const metadata = await metaEngine.getProjectMetadata();
      expect(metadata?.defaultAuthor).toBe('John Doe');
    });

    it('should update defaultAuthor only', async () => {
      await metaEngine.setProjectMetadata({
        name: 'My Blog',
        description: 'A blog',
      });
      
      await metaEngine.updateProjectMetadata({ defaultAuthor: 'Jane Smith' });
      
      const metadata = await metaEngine.getProjectMetadata();
      expect(metadata?.name).toBe('My Blog');
      expect(metadata?.defaultAuthor).toBe('Jane Smith');
    });

    it('should persist defaultAuthor to filesystem', async () => {
      await metaEngine.setProjectMetadata({
        name: 'Test Project',
        defaultAuthor: 'Author Name',
      });
      
      const metaDir = metaEngine.getMetaDir();
      const projectPath = normalizePath(`${metaDir}/project.json`);
      
      const content = mockFiles.get(projectPath);
      const parsed = JSON.parse(content!);
      expect(parsed.defaultAuthor).toBe('Author Name');
    });

    it('should load defaultAuthor from filesystem', async () => {
      const metaDir = metaEngine.getMetaDir();
      const projectPath = normalizePath(`${metaDir}/project.json`);
      mockFiles.set(projectPath, JSON.stringify({
        name: 'Loaded Project',
        defaultAuthor: 'Loaded Author',
      }));
      
      await metaEngine.loadProjectMetadata();
      
      const metadata = await metaEngine.getProjectMetadata();
      expect(metadata?.defaultAuthor).toBe('Loaded Author');
    });

    it('should persist picoTheme to filesystem', async () => {
      await metaEngine.setProjectMetadata({
        name: 'Styled Project',
        picoTheme: 'slate',
      } as any);

      const metaDir = metaEngine.getMetaDir();
      const projectPath = normalizePath(`${metaDir}/project.json`);
      const content = mockFiles.get(projectPath);
      const parsed = JSON.parse(content!);
      expect(parsed.picoTheme).toBe('slate');
    });

    it('should apply default category metadata for standard categories', async () => {
      await metaEngine.setProjectMetadata({
        name: 'Category Defaults Project',
      } as any);

      const metadata = await metaEngine.getProjectMetadata() as any;
      expect(metadata.categoryMetadata).toEqual(
        expect.objectContaining({
          article: { renderInLists: true, showTitle: true, title: 'article' },
          picture: { renderInLists: true, showTitle: true, title: 'picture' },
          aside: { renderInLists: true, showTitle: false, title: 'aside' },
          page: { renderInLists: false, showTitle: true, title: 'page' },
        })
      );
    });

    it('should persist legacy categorySettings input to category-meta.json', async () => {
      await metaEngine.setProjectMetadata({
        name: 'Persisted Category Settings',
        categorySettings: {
          article: { renderInLists: true, showTitle: true },
          aside: { renderInLists: true, showTitle: false },
          page: { renderInLists: false, showTitle: true },
          custom: { renderInLists: false, showTitle: true },
        },
      } as any);

      const metaDir = metaEngine.getMetaDir();
      const categoryMetaPath = normalizePath(`${metaDir}/category-meta.json`);
      const content = mockFiles.get(categoryMetaPath);
      const parsed = JSON.parse(content!);

      expect(parsed).toEqual(
        expect.objectContaining({
          custom: { renderInLists: false, showTitle: true, title: 'custom' },
          aside: { renderInLists: true, showTitle: false, title: 'aside' },
          page: { renderInLists: false, showTitle: true, title: 'page' },
        })
      );
    });

    it('should persist category metadata to category-meta.json and not to project.json', async () => {
      await metaEngine.setProjectMetadata({
        name: 'Persisted Category Metadata',
        categoryMetadata: {
          article: { renderInLists: true, showTitle: true, title: 'Articles' },
          updates: { renderInLists: false, showTitle: true, title: 'Project Updates' },
        },
      } as any);

      const metaDir = metaEngine.getMetaDir();
      const projectPath = normalizePath(`${metaDir}/project.json`);
      const categoryMetaPath = normalizePath(`${metaDir}/category-meta.json`);

      const projectContent = mockFiles.get(projectPath);
      const categoryMetaContent = mockFiles.get(categoryMetaPath);

      expect(projectContent).toBeDefined();
      expect(categoryMetaContent).toBeDefined();

      const parsedProject = JSON.parse(projectContent!);
      const parsedCategoryMeta = JSON.parse(categoryMetaContent!);

      expect(parsedProject.categorySettings).toBeUndefined();
      expect(parsedProject.categoryMetadata).toBeUndefined();
      expect(parsedCategoryMeta.updates).toEqual({ renderInLists: false, showTitle: true, title: 'Project Updates' });
    });

    it('should merge missing category settings with defaults when loading legacy project metadata', async () => {
      const metaDir = metaEngine.getMetaDir();
      const projectPath = normalizePath(`${metaDir}/project.json`);
      mockFiles.set(projectPath, JSON.stringify({
        name: 'Loaded Project',
        categorySettings: {
          custom: { renderInLists: false, showTitle: false },
        },
      }));

      await metaEngine.loadProjectMetadata();

      const metadata = await metaEngine.getProjectMetadata() as any;
      expect(metadata.categoryMetadata).toEqual(
        expect.objectContaining({
          custom: { renderInLists: false, showTitle: false, title: 'custom' },
          article: { renderInLists: true, showTitle: true, title: 'article' },
          aside: { renderInLists: true, showTitle: false, title: 'aside' },
          page: { renderInLists: false, showTitle: true, title: 'page' },
        })
      );
    });

    it('should load picoTheme from filesystem', async () => {
      const metaDir = metaEngine.getMetaDir();
      const projectPath = normalizePath(`${metaDir}/project.json`);
      mockFiles.set(projectPath, JSON.stringify({
        name: 'Loaded Project',
        picoTheme: 'zinc',
      }));

      await metaEngine.loadProjectMetadata();

      const metadata = await metaEngine.getProjectMetadata();
      expect((metadata as any)?.picoTheme).toBe('zinc');
    });

    it('should set and get maxPostsPerPage in project metadata', async () => {
      await metaEngine.setProjectMetadata({
        name: 'My Blog',
        maxPostsPerPage: 42,
      });

      const metadata = await metaEngine.getProjectMetadata();
      expect(metadata?.maxPostsPerPage).toBe(42);
    });

    it('should set and get blogmarkCategory in project metadata', async () => {
      await metaEngine.setProjectMetadata({
        name: 'My Blog',
        blogmarkCategory: 'Article',
      } as any);

      const metadata = await metaEngine.getProjectMetadata();
      expect((metadata as any)?.blogmarkCategory).toBe('article');
    });

    it('should set and get pythonRuntimeMode in project metadata', async () => {
      await metaEngine.setProjectMetadata({
        name: 'My Blog',
        pythonRuntimeMode: 'main-thread',
      } as any);

      const metadata = await metaEngine.getProjectMetadata();
      expect((metadata as any)?.pythonRuntimeMode).toBe('main-thread');
    });

    it('should persist pythonRuntimeMode to filesystem', async () => {
      await metaEngine.setProjectMetadata({
        name: 'Runtime Mode Project',
        pythonRuntimeMode: 'webworker',
      } as any);

      const metaDir = metaEngine.getMetaDir();
      const projectPath = normalizePath(`${metaDir}/project.json`);
      const content = mockFiles.get(projectPath);
      const parsed = JSON.parse(content!);

      expect(parsed.pythonRuntimeMode).toBe('webworker');
    });

    it('should persist blogmarkCategory to filesystem', async () => {
      await metaEngine.setProjectMetadata({
        name: 'Test Project',
        blogmarkCategory: 'links',
      } as any);

      const metaDir = metaEngine.getMetaDir();
      const projectPath = normalizePath(`${metaDir}/project.json`);

      const content = mockFiles.get(projectPath);
      const parsed = JSON.parse(content!);
      expect(parsed.blogmarkCategory).toBe('links');
    });

    it('should set and get publicUrl in project metadata', async () => {
      await metaEngine.setProjectMetadata({
        name: 'My Blog',
        publicUrl: 'https://example.com/blog',
      });

      const metadata = await metaEngine.getProjectMetadata();
      expect(metadata?.publicUrl).toBe('https://example.com/blog');
    });

    it('should persist publicUrl to filesystem', async () => {
      await metaEngine.setProjectMetadata({
        name: 'Test Project',
        publicUrl: 'https://example.com',
      });

      const metaDir = metaEngine.getMetaDir();
      const projectPath = normalizePath(`${metaDir}/project.json`);

      const content = mockFiles.get(projectPath);
      const parsed = JSON.parse(content!);
      expect(parsed.publicUrl).toBe('https://example.com');
    });

    it('should sanitize invalid maxPostsPerPage values from filesystem', async () => {
      const metaDir = metaEngine.getMetaDir();
      const projectPath = normalizePath(`${metaDir}/project.json`);
      mockFiles.set(projectPath, JSON.stringify({
        name: 'Loaded Project',
        maxPostsPerPage: -5,
      }));

      await metaEngine.loadProjectMetadata();

      const metadata = await metaEngine.getProjectMetadata();
      expect(metadata?.maxPostsPerPage).toBe(50);
    });

    it('should handle ENOENT error when loading categories (no file)', async () => {
      // No file exists, should not throw
      await metaEngine.loadCategories();
      
      const categories = await metaEngine.getCategories();
      expect(categories).toEqual([]);
    });

    it('should throw non-ENOENT errors when loading categories', async () => {
      // Spy on console.error to suppress expected error output
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      // Mock readFile to throw a non-ENOENT error
      const originalReadFile = vi.mocked(fs.readFile);
      originalReadFile.mockRejectedValueOnce(Object.assign(new Error('Disk full'), { code: 'ENOSPC' }));
      
      await expect(metaEngine.loadCategories()).rejects.toThrow('Disk full');
      
      // Verify error was logged before rethrowing
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[MetaEngine] Failed to load categories:',
        expect.any(Error)
      );
      
      consoleErrorSpy.mockRestore();
    });

    it('should emit projectMetadataChanged event when metadata is modified', async () => {
      const handler = vi.fn();
      metaEngine.on('projectMetadataChanged', handler);
      
      await metaEngine.setProjectMetadata({
        name: 'Event Test',
        description: 'Testing events',
      });
      
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Event Test',
        description: 'Testing events',
      }));
    });

    it('should clear project metadata when project context changes', () => {
      // Set some metadata first
      metaEngine.setProjectContext('project-1');
      
      // Change project context
      metaEngine.setProjectContext('project-2');
      
      // The in-memory cache should be cleared (metadata will be null until loaded)
      // This is a synchronous operation, so we test the immediate state
      expect(metaEngine.getProjectContext()).toBe('project-2');
    });

    it('should sync project metadata on startup from database', async () => {
      // No file exists, should use default from project database
      const metadata = await metaEngine.getProjectMetadata();
      // Initially null before sync
      expect(metadata).toBeNull();
    });

    it('should load project metadata during syncOnStartup if file exists', async () => {
      const metaDir = metaEngine.getMetaDir();
      mockFiles.set(normalizePath(`${metaDir}/project.json`), JSON.stringify({
        name: 'Synced Project',
        description: 'Synced description',
      }));
      
      await metaEngine.syncOnStartup();
      
      const metadata = await metaEngine.getProjectMetadata();
      expect(metadata?.name).toBe('Synced Project');
      expect(metadata?.description).toBe('Synced description');
    });

    it('should load category metadata from category-meta.json during syncOnStartup', async () => {
      const metaDir = metaEngine.getMetaDir();
      mockFiles.set(normalizePath(`${metaDir}/categories.json`), JSON.stringify(['news']));
      mockFiles.set(normalizePath(`${metaDir}/project.json`), JSON.stringify({
        name: 'Synced Project',
      }));
      mockFiles.set(normalizePath(`${metaDir}/category-meta.json`), JSON.stringify({
        news: { renderInLists: true, showTitle: true, title: 'Newsroom' },
      }));

      await metaEngine.syncOnStartup();

      const metadata = await metaEngine.getProjectMetadata() as any;
      expect(metadata?.categoryMetadata?.news).toEqual({ renderInLists: true, showTitle: true, title: 'Newsroom' });
    });

    it('should preserve customized category titles from category-meta.json across syncOnStartup', async () => {
      const metaDir = metaEngine.getMetaDir();
      mockFiles.set(normalizePath(`${metaDir}/categories.json`), JSON.stringify(['article', 'picture', 'aside', 'page', 'news']));
      mockFiles.set(normalizePath(`${metaDir}/project.json`), JSON.stringify({
        name: 'Synced Project',
      }));
      mockFiles.set(normalizePath(`${metaDir}/category-meta.json`), JSON.stringify({
        article: { renderInLists: true, showTitle: true, title: 'Articles' },
        picture: { renderInLists: true, showTitle: true, title: 'Photos' },
        aside: { renderInLists: true, showTitle: false, title: 'Asides' },
        page: { renderInLists: false, showTitle: true, title: 'Pages' },
        news: { renderInLists: true, showTitle: true, title: 'Newsroom' },
      }));

      await metaEngine.syncOnStartup();

      const metadata = await metaEngine.getProjectMetadata() as any;
      expect(metadata?.categoryMetadata?.article?.title).toBe('Articles');
      expect(metadata?.categoryMetadata?.picture?.title).toBe('Photos');
      expect(metadata?.categoryMetadata?.aside?.title).toBe('Asides');
      expect(metadata?.categoryMetadata?.page?.title).toBe('Pages');
      expect(metadata?.categoryMetadata?.news?.title).toBe('Newsroom');
    });

    it('should continue syncOnStartup when categories.json is malformed and recover from database categories', async () => {
      const metaDir = metaEngine.getMetaDir();
      mockFiles.set(normalizePath(`${metaDir}/project.json`), JSON.stringify({
        name: 'Synced Project',
      }));
      mockFiles.set(normalizePath(`${metaDir}/categories.json`), '["news",');

      mockPosts = [
        { categories: JSON.stringify(['db-cat']) },
      ];

      await expect(metaEngine.syncOnStartup()).resolves.toBeUndefined();

      const categories = await metaEngine.getCategories();
      expect(categories).toContain('db-cat');

      const metadata = await metaEngine.getProjectMetadata();
      expect(metadata?.name).toBe('Synced Project');
    });

    it('should continue syncOnStartup when category-meta.json is malformed and keep valid project metadata', async () => {
      const metaDir = metaEngine.getMetaDir();
      mockFiles.set(normalizePath(`${metaDir}/project.json`), JSON.stringify({
        name: 'Synced Project',
      }));
      mockFiles.set(normalizePath(`${metaDir}/categories.json`), JSON.stringify(['news']));
      mockFiles.set(normalizePath(`${metaDir}/category-meta.json`), '{"news":');

      await expect(metaEngine.syncOnStartup()).resolves.toBeUndefined();

      const metadata = await metaEngine.getProjectMetadata() as any;
      expect(metadata?.name).toBe('Synced Project');
      expect(metadata?.categoryMetadata?.news).toEqual(
        expect.objectContaining({
          renderInLists: true,
          showTitle: true,
          title: 'news',
        }),
      );
    });

    it('should create project.json with data from database during syncOnStartup if file does not exist', async () => {
      const metaDir = metaEngine.getMetaDir();
      const projectPath = normalizePath(`${metaDir}/project.json`);
      
      // Setup mock project in database
      mockProject = {
        id: 'test-project',
        name: 'My Awesome Blog',
        description: 'A blog about programming',
        slug: 'my-awesome-blog',
        createdAt: new Date(),
        updatedAt: new Date(),
        isActive: true,
      };
      
      // Ensure no file exists
      expect(mockFiles.has(projectPath)).toBe(false);
      
      await metaEngine.syncOnStartup();
      
      // File should be created
      expect(mockFiles.has(projectPath)).toBe(true);
      
      // Should have metadata from database
      const metadata = await metaEngine.getProjectMetadata();
      expect(metadata).not.toBeNull();
      expect(metadata?.name).toBe('My Awesome Blog');
      expect(metadata?.description).toBe('A blog about programming');
    });

    it('should throw error if project not found in database during syncOnStartup', async () => {
      // No project in database
      mockProject = null;
      
      await expect(metaEngine.syncOnStartup()).rejects.toThrow('Project not found');
    });

    it('should create categories.json with defaults for new project with no posts', async () => {
      const metaDir = metaEngine.getMetaDir();
      const catPath = normalizePath(`${metaDir}/categories.json`);
      
      // Setup mock project in database
      mockProject = {
        id: 'test-project',
        name: 'New Blog',
        description: 'A new blog',
        slug: 'new-blog',
        createdAt: new Date(),
        updatedAt: new Date(),
        isActive: true,
      };
      
      // No posts (so no categories from database)
      mockPosts = [];
      
      await metaEngine.syncOnStartup();
      
      // File should be created with default categories
      expect(mockFiles.has(catPath)).toBe(true);
      
      const categories = await metaEngine.getCategories();
      expect(categories).toContain('article');
      expect(categories).toContain('picture');
      expect(categories).toContain('aside');
      expect(categories).toContain('page');
    });

    it('should report isInitialized as false before syncOnStartup', () => {
      expect(metaEngine.isInitialized()).toBe(false);
    });

    it('should report isInitialized as true after syncOnStartup', async () => {
      await metaEngine.syncOnStartup();
      expect(metaEngine.isInitialized()).toBe(true);
    });

    it('should reset initialized flag when project context changes', async () => {
      await metaEngine.syncOnStartup();
      expect(metaEngine.isInitialized()).toBe(true);
      
      metaEngine.setProjectContext('different-project');
      expect(metaEngine.isInitialized()).toBe(false);
    });

    it('should keep initialized flag when project context is unchanged', async () => {
      await metaEngine.syncOnStartup();
      expect(metaEngine.isInitialized()).toBe(true);

      metaEngine.setProjectContext('test-project');
      expect(metaEngine.isInitialized()).toBe(true);
    });

    it('should de-duplicate concurrent syncOnStartup calls', async () => {
      const collectTagsSpy = vi.spyOn(metaEngine as unknown as {
        collectTagsFromPosts: () => Promise<string[]>;
      }, 'collectTagsFromPosts');

      await Promise.all([
        metaEngine.syncOnStartup(),
        metaEngine.syncOnStartup(),
      ]);

      expect(collectTagsSpy).toHaveBeenCalledTimes(1);
    });

    it('should use custom dataDir when provided in setProjectContext', () => {
      const customDataDir = path.join('custom', 'data', 'path');
      metaEngine.setProjectContext('project-with-custom-dir', customDataDir);
      
      const metaDir = metaEngine.getMetaDir();
      expect(normalizePath(metaDir)).toContain(normalizePath(customDataDir));
    });

    it('should ignore and remove dataPath from project.json during syncOnStartup', async () => {
      const metaDir = metaEngine.getMetaDir();
      const oldPath = path.join('old', 'path', 'from', 'file');
      const newPath = path.join('new', 'path', 'from', 'database');
      mockFiles.set(normalizePath(`${metaDir}/project.json`), JSON.stringify({
        name: 'Project',
        dataPath: oldPath,
      }));
      
      // Database has the currently selected (authoritative) path
      mockProject = {
        id: 'test-project',
        name: 'Project',
        description: null,
        dataPath: newPath,
        slug: 'project',
        createdAt: new Date(),
        updatedAt: new Date(),
        isActive: true,
      };
      
      await metaEngine.syncOnStartup();
      
      const savedProjectJson = mockFiles.get(normalizePath(`${metaDir}/project.json`));
      expect(savedProjectJson).toBeDefined();
      const parsed = JSON.parse(savedProjectJson!);
      expect(parsed.dataPath).toBeUndefined();
      expect(mockLocalDb.update).not.toHaveBeenCalled();
    });
  });
});
