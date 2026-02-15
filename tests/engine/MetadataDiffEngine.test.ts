/**
 * MetadataDiffEngine Unit Tests
 *
 * Tests the REAL MetadataDiffEngine class with mocked dependencies.
 * Following TDD best practices: mock external dependencies, test real implementation.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MetadataDiffEngine, PostMetadataDiff, DiffGroup, DiffField } from '../../src/main/engine/MetadataDiffEngine';
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
    engine = new MetadataDiffEngine();
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
  });
});
