/**
 * MetadataDiffEngine Unit Tests
 *
 * Tests the REAL MetadataDiffEngine class with mocked dependencies.
 * Following TDD best practices: mock external dependencies, test real implementation.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  MetadataDiffEngine, PostMetadataDiff, DiffGroup, DiffField,
  MediaMetadataDiff, MediaDiffField,
  ScriptMetadataDiff, ScriptDiffField,
  TemplateMetadataDiff, TemplateDiffField,
} from '../../src/main/engine/MetadataDiffEngine';
import { resetMockCounters } from '../utils/factories';

// Mock posts data store - used for single-item .get() queries
const mockPosts = new Map<string, any>();
// Queue of posts for sequential .get() calls (used in scanAllPublishedPosts)
let mockPostsGetQueue: any[] = [];
let mockAllPostsRows: any[] = [];

// Create chainable mock for Drizzle ORM
function createSelectChain(data: any[] = []) {
  const chain: any = {
    from: vi.fn().mockImplementation(() => chain),
    where: vi.fn().mockImplementation(() => chain),
    orderBy: vi.fn().mockImplementation(() => chain),
    limit: vi.fn().mockImplementation(() => chain),
    offset: vi.fn().mockImplementation(() => chain),
    all: vi.fn().mockResolvedValue(data),
    get: vi.fn().mockImplementation(() => {
      // If there are queued posts, return from queue
      if (mockPostsGetQueue.length > 0) {
        return Promise.resolve(mockPostsGetQueue.shift());
      }
      // Otherwise return from map
      return Promise.resolve(mockPosts.size > 0 ? Array.from(mockPosts.values())[0] : undefined);
    }),
    then: (resolve: (value: any[]) => void, reject?: (reason: any) => void) => {
      return Promise.resolve(data).then(resolve, reject);
    },
  };
  return chain;
}

function createDrizzleMock() {
  return {
    select: vi.fn(() => createSelectChain(mockAllPostsRows)),
    insert: vi.fn(() => ({
      values: vi.fn(() => Promise.resolve()),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve()),
    })),
  };
}

const mockLocalDb = createDrizzleMock();
const mockLocalClient = {
  execute: vi.fn(async () => ({ rows: [] })),
};

// Mock the database module
vi.mock('../../src/main/database', () => ({
  getDatabase: vi.fn(() => ({
    getLocal: vi.fn(() => mockLocalDb),
    getLocalClient: vi.fn(() => mockLocalClient),
    getRemote: vi.fn(() => null),
    getDataPaths: vi.fn(() => ({
      database: '/mock/userData/bds.db',
      posts: '/mock/userData/posts',
      media: '/mock/userData/media',
    })),
    initializeLocal: vi.fn(),
    initializeRemote: vi.fn(),
    close: vi.fn(),
  })),
}));

// Mock file contents for readPostFile
const mockFileData = new Map<string, any>();

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn(async (path: string) => {
    const data = mockFileData.get(path);
    if (!data) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return data;
  }),
  writeFile: vi.fn(async () => {}),
  unlink: vi.fn(async () => {}),
  mkdir: vi.fn(async () => {}),
  readdir: vi.fn(async () => []),
  access: vi.fn(async (path: string) => {
    if (!mockFileData.has(path)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  }),
  stat: vi.fn(async () => ({
    isFile: () => true,
    isDirectory: () => false,
  })),
}));

// Mock gray-matter
vi.mock('gray-matter', () => ({
  default: vi.fn((content: string) => {
    // Simple mock that extracts frontmatter
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return { data: {}, content };
    
    // Parse YAML-like frontmatter
    const frontmatter = match[1];
    const body = match[2];
    const data: any = {};
    
    frontmatter.split('\n').forEach(line => {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.slice(0, colonIndex).trim();
        let value = line.slice(colonIndex + 1).trim();
        
        // Parse arrays
        if (value.startsWith('[') && value.endsWith(']')) {
          value = JSON.parse(value.replace(/'/g, '"'));
        }
        // Parse strings
        else if (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        }
        
        data[key] = value;
      }
    });
    
    return { data, content: body };
  }),
}));

// Mock electron app
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/userData'),
  },
}));

// Mock TaskManager
vi.mock('../../src/main/engine/TaskManager', () => ({
  taskManager: {
    runTask: vi.fn(async (task: any) => {
      return task.execute((progress: number, message: string) => {});
    }),
  },
}));

// Track the mock function for PostEngine.syncPublishedPostFile
const mockSyncPublishedPostFile = vi.fn(async () => true);

// Mock PostEngine
vi.mock('../../src/main/engine/PostEngine', () => ({
  getPostEngine: vi.fn(() => ({
    syncPublishedPostFile: mockSyncPublishedPostFile,
  })),
}));

describe('MetadataDiffEngine', () => {
  let engine: MetadataDiffEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPosts.clear();
    mockPostsGetQueue = [];
    mockFileData.clear();
    mockAllPostsRows = [];
    mockSyncPublishedPostFile.mockClear();
    resetMockCounters();
    engine = new MetadataDiffEngine({ syncPublishedPostFile: mockSyncPublishedPostFile } as any);
    engine.setProjectContext('test-project');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create a new MetadataDiffEngine instance', () => {
      expect(engine).toBeDefined();
      expect(engine).toBeInstanceOf(MetadataDiffEngine);
    });
  });

  describe('setProjectContext', () => {
    it('should set the current project ID', () => {
      engine.setProjectContext('project-123');
      expect(engine.getProjectContext()).toBe('project-123');
    });
  });

  describe('comparePostMetadata', () => {
    it('should return null for draft posts (no file)', async () => {
      // Set up a draft post in database
      const dbPost = {
        id: 'post-1',
        projectId: 'test-project',
        title: 'Draft Post',
        slug: 'draft-post',
        status: 'draft',
        filePath: null,
        tags: '["tag1"]',
        categories: '["cat1"]',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPosts.set('post-1', dbPost);

      const result = await engine.comparePostMetadata('post-1');

      expect(result).toBeNull();
    });

    it('should detect tag differences between DB and file', async () => {
      const dbPost = {
        id: 'post-1',
        projectId: 'test-project',
        title: 'Published Post',
        slug: 'published-post',
        status: 'published',
        filePath: '/mock/userData/posts/2024/01/published-post.md',
        tags: '["tag1", "tag2"]',
        categories: '["cat1"]',
        createdAt: new Date('2024-01-15'),
        updatedAt: new Date('2024-01-15'),
        publishedAt: new Date('2024-01-15'),
      };
      
      // DB has tag2 but file doesn't
      mockPosts.set('post-1', dbPost);
      
      // File has different tags
      mockFileData.set('/mock/userData/posts/2024/01/published-post.md', `---
id: post-1
projectId: test-project
title: "Published Post"
slug: published-post
status: published
tags: ["tag1", "old-tag"]
categories: ["cat1"]
createdAt: 2024-01-15T00:00:00.000Z
updatedAt: 2024-01-15T00:00:00.000Z
publishedAt: 2024-01-15T00:00:00.000Z
---
Content here`);

      const result = await engine.comparePostMetadata('post-1');

      expect(result).not.toBeNull();
      expect(result?.hasDifferences).toBe(true);
      expect(result?.differences.tags).toBeDefined();
      expect(result?.differences.tags?.dbValue).toEqual(['tag1', 'tag2']);
      expect(result?.differences.tags?.fileValue).toEqual(['tag1', 'old-tag']);
    });

    it('should detect category differences between DB and file', async () => {
      const dbPost = {
        id: 'post-1',
        projectId: 'test-project',
        title: 'Published Post',
        slug: 'published-post',
        status: 'published',
        filePath: '/mock/userData/posts/2024/01/published-post.md',
        tags: '[]',
        categories: '["cat1", "cat2"]',
        createdAt: new Date('2024-01-15'),
        updatedAt: new Date('2024-01-15'),
        publishedAt: new Date('2024-01-15'),
      };
      
      mockPosts.set('post-1', dbPost);
      
      mockFileData.set('/mock/userData/posts/2024/01/published-post.md', `---
id: post-1
projectId: test-project
title: "Published Post"
slug: published-post
status: published
tags: []
categories: ["cat1"]
createdAt: 2024-01-15T00:00:00.000Z
updatedAt: 2024-01-15T00:00:00.000Z
publishedAt: 2024-01-15T00:00:00.000Z
---
Content here`);

      const result = await engine.comparePostMetadata('post-1');

      expect(result).not.toBeNull();
      expect(result?.hasDifferences).toBe(true);
      expect(result?.differences.categories).toBeDefined();
      expect(result?.differences.categories?.dbValue).toEqual(['cat1', 'cat2']);
      expect(result?.differences.categories?.fileValue).toEqual(['cat1']);
    });

    it('should detect language differences between DB and file', async () => {
      const dbPost = {
        id: 'post-1',
        projectId: 'test-project',
        title: 'Published Post',
        slug: 'published-post',
        status: 'published',
        filePath: '/mock/userData/posts/2024/01/published-post.md',
        tags: '[]',
        categories: '[]',
        language: 'en',
        createdAt: new Date('2024-01-15'),
        updatedAt: new Date('2024-01-15'),
        publishedAt: new Date('2024-01-15'),
      };

      mockPosts.set('post-1', dbPost);

      mockFileData.set('/mock/userData/posts/2024/01/published-post.md', `---
id: post-1
projectId: test-project
title: "Published Post"
slug: published-post
status: published
tags: []
categories: []
language: fr
createdAt: 2024-01-15T00:00:00.000Z
updatedAt: 2024-01-15T00:00:00.000Z
publishedAt: 2024-01-15T00:00:00.000Z
---
Content here`);

      const result = await engine.comparePostMetadata('post-1');

      expect(result).not.toBeNull();
      expect(result?.hasDifferences).toBe(true);
      expect(result?.differences.language).toBeDefined();
      expect(result?.differences.language?.dbValue).toBe('en');
      expect(result?.differences.language?.fileValue).toBe('fr');
    });

    it('should detect missing language in file when DB has language', async () => {
      const dbPost = {
        id: 'post-1',
        projectId: 'test-project',
        title: 'Published Post',
        slug: 'published-post',
        status: 'published',
        filePath: '/mock/userData/posts/2024/01/published-post.md',
        tags: '[]',
        categories: '[]',
        language: 'de',
        createdAt: new Date('2024-01-15'),
        updatedAt: new Date('2024-01-15'),
        publishedAt: new Date('2024-01-15'),
      };

      mockPosts.set('post-1', dbPost);

      mockFileData.set('/mock/userData/posts/2024/01/published-post.md', `---
id: post-1
projectId: test-project
title: "Published Post"
slug: published-post
status: published
tags: []
categories: []
createdAt: 2024-01-15T00:00:00.000Z
updatedAt: 2024-01-15T00:00:00.000Z
publishedAt: 2024-01-15T00:00:00.000Z
---
Content here`);

      const result = await engine.comparePostMetadata('post-1');

      expect(result).not.toBeNull();
      expect(result?.hasDifferences).toBe(true);
      expect(result?.differences.language).toBeDefined();
      expect(result?.differences.language?.dbValue).toBe('de');
      expect(result?.differences.language?.fileValue).toBe('');
    });

    it('should populate differences with DB values when file is missing', async () => {
      const dbPost = {
        id: 'post-1',
        projectId: 'test-project',
        title: 'Published Post',
        slug: 'published-post',
        status: 'published',
        filePath: '/mock/userData/posts/2024/01/non-existent.md',
        tags: '["tag1", "tag2"]',
        categories: '["cat1"]',
        excerpt: 'Some excerpt',
        author: 'Author Name',
        language: 'de',
        createdAt: new Date('2024-01-15'),
        updatedAt: new Date('2024-01-15'),
        publishedAt: new Date('2024-01-15'),
      };
      // File intentionally NOT added to mockFileData → readPostFile returns null
      mockPosts.set('post-1', dbPost);

      const result = await engine.comparePostMetadata('post-1');

      expect(result).not.toBeNull();
      expect(result?.hasDifferences).toBe(true);
      expect(result?.fileMissing).toBe(true);
      // DB values should appear in differences so the UI shows what fields exist
      expect(result?.differences.tags).toEqual({ dbValue: ['tag1', 'tag2'], fileValue: null });
      expect(result?.differences.categories).toEqual({ dbValue: ['cat1'], fileValue: null });
      expect(result?.differences.title).toEqual({ dbValue: 'Published Post', fileValue: null });
      expect(result?.differences.excerpt).toEqual({ dbValue: 'Some excerpt', fileValue: null });
      expect(result?.differences.author).toEqual({ dbValue: 'Author Name', fileValue: null });
      expect(result?.differences.language).toEqual({ dbValue: 'de', fileValue: null });
    });

    it('should omit empty DB fields from differences when file is missing', async () => {
      const dbPost = {
        id: 'post-2',
        projectId: 'test-project',
        title: 'Minimal Post',
        slug: 'minimal-post',
        status: 'published',
        filePath: '/mock/userData/posts/2024/01/gone.md',
        tags: '[]',
        categories: '[]',
        excerpt: null,
        author: null,
        language: null,
        createdAt: new Date('2024-01-15'),
        updatedAt: new Date('2024-01-15'),
      };
      mockPosts.set('post-2', dbPost);

      const result = await engine.comparePostMetadata('post-2');

      expect(result).not.toBeNull();
      expect(result?.hasDifferences).toBe(true);
      expect(result?.fileMissing).toBe(true);
      // Title always present since it's non-null
      expect(result?.differences.title).toEqual({ dbValue: 'Minimal Post', fileValue: null });
      // Empty arrays / nulls should be omitted
      expect(result?.differences.tags).toBeUndefined();
      expect(result?.differences.categories).toBeUndefined();
      expect(result?.differences.excerpt).toBeUndefined();
      expect(result?.differences.author).toBeUndefined();
      expect(result?.differences.language).toBeUndefined();
    });

    it('should return hasDifferences=false when metadata matches', async () => {
      const dbPost = {
        id: 'post-1',
        projectId: 'test-project',
        title: 'Published Post',
        slug: 'published-post',
        status: 'published',
        filePath: '/mock/userData/posts/2024/01/published-post.md',
        tags: '["tag1"]',
        categories: '["cat1"]',
        createdAt: new Date('2024-01-15'),
        updatedAt: new Date('2024-01-15'),
        publishedAt: new Date('2024-01-15'),
      };
      
      mockPosts.set('post-1', dbPost);
      
      mockFileData.set('/mock/userData/posts/2024/01/published-post.md', `---
id: post-1
projectId: test-project
title: "Published Post"
slug: published-post
status: published
tags: ["tag1"]
categories: ["cat1"]
createdAt: 2024-01-15T00:00:00.000Z
updatedAt: 2024-01-15T00:00:00.000Z
publishedAt: 2024-01-15T00:00:00.000Z
---
Content here`);

      const result = await engine.comparePostMetadata('post-1');

      expect(result).not.toBeNull();
      expect(result?.hasDifferences).toBe(false);
    });
  });

  describe('scanAllPublishedPosts', () => {
    it('should scan all published posts and return differences', async () => {
      // Mock the raw SQL query that returns published posts
      mockLocalClient.execute.mockResolvedValueOnce({
        rows: [
          {
            id: 'post-1',
            title: 'Post 1',
            slug: 'post-1',
            file_path: '/mock/userData/posts/2024/01/post-1.md',
            tags: '["new-tag"]',
            categories: '["cat1"]',
            excerpt: null,
            author: null,
          },
          {
            id: 'post-2',
            title: 'Post 2',
            slug: 'post-2',
            file_path: '/mock/userData/posts/2024/01/post-2.md',
            tags: '["tag1"]',
            categories: '["cat1"]',
            excerpt: null,
            author: null,
          },
        ],
      });

      // Queue the posts for sequential .get() calls in comparePostMetadata
      mockPostsGetQueue = [
        {
          id: 'post-1',
          projectId: 'test-project',
          title: 'Post 1',
          slug: 'post-1',
          status: 'published',
          filePath: '/mock/userData/posts/2024/01/post-1.md',
          tags: '["new-tag"]',
          categories: '["cat1"]',
          createdAt: new Date('2024-01-15'),
          updatedAt: new Date('2024-01-15'),
        },
        {
          id: 'post-2',
          projectId: 'test-project',
          title: 'Post 2',
          slug: 'post-2',
          status: 'published',
          filePath: '/mock/userData/posts/2024/01/post-2.md',
          tags: '["tag1"]',
          categories: '["cat1"]',
          createdAt: new Date('2024-01-15'),
          updatedAt: new Date('2024-01-15'),
        },
      ];

      // Post 1 has tag difference
      mockFileData.set('/mock/userData/posts/2024/01/post-1.md', `---
id: post-1
projectId: test-project
title: "Post 1"
slug: post-1
status: published
tags: ["old-tag"]
categories: ["cat1"]
createdAt: 2024-01-15T00:00:00.000Z
updatedAt: 2024-01-15T00:00:00.000Z
publishedAt: 2024-01-15T00:00:00.000Z
---
Content`);

      // Post 2 matches
      mockFileData.set('/mock/userData/posts/2024/01/post-2.md', `---
id: post-2
projectId: test-project
title: "Post 2"
slug: post-2
status: published
tags: ["tag1"]
categories: ["cat1"]
createdAt: 2024-01-15T00:00:00.000Z
updatedAt: 2024-01-15T00:00:00.000Z
publishedAt: 2024-01-15T00:00:00.000Z
---
Content`);

      const result = await engine.scanAllPublishedPosts((current, total) => {});

      expect(result.totalScanned).toBe(2);
      expect(result.postsWithDifferences).toBe(1);
      expect(result.differences.length).toBe(1);
      expect(result.differences[0].postId).toBe('post-1');
    });
  });

  describe('groupDifferencesByField', () => {
    it('should group differences by field type', () => {
      const diffs: PostMetadataDiff[] = [
        {
          postId: 'post-1',
          title: 'Post 1',
          slug: 'post-1',
          hasDifferences: true,
          differences: {
            tags: { dbValue: ['new-tag'], fileValue: ['old-tag'] },
          },
        },
        {
          postId: 'post-2',
          title: 'Post 2',
          slug: 'post-2',
          hasDifferences: true,
          differences: {
            tags: { dbValue: ['tag1'], fileValue: ['tag2'] },
            categories: { dbValue: ['cat1'], fileValue: ['cat2'] },
          },
        },
        {
          postId: 'post-3',
          title: 'Post 3',
          slug: 'post-3',
          hasDifferences: true,
          differences: {
            categories: { dbValue: ['catA'], fileValue: ['catB'] },
          },
        },
      ];

      const groups = engine.groupDifferencesByField(diffs);

      expect(groups).toHaveLength(2);
      
      const tagsGroup = groups.find(g => g.field === 'tags');
      expect(tagsGroup).toBeDefined();
      expect(tagsGroup?.posts).toHaveLength(2);
      
      const categoriesGroup = groups.find(g => g.field === 'categories');
      expect(categoriesGroup).toBeDefined();
      expect(categoriesGroup?.posts).toHaveLength(2);
    });
  });

  describe('syncDbToFile', () => {
    it('should sync database metadata to file for given posts', async () => {
      const postIds = ['post-1', 'post-2'];
      
      // This will call syncPublishedPostFile for each post
      await engine.syncDbToFile(postIds);

      // PostEngine.syncPublishedPostFile should have been called twice
      expect(mockSyncPublishedPostFile).toHaveBeenCalledTimes(2);
      expect(mockSyncPublishedPostFile).toHaveBeenCalledWith('post-1');
      expect(mockSyncPublishedPostFile).toHaveBeenCalledWith('post-2');
    });

    it('should report progress on first and final items based on cadence', async () => {
      const postIds = Array.from({ length: 11 }, (_, i) => `post-${i + 1}`);
      const onProgress = vi.fn();

      await engine.syncDbToFile(postIds, onProgress);

      expect(onProgress).toHaveBeenCalledTimes(2);
      expect(onProgress).toHaveBeenNthCalledWith(1, 9, 'Synced 1 of 11 posts...');
      expect(onProgress).toHaveBeenNthCalledWith(2, 100, 'Synced 11 of 11 posts...');
    });

    it('should keep processing and count failures when sync throws or returns false', async () => {
      mockSyncPublishedPostFile
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockRejectedValueOnce(new Error('sync failure'));

      const result = await engine.syncDbToFile(['post-1', 'post-2', 'post-3']);

      expect(result).toEqual({ success: 1, failed: 2 });
      expect(mockSyncPublishedPostFile).toHaveBeenCalledTimes(3);
    });
  });

  describe('syncFileToDb', () => {
    it('should sync file metadata to database for given posts', async () => {
      const dbPost = {
        id: 'post-1',
        projectId: 'test-project',
        title: 'Published Post',
        slug: 'published-post',
        status: 'published',
        filePath: '/mock/userData/posts/2024/01/published-post.md',
        tags: '["db-tag"]',
        categories: '["db-cat"]',
        createdAt: new Date('2024-01-15'),
        updatedAt: new Date('2024-01-15'),
        publishedAt: new Date('2024-01-15'),
      };
      mockPosts.set('post-1', dbPost);

      mockFileData.set('/mock/userData/posts/2024/01/published-post.md', `---
id: post-1
projectId: test-project
title: "Published Post"
slug: published-post
status: published
tags: ["file-tag"]
categories: ["file-cat"]
createdAt: 2024-01-15T00:00:00.000Z
updatedAt: 2024-01-15T00:00:00.000Z
publishedAt: 2024-01-15T00:00:00.000Z
---
Content here`);

      await engine.syncFileToDb(['post-1'], 'tags');

      // Verify the database update was called
      expect(mockLocalDb.update).toHaveBeenCalled();
    });

    it('should sync language field from file to database', async () => {
      const dbPost = {
        id: 'post-1',
        projectId: 'test-project',
        title: 'Published Post',
        slug: 'published-post',
        status: 'published',
        filePath: '/mock/userData/posts/2024/01/published-post.md',
        tags: '[]',
        categories: '[]',
        language: 'en',
        createdAt: new Date('2024-01-15'),
        updatedAt: new Date('2024-01-15'),
        publishedAt: new Date('2024-01-15'),
      };
      mockPosts.set('post-1', dbPost);

      mockFileData.set('/mock/userData/posts/2024/01/published-post.md', `---
id: post-1
projectId: test-project
title: "Published Post"
slug: published-post
status: published
language: fr
tags: []
categories: []
createdAt: 2024-01-15T00:00:00.000Z
updatedAt: 2024-01-15T00:00:00.000Z
publishedAt: 2024-01-15T00:00:00.000Z
---
Content here`);

      await engine.syncFileToDb(['post-1'], 'language');

      expect(mockLocalDb.update).toHaveBeenCalled();
      // Verify the set call includes language
      const updateResult = mockLocalDb.update.mock.results[0].value;
      const setCall = updateResult.set.mock.calls[0][0];
      expect(setCall.language).toBe('fr');
    });

    it('should report progress on first and final items based on cadence', async () => {
      const postIds = Array.from({ length: 11 }, (_, i) => `post-${i + 1}`);

      mockPostsGetQueue = postIds.map((postId) => ({
        id: postId,
        projectId: 'test-project',
        title: `Post ${postId}`,
        slug: postId,
        status: 'published',
        filePath: `/mock/userData/posts/2024/01/${postId}.md`,
        tags: '[]',
        categories: '[]',
        createdAt: new Date('2024-01-15'),
        updatedAt: new Date('2024-01-15'),
      }));

      for (const postId of postIds) {
        mockFileData.set(`/mock/userData/posts/2024/01/${postId}.md`, `---\nid: ${postId}\nprojectId: test-project\ntitle: "${postId}"\nslug: ${postId}\nstatus: published\ntags: []\ncategories: []\n---\nContent`);
      }

      const onProgress = vi.fn();
      await engine.syncFileToDb(postIds, undefined, onProgress);

      expect(onProgress).toHaveBeenCalledTimes(2);
      expect(onProgress).toHaveBeenNthCalledWith(1, 9, 'Synced 1 of 11 posts...');
      expect(onProgress).toHaveBeenNthCalledWith(2, 100, 'Synced 11 of 11 posts...');
    });

    it('should continue after missing file path and file read failures', async () => {
      const postIds = ['post-1', 'post-2', 'post-3'];

      mockPostsGetQueue = [
        {
          id: 'post-1',
          projectId: 'test-project',
          title: 'Post 1',
          slug: 'post-1',
          status: 'published',
          filePath: null,
          tags: '[]',
          categories: '[]',
          createdAt: new Date('2024-01-15'),
          updatedAt: new Date('2024-01-15'),
        },
        {
          id: 'post-2',
          projectId: 'test-project',
          title: 'Post 2',
          slug: 'post-2',
          status: 'published',
          filePath: '/mock/userData/posts/2024/01/post-2.md',
          tags: '[]',
          categories: '[]',
          createdAt: new Date('2024-01-15'),
          updatedAt: new Date('2024-01-15'),
        },
        {
          id: 'post-3',
          projectId: 'test-project',
          title: 'Post 3',
          slug: 'post-3',
          status: 'published',
          filePath: '/mock/userData/posts/2024/01/post-3.md',
          tags: '[]',
          categories: '[]',
          createdAt: new Date('2024-01-15'),
          updatedAt: new Date('2024-01-15'),
        },
      ];

      mockFileData.set('/mock/userData/posts/2024/01/post-3.md', `---\nid: post-3\nprojectId: test-project\ntitle: "Post 3"\nslug: post-3\nstatus: published\ntags: ["from-file"]\ncategories: []\n---\nContent`);

      const result = await engine.syncFileToDb(postIds, 'tags');

      expect(result).toEqual({ success: 1, failed: 2 });
      expect(mockLocalDb.update).toHaveBeenCalledTimes(1);
    });
  });

  // ── Media diff tests ──

  describe('compareMediaMetadata', () => {
    let mediaEngine: MetadataDiffEngine;
    const mockReadSidecarFile = vi.fn();

    beforeEach(() => {
      mediaEngine = new MetadataDiffEngine(
        undefined,
        { readSidecarFile: mockReadSidecarFile, getMedia: vi.fn(), updateMedia: vi.fn() } as any,
      );
      mediaEngine.setProjectContext('test-project');
    });

    it('should return null when media not found in DB', async () => {
      // (mock DB returns undefined for .get())
      const result = await mediaEngine.compareMediaMetadata('nonexistent');
      expect(result).toBeNull();
    });

    it('should detect title difference between DB and sidecar', async () => {
      const dbMedia = {
        id: 'media-1',
        projectId: 'test-project',
        originalName: 'photo.jpg',
        filePath: '/mock/media/photo.jpg',
        title: 'DB Title',
        alt: 'alt text',
        caption: '',
        author: '',
        tags: '[]',
      };
      mockPosts.set('media-1', dbMedia);
      // The select chain's .get() will return this via mockPosts
      // Override: media uses same mock DB, so route DB response:
      mockPostsGetQueue = [dbMedia];

      mockReadSidecarFile.mockResolvedValueOnce({
        id: 'media-1',
        originalName: 'photo.jpg',
        title: 'File Title',
        alt: 'alt text',
        caption: '',
        author: '',
        tags: [],
      });

      const result = await mediaEngine.compareMediaMetadata('media-1');
      expect(result).not.toBeNull();
      expect(result?.hasDifferences).toBe(true);
      expect(result?.differences.title).toEqual({ dbValue: 'DB Title', fileValue: 'File Title' });
    });

    it('should detect tag differences between DB and sidecar', async () => {
      const dbMedia = {
        id: 'media-2',
        projectId: 'test-project',
        originalName: 'photo.jpg',
        filePath: '/mock/media/photo.jpg',
        title: '',
        alt: '',
        caption: '',
        author: '',
        tags: '["tag1","tag2"]',
      };
      mockPostsGetQueue = [dbMedia];

      mockReadSidecarFile.mockResolvedValueOnce({
        id: 'media-2',
        originalName: 'photo.jpg',
        title: '',
        alt: '',
        caption: '',
        author: '',
        tags: ['tag1'],
      });

      const result = await mediaEngine.compareMediaMetadata('media-2');
      expect(result?.hasDifferences).toBe(true);
      expect(result?.differences.tags).toEqual({ dbValue: ['tag1', 'tag2'], fileValue: ['tag1'] });
    });

    it('should return hasDifferences=false when metadata matches', async () => {
      const dbMedia = {
        id: 'media-3',
        projectId: 'test-project',
        originalName: 'photo.jpg',
        filePath: '/mock/media/photo.jpg',
        title: 'Same',
        alt: 'Same alt',
        caption: '',
        author: '',
        tags: '["t1"]',
      };
      mockPostsGetQueue = [dbMedia];

      mockReadSidecarFile.mockResolvedValueOnce({
        title: 'Same',
        alt: 'Same alt',
        caption: '',
        author: '',
        tags: ['t1'],
      });

      const result = await mediaEngine.compareMediaMetadata('media-3');
      expect(result?.hasDifferences).toBe(false);
    });

    it('should flag when sidecar file is missing', async () => {
      const dbMedia = {
        id: 'media-4',
        projectId: 'test-project',
        originalName: 'photo.jpg',
        filePath: '/mock/media/photo.jpg',
        title: '',
        alt: '',
        caption: '',
        author: '',
        tags: '[]',
      };
      mockPostsGetQueue = [dbMedia];
      mockReadSidecarFile.mockResolvedValueOnce(null);

      const result = await mediaEngine.compareMediaMetadata('media-4');
      expect(result?.hasDifferences).toBe(true);
    });
  });

  // ── Script diff tests ──

  describe('compareScriptMetadata', () => {
    let scriptEngine: MetadataDiffEngine;
    const mockReadScriptFileWithMetadata = vi.fn();

    beforeEach(() => {
      scriptEngine = new MetadataDiffEngine(
        undefined,
        undefined,
        { readScriptFileWithMetadata: mockReadScriptFileWithMetadata, getScript: vi.fn(), updateScript: vi.fn() } as any,
      );
      scriptEngine.setProjectContext('test-project');
    });

    it('should skip draft scripts', async () => {
      mockPostsGetQueue = [{
        id: 'script-1',
        projectId: 'test-project',
        title: 'Draft Script',
        slug: 'draft-script',
        status: 'draft',
        kind: 'utility',
        entrypoint: 'render',
        enabled: true,
        version: 1,
        filePath: '/mock/scripts/draft.py',
      }];

      const result = await scriptEngine.compareScriptMetadata('script-1');
      expect(result).toBeNull();
    });

    it('should detect title difference between DB and file', async () => {
      mockPostsGetQueue = [{
        id: 'script-2',
        projectId: 'test-project',
        title: 'DB Title',
        slug: 'my-script',
        status: 'published',
        kind: 'macro',
        entrypoint: 'render',
        enabled: true,
        version: 3,
        filePath: '/mock/scripts/my-script.py',
      }];

      mockReadScriptFileWithMetadata.mockResolvedValueOnce({
        metadata: { title: 'File Title', kind: 'macro', entrypoint: 'render', enabled: true, version: 3 },
        body: '',
      });

      const result = await scriptEngine.compareScriptMetadata('script-2');
      expect(result?.hasDifferences).toBe(true);
      expect(result?.differences.title).toEqual({ dbValue: 'DB Title', fileValue: 'File Title' });
    });

    it('should detect version difference', async () => {
      mockPostsGetQueue = [{
        id: 'script-3',
        projectId: 'test-project',
        title: 'Script',
        slug: 'script',
        status: 'published',
        kind: 'utility',
        entrypoint: 'render',
        enabled: true,
        version: 5,
        filePath: '/mock/scripts/script.py',
      }];

      mockReadScriptFileWithMetadata.mockResolvedValueOnce({
        metadata: { title: 'Script', kind: 'utility', entrypoint: 'render', enabled: true, version: 3 },
        body: '',
      });

      const result = await scriptEngine.compareScriptMetadata('script-3');
      expect(result?.hasDifferences).toBe(true);
      expect(result?.differences.version).toEqual({ dbValue: 5, fileValue: 3 });
    });

    it('should return hasDifferences=false when metadata matches', async () => {
      mockPostsGetQueue = [{
        id: 'script-4',
        projectId: 'test-project',
        title: 'Same',
        slug: 'same',
        status: 'published',
        kind: 'utility',
        entrypoint: 'render',
        enabled: true,
        version: 1,
        filePath: '/mock/scripts/same.py',
      }];

      mockReadScriptFileWithMetadata.mockResolvedValueOnce({
        metadata: { title: 'Same', kind: 'utility', entrypoint: 'render', enabled: true, version: 1 },
        body: '',
      });

      const result = await scriptEngine.compareScriptMetadata('script-4');
      expect(result?.hasDifferences).toBe(false);
    });
  });

  // ── Template diff tests ──

  describe('compareTemplateMetadata', () => {
    let templateEngine: MetadataDiffEngine;
    const mockReadTemplateFileWithMetadata = vi.fn();

    beforeEach(() => {
      templateEngine = new MetadataDiffEngine(
        undefined,
        undefined,
        undefined,
        { readTemplateFileWithMetadata: mockReadTemplateFileWithMetadata, getTemplate: vi.fn(), updateTemplate: vi.fn() } as any,
      );
      templateEngine.setProjectContext('test-project');
    });

    it('should skip draft templates', async () => {
      mockPostsGetQueue = [{
        id: 'tpl-1',
        projectId: 'test-project',
        title: 'Draft Template',
        slug: 'draft-tpl',
        status: 'draft',
        kind: 'post',
        enabled: true,
        version: 1,
        filePath: '/mock/templates/draft.liquid',
      }];

      const result = await templateEngine.compareTemplateMetadata('tpl-1');
      expect(result).toBeNull();
    });

    it('should detect kind difference between DB and file', async () => {
      mockPostsGetQueue = [{
        id: 'tpl-2',
        projectId: 'test-project',
        title: 'Template',
        slug: 'template',
        status: 'published',
        kind: 'post',
        enabled: true,
        version: 1,
        filePath: '/mock/templates/template.liquid',
      }];

      mockReadTemplateFileWithMetadata.mockResolvedValueOnce({
        metadata: { title: 'Template', kind: 'list', enabled: true, version: 1 },
        body: '',
      });

      const result = await templateEngine.compareTemplateMetadata('tpl-2');
      expect(result?.hasDifferences).toBe(true);
      expect(result?.differences.kind).toEqual({ dbValue: 'post', fileValue: 'list' });
    });

    it('should detect enabled difference', async () => {
      mockPostsGetQueue = [{
        id: 'tpl-3',
        projectId: 'test-project',
        title: 'Tpl',
        slug: 'tpl',
        status: 'published',
        kind: 'post',
        enabled: true,
        version: 1,
        filePath: '/mock/templates/tpl.liquid',
      }];

      mockReadTemplateFileWithMetadata.mockResolvedValueOnce({
        metadata: { title: 'Tpl', kind: 'post', enabled: false, version: 1 },
        body: '',
      });

      const result = await templateEngine.compareTemplateMetadata('tpl-3');
      expect(result?.hasDifferences).toBe(true);
      expect(result?.differences.enabled).toEqual({ dbValue: true, fileValue: false });
    });

    it('should return hasDifferences=false when metadata matches', async () => {
      mockPostsGetQueue = [{
        id: 'tpl-4',
        projectId: 'test-project',
        title: 'Same',
        slug: 'same',
        status: 'published',
        kind: 'partial',
        enabled: true,
        version: 2,
        filePath: '/mock/templates/same.liquid',
      }];

      mockReadTemplateFileWithMetadata.mockResolvedValueOnce({
        metadata: { title: 'Same', kind: 'partial', enabled: true, version: 2 },
        body: '',
      });

      const result = await templateEngine.compareTemplateMetadata('tpl-4');
      expect(result?.hasDifferences).toBe(false);
    });
  });

  // ── getTableStats with expanded counts ──

  describe('getTableStats (expanded)', () => {
    it('should include script and template counts', async () => {
      mockLocalClient.execute
        .mockResolvedValueOnce({ rows: [{ count: 10 }] })   // total posts
        .mockResolvedValueOnce({ rows: [{ count: 8 }] })    // published posts
        .mockResolvedValueOnce({ rows: [{ count: 2 }] })    // draft posts
        .mockResolvedValueOnce({ rows: [{ count: 50 }] })   // total media
        .mockResolvedValueOnce({ rows: [{ count: 5 }] })    // total scripts
        .mockResolvedValueOnce({ rows: [{ count: 4 }] })    // published scripts
        .mockResolvedValueOnce({ rows: [{ count: 7 }] })    // total templates
        .mockResolvedValueOnce({ rows: [{ count: 6 }] });   // published templates

      const stats = await engine.getTableStats();
      expect(stats).toEqual({
        totalPosts: 10,
        publishedPosts: 8,
        draftPosts: 2,
        totalMedia: 50,
        totalScripts: 5,
        publishedScripts: 4,
        totalTemplates: 7,
        publishedTemplates: 6,
      });
    });
  });
});
