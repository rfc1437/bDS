/**
 * ImportExecutionEngine Unit Tests
 *
 * Tests the ImportExecutionEngine which handles the actual import of WXR data.
 * Following TDD best practices: mock external dependencies, test real implementation.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type {
  ImportAnalysisReport,
  AnalyzedPost,
  AnalyzedMedia,
  AnalyzedCategory,
  AnalyzedTag,
} from '../../src/main/engine/ImportAnalysisEngine';
import type { WxrPost, WxrMedia, WxrSiteInfo } from '../../src/main/engine/WxrParser';

// Mock modules before importing the engine
vi.mock('../../src/main/database', () => ({
  getDatabase: vi.fn(() => ({
    getLocal: vi.fn(() => mockDb),
    getLocalClient: vi.fn(() => mockClient),
  })),
}));

vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  copyFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(Buffer.from('test image data')),
  access: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({ size: 1024 }),
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/user/data'),
  },
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-uuid-' + Math.random().toString(36).substr(2, 9)),
}));

// Mock the TagEngine
const mockTagEngine = {
  setProjectContext: vi.fn(),
  createTag: vi.fn().mockImplementation(async (input: { name: string }) => ({
    id: `tag-${input.name}`,
    projectId: 'test-project',
    name: input.name.toLowerCase(),
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
  getAllTags: vi.fn().mockResolvedValue([]),
};

vi.mock('../../src/main/engine/TagEngine', () => ({
  getTagEngine: vi.fn(() => mockTagEngine),
}));

// Mock the PostEngine
const mockPostEngine = {
  setProjectContext: vi.fn(),
  createPost: vi.fn().mockImplementation(async (data: any) => ({
    id: data.id || 'mock-post-id',
    projectId: data.projectId || 'test-project',
    title: data.title,
    slug: data.slug,
    content: data.content,
    excerpt: data.excerpt,
    status: data.status,
    author: data.author,
    createdAt: data.createdAt || new Date(),
    updatedAt: data.updatedAt || new Date(),
    publishedAt: data.publishedAt,
    tags: data.tags || [],
    categories: data.categories || [],
  })),
  publishPost: vi.fn().mockImplementation(async (id: string) => ({ id, status: 'published' })),
  isSlugAvailable: vi.fn().mockResolvedValue(true),
  generateUniqueSlug: vi.fn().mockImplementation(async (title: string) => `${title.toLowerCase().replace(/\s+/g, '-')}-new`),
  updateFTSIndex: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../../src/main/engine/PostEngine', () => ({
  getPostEngine: vi.fn(() => mockPostEngine),
}));

// Mock the MediaEngine
const mockMediaEngine = {
  setProjectContext: vi.fn(),
  importMedia: vi.fn().mockImplementation(async (sourcePath: string, metadata?: any) => ({
    id: 'mock-media-id',
    filename: 'test.jpg',
    originalName: metadata?.originalName || 'test.jpg',
    mimeType: metadata?.mimeType || 'image/jpeg',
    size: 1024,
    width: 800,
    height: 600,
    alt: metadata?.alt,
    caption: metadata?.caption,
    createdAt: new Date(),
    updatedAt: new Date(),
    tags: metadata?.tags || [],
    linkedPostIds: metadata?.linkedPostIds || [],
  })),
  updateMedia: vi.fn().mockResolvedValue({}),
};

vi.mock('../../src/main/engine/MediaEngine', () => ({
  getMediaEngine: vi.fn(() => mockMediaEngine),
}));

// Mock database - track inserts for verification
const insertedPosts: any[] = [];
const insertedMedia: any[] = [];

// Create a mock that tracks based on table name property
const createMockInsert = () => ({
  values: vi.fn((data: any) => {
    // The insert will be called for posts or media tables
    // We determine which based on the data structure
    if (data.slug !== undefined && data.projectId !== undefined) {
      insertedPosts.push(data);
    }
    return Promise.resolve();
  }),
});

const mockDb = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        get: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockResolvedValue([]),
      })),
    })),
  })),
  insert: vi.fn(() => createMockInsert()),
  update: vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    })),
  })),
};

const mockClient = {
  execute: vi.fn().mockResolvedValue({ rows: [] }),
};

// Import engine after mocks
import { ImportExecutionEngine, ImportExecutionResult, ImportExecutionOptions } from '../../src/main/engine/ImportExecutionEngine';

// Test fixtures
function createMockWxrPost(overrides?: Partial<WxrPost>): WxrPost {
  return {
    wpId: 1,
    title: 'Test Post',
    slug: 'test-post',
    content: '<p>Test content with [gallery ids="1,2,3"]</p>',
    excerpt: 'Test excerpt',
    pubDate: new Date('2024-01-15T10:00:00Z'),
    postDate: new Date('2024-01-15T10:00:00Z'),
    postModified: new Date('2024-01-20T15:00:00Z'),
    creator: 'admin',
    status: 'publish',
    postType: 'post',
    categories: ['Technology'],
    tags: ['JavaScript', 'TypeScript'],
    ...overrides,
  };
}

function createMockWxrMedia(overrides?: Partial<WxrMedia>): WxrMedia {
  return {
    wpId: 100,
    title: 'Test Image',
    url: 'https://example.com/wp-content/uploads/2024/01/test.jpg',
    filename: 'test.jpg',
    relativePath: '2024/01/test.jpg',
    pubDate: new Date('2024-01-15T10:00:00Z'),
    parentId: 1,
    mimeType: 'image/jpeg',
    description: 'A test image description',
    ...overrides,
  };
}

function createMockAnalyzedPost(wxrPost: WxrPost, status: 'new' | 'update' | 'conflict' | 'content-duplicate' = 'new', conflictResolution?: 'ignore' | 'overwrite' | 'import'): AnalyzedPost {
  return {
    wxrPost,
    status,
    contentHash: 'abc123',
    markdownPreview: 'Test content preview',
    conflictResolution,
  };
}

function createMockAnalyzedMedia(wxrMedia: WxrMedia, status: 'new' | 'update' | 'conflict' | 'content-duplicate' | 'missing' = 'new'): AnalyzedMedia {
  return {
    wxrMedia,
    status,
    fileHash: 'def456',
  };
}

function createMockAnalysisReport(overrides?: Partial<ImportAnalysisReport>): ImportAnalysisReport {
  return {
    sourceFile: '/path/to/export.xml',
    site: {
      title: 'Test Blog',
      link: 'https://example.com',
      description: 'A test blog',
      language: 'en-US',
    },
    analyzedAt: new Date(),
    posts: {
      total: 0,
      new: 0,
      updates: 0,
      conflicts: 0,
      contentDuplicates: 0,
      items: [],
    },
    pages: {
      total: 0,
      new: 0,
      updates: 0,
      conflicts: 0,
      contentDuplicates: 0,
      items: [],
    },
    media: {
      total: 0,
      new: 0,
      updates: 0,
      conflicts: 0,
      contentDuplicates: 0,
      missing: 0,
      items: [],
    },
    categories: [],
    tags: [],
    macros: {
      total: 0,
      mappedCount: 0,
      unmappedCount: 0,
      discovered: [],
    },
    ...overrides,
  };
}

describe('ImportExecutionEngine', () => {
  let engine: ImportExecutionEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    insertedPosts.length = 0;
    insertedMedia.length = 0;
    engine = new ImportExecutionEngine();
    engine.setProjectContext('test-project', '/mock/project/data');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('setProjectContext', () => {
    it('should set the project context', () => {
      engine.setProjectContext('new-project', '/new/data/path');
      expect(engine.getProjectContext()).toBe('new-project');
    });

    it('should handle project context without dataDir', () => {
      engine.setProjectContext('another-project');
      expect(engine.getProjectContext()).toBe('another-project');
    });
  });

  describe('Error Handling', () => {
    it('should handle top-level executeImport errors gracefully', async () => {
      // Make tagEngine.setProjectContext throw to simulate catastrophic failure
      mockTagEngine.setProjectContext.mockImplementationOnce(() => {
        throw new Error('Catastrophic failure');
      });
      
      const report = createMockAnalysisReport({});

      const result = await engine.executeImport(report, {});

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Catastrophic failure');
    });
  });

  describe('Phase 1: Tag Creation', () => {
    it('should create new tags from analysis report', async () => {
      const report = createMockAnalysisReport({
        tags: [
          { name: 'NewTag', slug: 'newtag', existsInProject: false },
          { name: 'ExistingTag', slug: 'existingtag', existsInProject: true },
        ],
        categories: [
          { name: 'NewCategory', slug: 'newcategory', existsInProject: false },
        ],
      });

      const result = await engine.executeImport(report, {});

      // Should create only new tags (not existing ones)
      expect(mockTagEngine.createTag).toHaveBeenCalledWith({ name: 'newtag' });
      expect(mockTagEngine.createTag).toHaveBeenCalledWith({ name: 'newcategory' });
      expect(mockTagEngine.createTag).toHaveBeenCalledTimes(2);
    });

    it('should not create tags that already exist', async () => {
      const report = createMockAnalysisReport({
        tags: [
          { name: 'ExistingTag', slug: 'existingtag', existsInProject: true },
        ],
      });

      await engine.executeImport(report, {});

      expect(mockTagEngine.createTag).not.toHaveBeenCalled();
    });

    it('should use mapped tag names when creating tags', async () => {
      const report = createMockAnalysisReport({
        tags: [
          { name: 'OldName', slug: 'oldname', existsInProject: false, mappedTo: 'NewName' },
        ],
      });

      await engine.executeImport(report, {});

      // Should NOT create the tag if it's mapped to an existing one
      // The mappedTo value means it should use an existing tag
      expect(mockTagEngine.createTag).not.toHaveBeenCalled();
    });

    it('should count skipped when tag creation fails (duplicate/race condition)', async () => {
      mockTagEngine.createTag.mockRejectedValueOnce(new Error('Tag already exists'));
      
      const report = createMockAnalysisReport({
        tags: [
          { name: 'NewTag', slug: 'newtag', existsInProject: false },
        ],
      });

      const result = await engine.executeImport(report, {});

      // Tag creation failed, should be counted as skipped not created
      expect(result.tags.skipped).toBe(1);
      expect(result.tags.created).toBe(0);
    });

    it('should count skipped when category creation fails', async () => {
      mockTagEngine.createTag.mockRejectedValueOnce(new Error('Category already exists'));
      
      const report = createMockAnalysisReport({
        categories: [
          { name: 'NewCategory', slug: 'newcategory', existsInProject: false },
        ],
      });

      const result = await engine.executeImport(report, {});

      expect(result.tags.skipped).toBe(1);
      expect(result.tags.created).toBe(0);
    });
  });

  describe('Phase 2: Post Import', () => {
    it('should import new posts with correct dates from WXR', async () => {
      const wxrPost = createMockWxrPost({
        postDate: new Date('2024-01-15T10:00:00Z'),
        postModified: new Date('2024-01-20T15:00:00Z'),
      });
      const report = createMockAnalysisReport({
        posts: {
          total: 1,
          new: 1,
          updates: 0,
          conflicts: 0,
          contentDuplicates: 0,
          items: [createMockAnalyzedPost(wxrPost, 'new')],
        },
      });

      await engine.executeImport(report, { uploadsFolder: '/uploads' });

      // Check that post was inserted into DB with correct dates
      expect(insertedPosts.length).toBe(1);
      expect(insertedPosts[0].title).toBe('Test Post');
      expect(insertedPosts[0].slug).toBe('test-post');
      expect(insertedPosts[0].createdAt).toEqual(new Date('2024-01-15T10:00:00Z'));
      expect(insertedPosts[0].updatedAt).toEqual(new Date('2024-01-20T15:00:00Z'));
    });

    it('should skip posts with conflict resolution "ignore"', async () => {
      const wxrPost = createMockWxrPost();
      const report = createMockAnalysisReport({
        posts: {
          total: 1,
          new: 0,
          updates: 0,
          conflicts: 1,
          contentDuplicates: 0,
          items: [createMockAnalyzedPost(wxrPost, 'conflict', 'ignore')],
        },
      });

      const result = await engine.executeImport(report, {});

      expect(insertedPosts.length).toBe(0);
      expect(result.posts.skipped).toBe(1);
    });

    it('should create draft for conflict resolution "overwrite"', async () => {
      const wxrPost = createMockWxrPost();
      const analyzed = createMockAnalyzedPost(wxrPost, 'conflict', 'overwrite');
      analyzed.existingPost = {
        id: 'existing-post-id',
        title: 'Existing Post',
        slug: 'test-post',
        checksum: 'old-checksum',
        pubDate: null,
        excerpt: null,
        author: null,
        tags: [],
        categories: [],
      };
      
      const report = createMockAnalysisReport({
        posts: {
          total: 1,
          new: 0,
          updates: 0,
          conflicts: 1,
          contentDuplicates: 0,
          items: [analyzed],
        },
      });

      await engine.executeImport(report, {});

      expect(insertedPosts.length).toBe(1);
      expect(insertedPosts[0].slug).toBe('test-post');
      expect(insertedPosts[0].status).toBe('draft');
    });

    it('should create new post with new slug for conflict resolution "import"', async () => {
      const wxrPost = createMockWxrPost();
      const analyzed = createMockAnalyzedPost(wxrPost, 'conflict', 'import');
      analyzed.existingPost = {
        id: 'existing-post-id',
        title: 'Existing Post',
        slug: 'test-post',
        checksum: 'old-checksum',
        pubDate: null,
        excerpt: null,
        author: null,
        tags: [],
        categories: [],
      };
      
      const report = createMockAnalysisReport({
        posts: {
          total: 1,
          new: 0,
          updates: 0,
          conflicts: 1,
          contentDuplicates: 0,
          items: [analyzed],
        },
      });

      await engine.executeImport(report, {});

      expect(mockPostEngine.generateUniqueSlug).toHaveBeenCalled();
      expect(insertedPosts.length).toBe(1);
    });

    it('should skip posts with status "content-duplicate"', async () => {
      const wxrPost = createMockWxrPost();
      const analyzed = createMockAnalyzedPost(wxrPost, 'content-duplicate');
      
      const report = createMockAnalysisReport({
        posts: {
          total: 1,
          new: 0,
          updates: 0,
          conflicts: 0,
          contentDuplicates: 1,
          items: [analyzed],
        },
      });

      const result = await engine.executeImport(report, {});

      expect(insertedPosts.length).toBe(0);
      expect(result.posts.skipped).toBe(1);
      expect(result.posts.imported).toBe(0);
    });

    it('should skip posts with status "update"', async () => {
      const wxrPost = createMockWxrPost();
      const analyzed = createMockAnalyzedPost(wxrPost, 'update');
      analyzed.existingPost = {
        id: 'existing-post-id',
        title: 'Existing Post',
        slug: 'test-post',
        checksum: 'same-content-checksum',
        pubDate: null,
        excerpt: null,
        author: null,
        tags: [],
        categories: [],
      };
      
      const report = createMockAnalysisReport({
        posts: {
          total: 1,
          new: 0,
          updates: 1,
          conflicts: 0,
          contentDuplicates: 0,
          items: [analyzed],
        },
      });

      const result = await engine.executeImport(report, {});

      expect(insertedPosts.length).toBe(0);
      expect(result.posts.skipped).toBe(1);
    });

    it('should handle empty content gracefully', async () => {
      const wxrPost = createMockWxrPost({
        content: '',
      });
      const report = createMockAnalysisReport({
        posts: {
          total: 1,
          new: 1,
          updates: 0,
          conflicts: 0,
          contentDuplicates: 0,
          items: [createMockAnalyzedPost(wxrPost, 'new')],
        },
      });

      await engine.executeImport(report, {});

      expect(insertedPosts.length).toBe(1);
      // Empty content should be preserved as empty string
    });

    it('should handle whitespace-only content gracefully', async () => {
      const wxrPost = createMockWxrPost({
        content: '   \n\t  ',
      });
      const report = createMockAnalysisReport({
        posts: {
          total: 1,
          new: 1,
          updates: 0,
          conflicts: 0,
          contentDuplicates: 0,
          items: [createMockAnalyzedPost(wxrPost, 'new')],
        },
      });

      await engine.executeImport(report, {});

      expect(insertedPosts.length).toBe(1);
    });

    it('should include excerpt in post metadata when present', async () => {
      const wxrPost = createMockWxrPost({
        excerpt: 'This is a post excerpt',
      });
      const report = createMockAnalysisReport({
        posts: {
          total: 1,
          new: 1,
          updates: 0,
          conflicts: 0,
          contentDuplicates: 0,
          items: [createMockAnalyzedPost(wxrPost, 'new')],
        },
      });

      await engine.executeImport(report, {});

      expect(insertedPosts.length).toBe(1);
      expect(insertedPosts[0].excerpt).toBe('This is a post excerpt');
    });

    it('should include author in post metadata when present', async () => {
      const wxrPost = createMockWxrPost({
        creator: 'johndoe',
      });
      const report = createMockAnalysisReport({
        posts: {
          total: 1,
          new: 1,
          updates: 0,
          conflicts: 0,
          contentDuplicates: 0,
          items: [createMockAnalyzedPost(wxrPost, 'new')],
        },
      });

      await engine.executeImport(report, {});

      expect(insertedPosts.length).toBe(1);
      expect(insertedPosts[0].author).toBe('johndoe');
    });

    it('should include publishedAt for published posts', async () => {
      const pubDate = new Date('2024-01-15T10:00:00Z');
      const wxrPost = createMockWxrPost({
        pubDate,
      });
      const report = createMockAnalysisReport({
        posts: {
          total: 1,
          new: 1,
          updates: 0,
          conflicts: 0,
          contentDuplicates: 0,
          items: [createMockAnalyzedPost(wxrPost, 'new')],
        },
      });

      await engine.executeImport(report, {});

      expect(insertedPosts.length).toBe(1);
      expect(insertedPosts[0].publishedAt).toEqual(pubDate);
    });

    it('should not set publishedAt for draft posts', async () => {
      const wxrPost = createMockWxrPost();
      const analyzed = createMockAnalyzedPost(wxrPost, 'conflict', 'overwrite');
      analyzed.existingPost = {
        id: 'existing-post-id',
        title: 'Existing Post',
        slug: 'test-post',
        checksum: 'old-checksum',
        pubDate: null,
        excerpt: null,
        author: null,
        tags: [],
        categories: [],
      };
      
      const report = createMockAnalysisReport({
        posts: {
          total: 1,
          new: 0,
          updates: 0,
          conflicts: 1,
          contentDuplicates: 0,
          items: [analyzed],
        },
      });

      await engine.executeImport(report, {});

      expect(insertedPosts.length).toBe(1);
      expect(insertedPosts[0].status).toBe('draft');
      expect(insertedPosts[0].publishedAt).toBeUndefined();
    });

    it('should handle post without optional fields', async () => {
      const wxrPost = createMockWxrPost({
        excerpt: '',
        creator: '',
        pubDate: undefined,
        postDate: undefined,
        postModified: undefined,
      });
      const report = createMockAnalysisReport({
        posts: {
          total: 1,
          new: 1,
          updates: 0,
          conflicts: 0,
          contentDuplicates: 0,
          items: [createMockAnalyzedPost(wxrPost, 'new')],
        },
      });

      await engine.executeImport(report, {});

      expect(insertedPosts.length).toBe(1);
      // Should use current date as fallback
      expect(insertedPosts[0].createdAt).toBeInstanceOf(Date);
    });

    it('should handle dates that are ISO strings (from JSON serialization through IPC)', async () => {
      // After JSON.parse, dates become strings like "2024-01-15T10:00:00.000Z"
      const wxrPost = createMockWxrPost({
        postDate: '2023-06-20T08:30:00.000Z' as any,
        postModified: '2023-07-01T12:00:00.000Z' as any,
        pubDate: '2023-06-20T08:30:00.000Z' as any,
        status: 'publish',
      });
      const report = createMockAnalysisReport({
        posts: {
          total: 1,
          new: 1,
          updates: 0,
          conflicts: 0,
          contentDuplicates: 0,
          items: [createMockAnalyzedPost(wxrPost, 'new')],
        },
      });

      await engine.executeImport(report, {});

      expect(insertedPosts.length).toBe(1);
      expect(insertedPosts[0].createdAt).toBeInstanceOf(Date);
      expect(insertedPosts[0].createdAt).toEqual(new Date('2023-06-20T08:30:00.000Z'));
      expect(insertedPosts[0].updatedAt).toBeInstanceOf(Date);
      expect(insertedPosts[0].updatedAt).toEqual(new Date('2023-07-01T12:00:00.000Z'));
      expect(insertedPosts[0].publishedAt).toBeInstanceOf(Date);
      expect(insertedPosts[0].publishedAt).toEqual(new Date('2023-06-20T08:30:00.000Z'));
    });

    it('should handle invalid date strings gracefully', async () => {
      const wxrPost = createMockWxrPost({
        postDate: 'not-a-date' as any,
        postModified: '' as any,
        pubDate: undefined,
      });
      const report = createMockAnalysisReport({
        posts: {
          total: 1,
          new: 1,
          updates: 0,
          conflicts: 0,
          contentDuplicates: 0,
          items: [createMockAnalyzedPost(wxrPost, 'new')],
        },
      });

      await engine.executeImport(report, {});

      expect(insertedPosts.length).toBe(1);
      // Invalid dates should fall back to current date
      expect(insertedPosts[0].createdAt).toBeInstanceOf(Date);
    });

    it('should record error when post import fails', async () => {
      const wxrPost = createMockWxrPost();
      
      // Make the database insert throw an error
      const originalInsert = mockDb.insert;
      mockDb.insert = vi.fn(() => ({
        values: vi.fn().mockRejectedValue(new Error('Database error')),
      }));
      
      const report = createMockAnalysisReport({
        posts: {
          total: 1,
          new: 1,
          updates: 0,
          conflicts: 0,
          contentDuplicates: 0,
          items: [createMockAnalyzedPost(wxrPost, 'new')],
        },
      });

      const result = await engine.executeImport(report, {});

      expect(result.posts.errors).toBe(1);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Failed to import post');
      
      // Restore
      mockDb.insert = originalInsert;
    });

    it('should transform WordPress shortcodes to double bracket format', async () => {
      const wxrPost = createMockWxrPost({
        content: '<p>Check out [gallery ids="1,2"] and [video src="test.mp4"]</p>',
      });
      // Create as conflict with overwrite resolution to get a draft (content in DB)
      const analyzed = createMockAnalyzedPost(wxrPost, 'conflict', 'overwrite');
      analyzed.existingPost = {
        id: 'existing-post-id',
        title: 'Existing Post',
        slug: 'test-post',
        checksum: 'old-checksum',
        pubDate: null,
        excerpt: null,
        author: null,
        tags: [],
        categories: [],
      };
      const report = createMockAnalysisReport({
        posts: {
          total: 1,
          new: 0,
          updates: 0,
          conflicts: 1,
          contentDuplicates: 0,
          items: [analyzed],
        },
      });

      await engine.executeImport(report, {});

      expect(insertedPosts.length).toBe(1);
      // Draft posts store content in DB
      expect(insertedPosts[0].content).toContain('[[gallery ids="1,2"]]');
      expect(insertedPosts[0].content).toContain('[[video src="test.mp4"]]');
    });

    it('should map tags based on analysis mappings', async () => {
      const wxrPost = createMockWxrPost({
        tags: ['OldTagName', 'NewTag'],
        categories: ['MappedCategory'],
      });
      
      const report = createMockAnalysisReport({
        posts: {
          total: 1,
          new: 1,
          updates: 0,
          conflicts: 0,
          contentDuplicates: 0,
          items: [createMockAnalyzedPost(wxrPost, 'new')],
        },
        tags: [
          { name: 'OldTagName', slug: 'oldtagname', existsInProject: false, mappedTo: 'ExistingTag' },
          { name: 'NewTag', slug: 'newtag', existsInProject: false },
        ],
        categories: [
          { name: 'MappedCategory', slug: 'mappedcategory', existsInProject: false, mappedTo: 'TargetCategory' },
        ],
      });

      await engine.executeImport(report, {});

      expect(insertedPosts.length).toBe(1);
      const tags = JSON.parse(insertedPosts[0].tags);
      const categories = JSON.parse(insertedPosts[0].categories);
      expect(tags).toContain('existingtag');
      expect(tags).toContain('newtag');
      expect(categories).toContain('targetcategory');
    });

    it('should build wpId to postId mapping for media phase', async () => {
      const wxrPost = createMockWxrPost({ wpId: 42 });
      const report = createMockAnalysisReport({
        posts: {
          total: 1,
          new: 1,
          updates: 0,
          conflicts: 0,
          contentDuplicates: 0,
          items: [createMockAnalyzedPost(wxrPost, 'new')],
        },
      });

      const result = await engine.executeImport(report, {});

      expect(result.wpIdToPostId.get(42)).toBeDefined();
    });
  });

  describe('Phase 3: Media Import', () => {
    it('should import new media files', async () => {
      const wxrMedia = createMockWxrMedia();
      const report = createMockAnalysisReport({
        media: {
          total: 1,
          new: 1,
          updates: 0,
          conflicts: 0,
          contentDuplicates: 0,
          missing: 0,
          items: [createMockAnalyzedMedia(wxrMedia, 'new')],
        },
      });

      await engine.executeImport(report, { uploadsFolder: '/uploads' });

      expect(mockMediaEngine.importMedia).toHaveBeenCalled();
    });

    it('should pass createdAt and updatedAt from WXR pubDate to MediaEngine', async () => {
      const pubDate = new Date('2020-03-15T14:30:00Z');
      const wxrMedia = createMockWxrMedia({ pubDate });
      const report = createMockAnalysisReport({
        media: {
          total: 1,
          new: 1,
          updates: 0,
          conflicts: 0,
          contentDuplicates: 0,
          missing: 0,
          items: [createMockAnalyzedMedia(wxrMedia, 'new')],
        },
      });

      await engine.executeImport(report, { uploadsFolder: '/uploads' });

      expect(mockMediaEngine.importMedia).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          createdAt: pubDate,
          updatedAt: pubDate,
        })
      );
    });

    it('should handle media pubDate as string (from JSON serialization)', async () => {
      const wxrMedia = createMockWxrMedia({
        pubDate: '2019-11-25T09:00:00.000Z' as any,
      });
      const report = createMockAnalysisReport({
        media: {
          total: 1,
          new: 1,
          updates: 0,
          conflicts: 0,
          contentDuplicates: 0,
          missing: 0,
          items: [createMockAnalyzedMedia(wxrMedia, 'new')],
        },
      });

      await engine.executeImport(report, { uploadsFolder: '/uploads' });

      expect(mockMediaEngine.importMedia).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          createdAt: new Date('2019-11-25T09:00:00.000Z'),
          updatedAt: new Date('2019-11-25T09:00:00.000Z'),
        })
      );
    });

    it('should set caption from WXR title', async () => {
      const wxrMedia = createMockWxrMedia({ title: 'Beautiful Sunset' });
      const report = createMockAnalysisReport({
        media: {
          total: 1,
          new: 1,
          updates: 0,
          conflicts: 0,
          contentDuplicates: 0,
          missing: 0,
          items: [createMockAnalyzedMedia(wxrMedia, 'new')],
        },
      });

      await engine.executeImport(report, { uploadsFolder: '/uploads' });

      expect(mockMediaEngine.importMedia).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          caption: 'Beautiful Sunset',
        })
      );
    });

    it('should link media to parent post using wpId mapping', async () => {
      // First import a post
      const wxrPost = createMockWxrPost({ wpId: 42 });
      const wxrMedia = createMockWxrMedia({ parentId: 42 });
      
      const report = createMockAnalysisReport({
        posts: {
          total: 1,
          new: 1,
          updates: 0,
          conflicts: 0,
          contentDuplicates: 0,
          items: [createMockAnalyzedPost(wxrPost, 'new')],
        },
        media: {
          total: 1,
          new: 1,
          updates: 0,
          conflicts: 0,
          contentDuplicates: 0,
          missing: 0,
          items: [createMockAnalyzedMedia(wxrMedia, 'new')],
        },
      });

      await engine.executeImport(report, { uploadsFolder: '/uploads' });

      expect(mockMediaEngine.importMedia).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          linkedPostIds: expect.any(Array),
        })
      );
    });

    it('should skip missing media files', async () => {
      const wxrMedia = createMockWxrMedia();
      const report = createMockAnalysisReport({
        media: {
          total: 1,
          new: 0,
          updates: 0,
          conflicts: 0,
          contentDuplicates: 0,
          missing: 1,
          items: [createMockAnalyzedMedia(wxrMedia, 'missing')],
        },
      });

      const result = await engine.executeImport(report, { uploadsFolder: '/uploads' });

      expect(mockMediaEngine.importMedia).not.toHaveBeenCalled();
      expect(result.media.skipped).toBe(1);
    });

    it('should skip media with conflict resolution "ignore"', async () => {
      const wxrMedia = createMockWxrMedia();
      const analyzed = createMockAnalyzedMedia(wxrMedia, 'conflict');
      (analyzed as any).conflictResolution = 'ignore';
      
      const report = createMockAnalysisReport({
        media: {
          total: 1,
          new: 0,
          updates: 0,
          conflicts: 1,
          contentDuplicates: 0,
          missing: 0,
          items: [analyzed],
        },
      });

      const result = await engine.executeImport(report, { uploadsFolder: '/uploads' });

      expect(mockMediaEngine.importMedia).not.toHaveBeenCalled();
      expect(result.media.skipped).toBe(1);
    });

    it('should skip media with status "content-duplicate"', async () => {
      const wxrMedia = createMockWxrMedia();
      const analyzed = createMockAnalyzedMedia(wxrMedia, 'content-duplicate');
      
      const report = createMockAnalysisReport({
        media: {
          total: 1,
          new: 0,
          updates: 0,
          conflicts: 0,
          contentDuplicates: 1,
          missing: 0,
          items: [analyzed],
        },
      });

      const result = await engine.executeImport(report, { uploadsFolder: '/uploads' });

      expect(mockMediaEngine.importMedia).not.toHaveBeenCalled();
      expect(result.media.skipped).toBe(1);
    });

    it('should skip media with status "update"', async () => {
      const wxrMedia = createMockWxrMedia();
      const analyzed = createMockAnalyzedMedia(wxrMedia, 'update');
      
      const report = createMockAnalysisReport({
        media: {
          total: 1,
          new: 0,
          updates: 1,
          conflicts: 0,
          contentDuplicates: 0,
          missing: 0,
          items: [analyzed],
        },
      });

      const result = await engine.executeImport(report, { uploadsFolder: '/uploads' });

      expect(mockMediaEngine.importMedia).not.toHaveBeenCalled();
      expect(result.media.skipped).toBe(1);
    });

    it('should skip media when uploadsFolder is not provided', async () => {
      const wxrMedia = createMockWxrMedia();
      const report = createMockAnalysisReport({
        media: {
          total: 1,
          new: 1,
          updates: 0,
          conflicts: 0,
          contentDuplicates: 0,
          missing: 0,
          items: [createMockAnalyzedMedia(wxrMedia, 'new')],
        },
      });

      const result = await engine.executeImport(report, {}); // No uploadsFolder

      expect(mockMediaEngine.importMedia).not.toHaveBeenCalled();
      expect(result.media.skipped).toBe(1);
    });

    it('should skip media when source file does not exist', async () => {
      const { access } = await import('fs/promises');
      vi.mocked(access).mockRejectedValueOnce(new Error('ENOENT'));
      
      const wxrMedia = createMockWxrMedia();
      const report = createMockAnalysisReport({
        media: {
          total: 1,
          new: 1,
          updates: 0,
          conflicts: 0,
          contentDuplicates: 0,
          missing: 0,
          items: [createMockAnalyzedMedia(wxrMedia, 'new')],
        },
      });

      const result = await engine.executeImport(report, { uploadsFolder: '/uploads' });

      expect(mockMediaEngine.importMedia).not.toHaveBeenCalled();
      expect(result.media.skipped).toBe(1);
    });

    it('should import media with conflict resolution "overwrite"', async () => {
      const wxrMedia = createMockWxrMedia();
      const analyzed = createMockAnalyzedMedia(wxrMedia, 'conflict');
      (analyzed as any).conflictResolution = 'overwrite';
      
      const report = createMockAnalysisReport({
        media: {
          total: 1,
          new: 0,
          updates: 0,
          conflicts: 1,
          contentDuplicates: 0,
          missing: 0,
          items: [analyzed],
        },
      });

      await engine.executeImport(report, { uploadsFolder: '/uploads' });

      expect(mockMediaEngine.importMedia).toHaveBeenCalled();
    });

    it('should import media with conflict resolution "import"', async () => {
      const wxrMedia = createMockWxrMedia();
      const analyzed = createMockAnalyzedMedia(wxrMedia, 'conflict');
      (analyzed as any).conflictResolution = 'import';
      
      const report = createMockAnalysisReport({
        media: {
          total: 1,
          new: 0,
          updates: 0,
          conflicts: 1,
          contentDuplicates: 0,
          missing: 0,
          items: [analyzed],
        },
      });

      await engine.executeImport(report, { uploadsFolder: '/uploads' });

      expect(mockMediaEngine.importMedia).toHaveBeenCalled();
    });

    it('should set alt text from WXR description', async () => {
      const wxrMedia = createMockWxrMedia({ description: 'Alt text for image' });
      const report = createMockAnalysisReport({
        media: {
          total: 1,
          new: 1,
          updates: 0,
          conflicts: 0,
          contentDuplicates: 0,
          missing: 0,
          items: [createMockAnalyzedMedia(wxrMedia, 'new')],
        },
      });

      await engine.executeImport(report, { uploadsFolder: '/uploads' });

      expect(mockMediaEngine.importMedia).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          alt: 'Alt text for image',
        })
      );
    });

    it('should handle media with no parent post', async () => {
      const wxrMedia = createMockWxrMedia({ parentId: 0 });
      const report = createMockAnalysisReport({
        media: {
          total: 1,
          new: 1,
          updates: 0,
          conflicts: 0,
          contentDuplicates: 0,
          missing: 0,
          items: [createMockAnalyzedMedia(wxrMedia, 'new')],
        },
      });

      await engine.executeImport(report, { uploadsFolder: '/uploads' });

      expect(mockMediaEngine.importMedia).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          linkedPostIds: [],
        })
      );
    });

    it('should record error when media import fails', async () => {
      mockMediaEngine.importMedia.mockRejectedValueOnce(new Error('Media import failed'));
      
      const wxrMedia = createMockWxrMedia();
      const report = createMockAnalysisReport({
        media: {
          total: 1,
          new: 1,
          updates: 0,
          conflicts: 0,
          contentDuplicates: 0,
          missing: 0,
          items: [createMockAnalyzedMedia(wxrMedia, 'new')],
        },
      });

      const result = await engine.executeImport(report, { uploadsFolder: '/uploads' });

      expect(result.media.errors).toBe(1);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Failed to import media');
    });
  });

  describe('Phase 4: Page Import', () => {
    it('should import pages with "page" category', async () => {
      const wxrPage = createMockWxrPost({
        postType: 'page',
        categories: [],
      });
      const report = createMockAnalysisReport({
        pages: {
          total: 1,
          new: 1,
          updates: 0,
          conflicts: 0,
          contentDuplicates: 0,
          items: [createMockAnalyzedPost(wxrPage, 'new')],
        },
      });

      await engine.executeImport(report, {});

      expect(insertedPosts.length).toBe(1);
      const categories = JSON.parse(insertedPosts[0].categories);
      expect(categories).toContain('page');
    });

    it('should preserve existing page categories and add "page"', async () => {
      const wxrPage = createMockWxrPost({
        postType: 'page',
        categories: ['Documentation', 'Help'],
      });
      const report = createMockAnalysisReport({
        pages: {
          total: 1,
          new: 1,
          updates: 0,
          conflicts: 0,
          contentDuplicates: 0,
          items: [createMockAnalyzedPost(wxrPage, 'new')],
        },
        categories: [
          { name: 'Documentation', slug: 'documentation', existsInProject: false },
          { name: 'Help', slug: 'help', existsInProject: false },
        ],
      });

      await engine.executeImport(report, {});

      expect(insertedPosts.length).toBe(1);
      const categories = JSON.parse(insertedPosts[0].categories);
      expect(categories).toContain('page');
      expect(categories).toContain('documentation');
      expect(categories).toContain('help');
    });

    it('should use existing page category mapping when defined in report', async () => {
      const wxrPage = createMockWxrPost({
        postType: 'page',
        categories: [],
      });
      const report = createMockAnalysisReport({
        pages: {
          total: 1,
          new: 1,
          updates: 0,
          conflicts: 0,
          contentDuplicates: 0,
          items: [createMockAnalyzedPost(wxrPage, 'new')],
        },
        categories: [
          // Page is already defined in the category mapping
          { name: 'page', slug: 'page', existsInProject: true },
        ],
      });

      await engine.executeImport(report, {});

      expect(insertedPosts.length).toBe(1);
      const categories = JSON.parse(insertedPosts[0].categories);
      expect(categories).toContain('page');
    });

    it('should skip pages with status "content-duplicate"', async () => {
      const wxrPage = createMockWxrPost({
        postType: 'page',
        categories: [],
      });
      const report = createMockAnalysisReport({
        pages: {
          total: 1,
          new: 0,
          updates: 0,
          conflicts: 0,
          contentDuplicates: 1,
          items: [createMockAnalyzedPost(wxrPage, 'content-duplicate')],
        },
      });

      const result = await engine.executeImport(report, {});

      expect(insertedPosts.length).toBe(0);
      expect(result.pages.skipped).toBe(1);
    });

    it('should skip pages with status "update"', async () => {
      const wxrPage = createMockWxrPost({
        postType: 'page',
        categories: [],
      });
      const analyzed = createMockAnalyzedPost(wxrPage, 'update');
      analyzed.existingPost = {
        id: 'existing-page-id',
        title: 'Existing Page',
        slug: 'test-page',
        checksum: 'same-content-checksum',
        pubDate: null,
        excerpt: null,
        author: null,
        tags: [],
        categories: [],
      };
      
      const report = createMockAnalysisReport({
        pages: {
          total: 1,
          new: 0,
          updates: 1,
          conflicts: 0,
          contentDuplicates: 0,
          items: [analyzed],
        },
      });

      const result = await engine.executeImport(report, {});

      expect(insertedPosts.length).toBe(0);
      expect(result.pages.skipped).toBe(1);
    });

    it('should handle page conflict with "overwrite" resolution', async () => {
      const wxrPage = createMockWxrPost({
        postType: 'page',
        categories: [],
      });
      const analyzed = createMockAnalyzedPost(wxrPage, 'conflict', 'overwrite');
      analyzed.existingPost = {
        id: 'existing-page-id',
        title: 'Existing Page',
        slug: 'test-post',
        checksum: 'old-checksum',
        pubDate: null,
        excerpt: null,
        author: null,
        tags: [],
        categories: [],
      };
      
      const report = createMockAnalysisReport({
        pages: {
          total: 1,
          new: 0,
          updates: 0,
          conflicts: 1,
          contentDuplicates: 0,
          items: [analyzed],
        },
      });

      await engine.executeImport(report, {});

      expect(insertedPosts.length).toBe(1);
      expect(insertedPosts[0].status).toBe('draft');
      const categories = JSON.parse(insertedPosts[0].categories);
      expect(categories).toContain('page');
    });

    it('should handle page conflict with "import" resolution', async () => {
      const wxrPage = createMockWxrPost({
        postType: 'page',
        categories: [],
      });
      const analyzed = createMockAnalyzedPost(wxrPage, 'conflict', 'import');
      analyzed.existingPost = {
        id: 'existing-page-id',
        title: 'Existing Page',
        slug: 'test-post',
        checksum: 'old-checksum',
        pubDate: null,
        excerpt: null,
        author: null,
        tags: [],
        categories: [],
      };
      
      const report = createMockAnalysisReport({
        pages: {
          total: 1,
          new: 0,
          updates: 0,
          conflicts: 1,
          contentDuplicates: 0,
          items: [analyzed],
        },
      });

      await engine.executeImport(report, {});

      expect(mockPostEngine.generateUniqueSlug).toHaveBeenCalled();
      expect(insertedPosts.length).toBe(1);
      const categories = JSON.parse(insertedPosts[0].categories);
      expect(categories).toContain('page');
    });

    it('should record error when page import fails', async () => {
      const wxrPage = createMockWxrPost({
        postType: 'page',
        categories: [],
      });
      
      // Make the database insert throw an error
      const originalInsert = mockDb.insert;
      mockDb.insert = vi.fn(() => ({
        values: vi.fn().mockRejectedValue(new Error('Database error')),
      }));
      
      const report = createMockAnalysisReport({
        pages: {
          total: 1,
          new: 1,
          updates: 0,
          conflicts: 0,
          contentDuplicates: 0,
          items: [createMockAnalyzedPost(wxrPage, 'new')],
        },
      });

      const result = await engine.executeImport(report, {});

      expect(result.pages.errors).toBe(1);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Failed to import page');
      
      // Restore
      mockDb.insert = originalInsert;
    });
  });

  describe('Progress Reporting', () => {
    it('should call progress callback during import', async () => {
      const progressCallback = vi.fn();
      const wxrPost = createMockWxrPost();
      const report = createMockAnalysisReport({
        posts: {
          total: 1,
          new: 1,
          updates: 0,
          conflicts: 0,
          contentDuplicates: 0,
          items: [createMockAnalyzedPost(wxrPost, 'new')],
        },
      });

      await engine.executeImport(report, { onProgress: progressCallback });

      expect(progressCallback).toHaveBeenCalled();
    });
  });

  describe('Result Summary', () => {
    it('should return accurate counts in result', async () => {
      const report = createMockAnalysisReport({
        tags: [
          { name: 'NewTag', slug: 'newtag', existsInProject: false },
        ],
        posts: {
          total: 2,
          new: 1,
          updates: 0,
          conflicts: 1,
          contentDuplicates: 0,
          items: [
            createMockAnalyzedPost(createMockWxrPost({ wpId: 1 }), 'new'),
            createMockAnalyzedPost(createMockWxrPost({ wpId: 2 }), 'conflict', 'ignore'),
          ],
        },
      });

      const result = await engine.executeImport(report, {});

      expect(result.tags.created).toBe(1);
      expect(result.posts.imported).toBe(1);
      expect(result.posts.skipped).toBe(1);
    });
  });
});
