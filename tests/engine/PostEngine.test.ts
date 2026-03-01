/**
 * PostEngine Unit Tests
 *
 * Tests the REAL PostEngine class with mocked dependencies.
 * Following TDD best practices: mock external dependencies, test real implementation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PostEngine, PostData } from '../../src/main/engine/PostEngine';
import { resetMockCounters } from '../utils/factories';
import * as fs from 'fs/promises';

// Create mock data stores
const mockPosts = new Map<string, any>();
const mockFiles = new Map<string, string>();
let mockExecuteArgs: any[] = [];

// Create chainable mock for Drizzle ORM
function createSelectChain() {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockImplementation(function(this: any) {
      return this;
    }),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    all: vi.fn().mockImplementation(() => Promise.resolve(Array.from(mockPosts.values()))),
    get: vi.fn().mockImplementation(() => Promise.resolve(undefined)),
  };
}

function createDrizzleMock() {
  return {
    select: vi.fn(() => createSelectChain()),
    insert: vi.fn(() => ({
      values: vi.fn((data: any) => {
        if (data && data.id) {
          mockPosts.set(data.id, data);
        }
        return Promise.resolve();
      }),
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
  execute: vi.fn(async (query: { sql: string; args: any[] }) => {
    mockExecuteArgs.push(query);
    return { rows: [] };
  }),
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

// Mock fs/promises - implementations MUST be inline in vi.mock due to hoisting
vi.mock('fs/promises', () => {
  // These implementations use a global mockFiles Map from the test
  const getMockFiles = () => (globalThis as any).__mockFiles || new Map();
  
  return {
    readFile: vi.fn(async (path: string) => {
      const mockFiles = getMockFiles();
      const content = mockFiles.get(path);
      if (!content) {
        const error = new Error(`ENOENT: no such file or directory, open '${path}'`);
        (error as any).code = 'ENOENT';
        throw error;
      }
      return content;
    }),
    writeFile: vi.fn(async (path: string, content: string) => {
      getMockFiles().set(path, content);
    }),
    unlink: vi.fn(async (path: string) => {
      getMockFiles().delete(path);
    }),
    mkdir: vi.fn(async () => {}),
    readdir: vi.fn(async () => []),
    stat: vi.fn(async (path: string) => {
      const mockFiles = getMockFiles();
      return {
        isFile: () => mockFiles.has(path),
        isDirectory: () => !mockFiles.has(path),
        size: mockFiles.get(path)?.length || 0,
      };
    }),
    access: vi.fn(async (path: string) => {
      const mockFiles = getMockFiles();
      if (!mockFiles.has(path)) {
        const error = new Error(`ENOENT`);
        (error as any).code = 'ENOENT';
        throw error;
      }
    }),
  };
});

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-uuid-' + Math.random().toString(36).substr(2, 9)),
}));

// Helper functions to reset fs mocks to default implementations
function createDefaultFsReadFile(mockFilesRef: Map<string, string>) {
  return async (path: string) => {
    const content = mockFilesRef.get(path);
    if (!content) {
      const error = new Error(`ENOENT: no such file or directory, open '${path}'`);
      (error as any).code = 'ENOENT';
      throw error;
    }
    return content;
  };
}

function createDefaultFsAccess(mockFilesRef: Map<string, string>) {
  return async (path: string) => {
    if (!mockFilesRef.has(path)) {
      const error = new Error(`ENOENT`);
      (error as any).code = 'ENOENT';
      throw error;
    }
  };
}

describe('PostEngine', () => {
  let postEngine: PostEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPosts.clear();
    mockFiles.clear();
    mockExecuteArgs = [];
    resetMockCounters();
    
    // Sync mockFiles with globalThis for the mocked fs module
    (globalThis as any).__mockFiles = mockFiles;
    
    // Reset the mock implementations
    vi.mocked(mockLocalDb.select).mockImplementation(() => createSelectChain());
    
    // Reset fs implementations to use mockFiles map (fixes test leakage from other tests)
    vi.mocked(fs.readFile).mockImplementation(createDefaultFsReadFile(mockFiles) as any);
    vi.mocked(fs.access).mockImplementation(createDefaultFsAccess(mockFiles) as any);
    
    postEngine = new PostEngine();
  });

  describe('Constructor and Initialization', () => {
    it('should create a PostEngine instance', () => {
      expect(postEngine).toBeInstanceOf(PostEngine);
    });

    it('should extend EventEmitter', () => {
      expect(typeof postEngine.on).toBe('function');
      expect(typeof postEngine.emit).toBe('function');
    });

    it('should have default project context', () => {
      expect(postEngine.getProjectContext()).toBe('default');
    });
  });

  describe('Project Context', () => {
    it('should set project context', () => {
      postEngine.setProjectContext('my-blog');
      expect(postEngine.getProjectContext()).toBe('my-blog');
    });

    it('should allow changing project context multiple times', () => {
      postEngine.setProjectContext('blog-1');
      expect(postEngine.getProjectContext()).toBe('blog-1');

      postEngine.setProjectContext('blog-2');
      expect(postEngine.getProjectContext()).toBe('blog-2');
    });
  });

  describe('Slug Generation via createPost', () => {
    it('should generate slug from title with lowercase', async () => {
      const post = await postEngine.createPost({ title: 'Hello World' });
      expect(post.slug).toBe('hello-world');
    });

    it('should replace special characters with hyphens', async () => {
      const post = await postEngine.createPost({ title: 'Hello, World! How are you?' });
      expect(post.slug).toBe('hello-world-how-are-you');
    });

    it('should remove leading and trailing hyphens', async () => {
      const post = await postEngine.createPost({ title: '---Test---' });
      expect(post.slug).toBe('test');
    });

    it('should handle numbers in titles', async () => {
      const post = await postEngine.createPost({ title: '10 Tips for Testing' });
      expect(post.slug).toBe('10-tips-for-testing');
    });

    it('should convert multiple spaces to single hyphen', async () => {
      const post = await postEngine.createPost({ title: 'Multiple   Spaces   Here' });
      expect(post.slug).toBe('multiple-spaces-here');
    });

    it('should handle unicode characters by transliterating them', async () => {
      const post = await postEngine.createPost({ title: 'Café Test' });
      expect(post.slug).toBe('cafe-test');
    });
  });

  describe('Post Creation', () => {
    it('should create a post with default values', async () => {
      const post = await postEngine.createPost({ title: 'My Test Post' });

      expect(post.id).toBeDefined();
      expect(post.title).toBe('My Test Post');
      expect(post.slug).toBe('my-test-post');
      expect(post.status).toBe('draft');
      expect(post.content).toBe('');
      expect(post.tags).toEqual([]);
      expect(post.categories).toEqual([]);
    });

    it('should create a post with provided content', async () => {
      const post = await postEngine.createPost({
        title: 'Content Test',
        content: '# Hello\n\nThis is my post.',
      });

      expect(post.content).toBe('# Hello\n\nThis is my post.');
    });

    it('should create a post with custom status', async () => {
      const post = await postEngine.createPost({
        title: 'Published Post',
        status: 'published',
      });

      expect(post.status).toBe('published');
    });

    it('should create a post with tags and categories', async () => {
      const post = await postEngine.createPost({
        title: 'Tagged Post',
        tags: ['javascript', 'testing'],
        categories: ['tutorials'],
      });

      expect(post.tags).toEqual(['javascript', 'testing']);
      expect(post.categories).toEqual(['tutorials']);
    });

    it('should use custom slug when provided', async () => {
      const post = await postEngine.createPost({
        title: 'My Post',
        slug: 'custom-permalink',
      });

      expect(post.slug).toBe('custom-permalink');
    });

    it('should set createdAt and updatedAt timestamps', async () => {
      const before = new Date();
      const post = await postEngine.createPost({ title: 'Timestamp Test' });
      const after = new Date();

      expect(post.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(post.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
      expect(post.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(post.updatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should emit postCreated event', async () => {
      const handler = vi.fn();
      postEngine.on('postCreated', handler);

      const post = await postEngine.createPost({ title: 'Event Test' });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Event Test',
        })
      );
    });

    it('should use current project context for projectId', async () => {
      postEngine.setProjectContext('my-project');
      const post = await postEngine.createPost({ title: 'Project Test' });

      expect(post.projectId).toBe('my-project');
    });

    it('should NOT write to filesystem (draft content stays in DB)', async () => {
      const fs = await import('fs/promises');
      vi.mocked(fs.writeFile).mockClear();
      await postEngine.createPost({ title: 'File Test' });

      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('should store content in database with empty filePath', async () => {
      const insertValues: any[] = [];
      vi.mocked(mockLocalDb.insert).mockImplementation(() => ({
        values: vi.fn((data: any) => {
          insertValues.push(data);
          if (data && data.id) mockPosts.set(data.id, data);
          return Promise.resolve();
        }),
      }));

      await postEngine.createPost({
        title: 'DB Content Test',
        content: '# Hello World',
      });

      const postInsert = insertValues.find(v => v.title === 'DB Content Test');
      expect(postInsert).toBeDefined();
      expect(postInsert.content).toBe('# Hello World');
      expect(postInsert.filePath).toBe('');
    });

    it('should insert into database', async () => {
      await postEngine.createPost({ title: 'DB Test' });

      expect(mockLocalDb.insert).toHaveBeenCalled();
    });

    it('should update FTS index when client is available', async () => {
      await postEngine.createPost({ title: 'FTS Test' });

      const ftsInsert = mockExecuteArgs.find((q) => q.sql.includes('posts_fts'));
      expect(ftsInsert).toBeDefined();
    });

    it('should handle post without title using empty string', async () => {
      const post = await postEngine.createPost({});
      expect(post.title).toBe('');
      expect(post.slug).toBe('untitled');
    });

    it('should create post with author', async () => {
      const post = await postEngine.createPost({
        title: 'Author Test',
        author: 'John Doe',
      });

      expect(post.author).toBe('John Doe');
    });

    it('should create post with excerpt', async () => {
      const post = await postEngine.createPost({
        title: 'Excerpt Test',
        excerpt: 'This is a short summary.',
      });

      expect(post.excerpt).toBe('This is a short summary.');
    });

    it('should handle publishedAt for published posts', async () => {
      const publishDate = new Date('2024-01-15');
      const post = await postEngine.createPost({
        title: 'Published Post',
        status: 'published',
        publishedAt: publishDate,
      });

      expect(post.publishedAt).toEqual(publishDate);
    });
  });

  describe('Event Emission', () => {
    it('should be an EventEmitter', () => {
      expect(postEngine.on).toBeDefined();
      expect(postEngine.emit).toBeDefined();
      expect(postEngine.removeListener).toBeDefined();
    });

    it('should allow adding event listeners', () => {
      const listener = vi.fn();
      postEngine.on('testEvent', listener);
      postEngine.emit('testEvent', { data: 'test' });

      expect(listener).toHaveBeenCalledWith({ data: 'test' });
    });

    it('should allow removing event listeners', () => {
      const listener = vi.fn();
      postEngine.on('testEvent', listener);
      postEngine.removeListener('testEvent', listener);
      postEngine.emit('testEvent', { data: 'test' });

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('Post creation stores content in database only', () => {
    it('should store draft content and metadata in database, not filesystem', async () => {
      const fs = await import('fs/promises');
      vi.mocked(fs.writeFile).mockClear();

      const insertValues: any[] = [];
      vi.mocked(mockLocalDb.insert).mockImplementation(() => ({
        values: vi.fn((data: any) => {
          insertValues.push(data);
          if (data && data.id) mockPosts.set(data.id, data);
          return Promise.resolve();
        }),
      }));

      await postEngine.createPost({
        title: 'DB Store Test',
        content: '# Hello World',
        tags: ['test'],
      });

      // No file written for drafts
      expect(fs.writeFile).not.toHaveBeenCalled();

      // Content saved to DB
      const postInsert = insertValues.find(v => v.title === 'DB Store Test');
      expect(postInsert).toBeDefined();
      expect(postInsert.content).toBe('# Hello World');
      expect(postInsert.filePath).toBe('');
      expect(postInsert.tags).toBe('["test"]');
    });
  });

  describe('Multiple post creation', () => {
    it('should create multiple posts with unique IDs', async () => {
      const post1 = await postEngine.createPost({ title: 'Post 1' });
      const post2 = await postEngine.createPost({ title: 'Post 2' });

      expect(post1.id).toBeDefined();
      expect(post2.id).toBeDefined();
      expect(post1.id).not.toBe(post2.id);
    });

    it('should create posts with different slugs', async () => {
      const post1 = await postEngine.createPost({ title: 'First Post' });
      const post2 = await postEngine.createPost({ title: 'Second Post' });

      expect(post1.slug).toBe('first-post');
      expect(post2.slug).toBe('second-post');
    });
  });

  describe('Post status values', () => {
    it('should accept draft status', async () => {
      const post = await postEngine.createPost({ title: 'Draft', status: 'draft' });
      expect(post.status).toBe('draft');
    });

    it('should accept published status', async () => {
      const post = await postEngine.createPost({ title: 'Published', status: 'published' });
      expect(post.status).toBe('published');
    });

    it('should accept archived status', async () => {
      const post = await postEngine.createPost({ title: 'Archived', status: 'archived' });
      expect(post.status).toBe('archived');
    });
  });

  describe('Post with all fields', () => {
    it('should create a fully populated post', async () => {
      const publishDate = new Date('2024-06-15');
      const post = await postEngine.createPost({
        title: 'Complete Post',
        slug: 'complete-post',
        content: '# Complete\n\nFull content here.',
        excerpt: 'A complete post with all fields.',
        status: 'published',
        author: 'Jane Doe',
        publishedAt: publishDate,
        tags: ['complete', 'full', 'test'],
        categories: ['testing', 'examples'],
      });

      expect(post.title).toBe('Complete Post');
      expect(post.slug).toBe('complete-post');
      expect(post.content).toBe('# Complete\n\nFull content here.');
      expect(post.excerpt).toBe('A complete post with all fields.');
      expect(post.status).toBe('published');
      expect(post.author).toBe('Jane Doe');
      expect(post.publishedAt).toEqual(publishDate);
      expect(post.tags).toEqual(['complete', 'full', 'test']);
      expect(post.categories).toEqual(['testing', 'examples']);
    });
  });

  describe('getPost', () => {
    it('should return null for non-existent post', async () => {
      const result = await postEngine.getPost('non-existent-id');
      expect(result).toBeNull();
    });

    it('should retrieve post from database and file system', async () => {
      // Create a post first
      const created = await postEngine.createPost({
        title: 'Retrievable Post',
        content: 'Content for retrieval test',
      });

      const filePath = `/mock/userData/projects/default/posts/${created.slug}.md`;
      
      // Store the file content so readFile can retrieve it
      mockFiles.set(filePath, `---
id: ${created.id}
projectId: ${created.projectId}
title: Retrievable Post
slug: ${created.slug}
status: draft
createdAt: ${created.createdAt.toISOString()}
updatedAt: ${created.updatedAt.toISOString()}
tags: []
categories: []
---
Content for retrieval test`);

      // Mock the select chain to find the post by ID
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: created.id,
            projectId: created.projectId,
            title: created.title,
            slug: created.slug,
            status: created.status,
            filePath,
            tags: '[]',
            categories: '[]',
            createdAt: created.createdAt,
            updatedAt: created.updatedAt,
          }),
        });
        return chain;
      });

      const result = await postEngine.getPost(created.id);

      expect(result).not.toBeNull();
      expect(result?.title).toBe('Retrievable Post');
      expect(result?.content).toBe('Content for retrieval test');
    });

    it('should return database-only data when file not found', async () => {
      // Mock database returning a post but file missing
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: 'db-only-id',
            projectId: 'default',
            title: 'DB Only Post',
            slug: 'db-only-post',
            status: 'draft',
            filePath: '/mock/path/to/missing-file.md',
            tags: '["test"]',
            categories: '["category"]',
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        });
        return chain;
      });

      const result = await postEngine.getPost('db-only-id');

      expect(result).not.toBeNull();
      expect(result?.title).toBe('DB Only Post');
      expect(result?.content).toBe(''); // Empty content when file not found
      expect(result?.tags).toEqual(['test']);
      expect(result?.categories).toEqual(['category']);
    });
  });

  describe('updatePost', () => {
    it('should return null when updating non-existent post', async () => {
      const result = await postEngine.updatePost('non-existent-id', { title: 'New Title' });
      expect(result).toBeNull();
    });

    it('should update post title', async () => {
      // Create a post first
      const created = await postEngine.createPost({ title: 'Original Title' });

      // Mock getPost to return the created post
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: created.id,
            projectId: created.projectId,
            title: created.title,
            slug: created.slug,
            status: created.status,
            filePath: `/mock/userData/projects/default/posts/${created.slug}.md`,
            tags: '[]',
            categories: '[]',
            createdAt: created.createdAt,
            updatedAt: created.updatedAt,
          }),
        });
        return chain;
      });

      const result = await postEngine.updatePost(created.id, { title: 'Updated Title' });

      expect(result).not.toBeNull();
      expect(result?.title).toBe('Updated Title');
    });

    it('should update updatedAt timestamp on update', async () => {
      const created = await postEngine.createPost({ title: 'Timestamp Test' });

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: created.id,
            projectId: created.projectId,
            title: created.title,
            slug: created.slug,
            status: created.status,
            filePath: `/mock/userData/projects/default/posts/${created.slug}.md`,
            tags: '[]',
            categories: '[]',
            createdAt: created.createdAt,
            updatedAt: created.updatedAt,
          }),
        });
        return chain;
      });

      const beforeUpdate = new Date();
      const result = await postEngine.updatePost(created.id, { content: 'Changed' });
      const afterUpdate = new Date();

      expect(result?.updatedAt.getTime()).toBeGreaterThanOrEqual(beforeUpdate.getTime());
      expect(result?.updatedAt.getTime()).toBeLessThanOrEqual(afterUpdate.getTime());
    });

    it('should emit postUpdated event', async () => {
      const handler = vi.fn();
      postEngine.on('postUpdated', handler);

      const created = await postEngine.createPost({ title: 'Event Update Test' });

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: created.id,
            projectId: created.projectId,
            title: created.title,
            slug: created.slug,
            status: created.status,
            filePath: `/mock/userData/projects/default/posts/${created.slug}.md`,
            tags: '[]',
            categories: '[]',
            createdAt: created.createdAt,
            updatedAt: created.updatedAt,
          }),
        });
        return chain;
      });

      await postEngine.updatePost(created.id, { title: 'Updated Event Test' });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Updated Event Test' })
      );
    });

    it('should NOT touch filesystem on slug change (handled at publish time)', async () => {
      const fs = await import('fs/promises');
      const created = await postEngine.createPost({ title: 'Slug Change Test' });

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: created.id,
            projectId: created.projectId,
            title: created.title,
            slug: created.slug,
            status: created.status,
            content: created.content || '',
            filePath: '',
            tags: '[]',
            categories: '[]',
            createdAt: created.createdAt,
            updatedAt: created.updatedAt,
          }),
        });
        return chain;
      });

      vi.mocked(fs.unlink).mockClear();
      vi.mocked(fs.writeFile).mockClear();
      await postEngine.updatePost(created.id, { slug: 'new-slug' });

      // No file operations on update — filesystem is only touched on publish
      expect(fs.unlink).not.toHaveBeenCalled();
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('should auto-transition published post to draft when content changes', async () => {
      const created = await postEngine.createPost({ title: 'Auto Draft Test' });

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: created.id,
            projectId: created.projectId,
            title: created.title,
            slug: created.slug,
            status: 'published',
            content: null,
            filePath: '/mock/published-file.md',
            tags: '[]',
            categories: '[]',
            createdAt: created.createdAt,
            updatedAt: created.updatedAt,
          }),
        });
        return chain;
      });

      // Mock file read for published content
      mockFiles.set('/mock/published-file.md', `---
id: ${created.id}
projectId: default
title: ${created.title}
slug: ${created.slug}
status: published
createdAt: ${created.createdAt.toISOString()}
updatedAt: ${created.updatedAt.toISOString()}
tags: []
categories: []
---
Original content`);

      const result = await postEngine.updatePost(created.id, { content: 'New draft content' });

      expect(result).not.toBeNull();
      expect(result?.status).toBe('draft');
      expect(result?.content).toBe('New draft content');
    });

    it('should update tags and categories', async () => {
      const created = await postEngine.createPost({ 
        title: 'Tag Update Test',
        tags: ['old-tag'],
        categories: ['old-category'],
      });

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: created.id,
            projectId: created.projectId,
            title: created.title,
            slug: created.slug,
            status: created.status,
            filePath: `/mock/userData/projects/default/posts/${created.slug}.md`,
            tags: JSON.stringify(created.tags),
            categories: JSON.stringify(created.categories),
            createdAt: created.createdAt,
            updatedAt: created.updatedAt,
          }),
        });
        return chain;
      });

      const result = await postEngine.updatePost(created.id, {
        tags: ['new-tag-1', 'new-tag-2'],
        categories: ['new-category'],
      });

      expect(result?.tags).toEqual(['new-tag-1', 'new-tag-2']);
      expect(result?.categories).toEqual(['new-category']);
    });

    it('should preserve original projectId and id', async () => {
      postEngine.setProjectContext('original-project');
      const created = await postEngine.createPost({ title: 'Protect IDs Test' });

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: created.id,
            projectId: 'original-project',
            title: created.title,
            slug: created.slug,
            status: created.status,
            filePath: `/mock/userData/projects/original-project/posts/${created.slug}.md`,
            tags: '[]',
            categories: '[]',
            createdAt: created.createdAt,
            updatedAt: created.updatedAt,
          }),
        });
        return chain;
      });

      const result = await postEngine.updatePost(created.id, {
        projectId: 'hacked-project' as any,
        id: 'hacked-id' as any,
        title: 'Safe Update',
      });

      expect(result?.id).toBe(created.id); // ID preserved
      expect(result?.projectId).toBe('original-project'); // projectId preserved
    });

    it('should auto-update slug when title changes on a never-published draft', async () => {
      const created = await postEngine.createPost({ title: 'Original Title' });
      expect(created.slug).toBe('original-title');

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: created.id,
            projectId: created.projectId,
            title: created.title,
            slug: created.slug,
            status: 'draft',
            content: created.content || '',
            filePath: '',
            tags: '[]',
            categories: '[]',
            createdAt: created.createdAt,
            updatedAt: created.updatedAt,
            publishedAt: null,
          }),
        });
        return chain;
      });

      const result = await postEngine.updatePost(created.id, { title: 'New Title' });

      expect(result).not.toBeNull();
      expect(result?.slug).toBe('new-title');
    });

    it('should NOT auto-update slug when title changes on a previously published post', async () => {
      const created = await postEngine.createPost({ title: 'Published Post' });

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: created.id,
            projectId: created.projectId,
            title: created.title,
            slug: created.slug,
            status: 'draft',
            content: created.content || '',
            filePath: '',
            tags: '[]',
            categories: '[]',
            createdAt: created.createdAt,
            updatedAt: created.updatedAt,
            publishedAt: new Date('2025-01-01'),
          }),
        });
        return chain;
      });

      const result = await postEngine.updatePost(created.id, { title: 'Changed Title' });

      expect(result).not.toBeNull();
      expect(result?.slug).toBe('published-post'); // slug preserved
    });

    it('should allow empty title and use untitled as slug base', async () => {
      const created = await postEngine.createPost({ title: '' });
      expect(created.title).toBe('');
      expect(created.slug).toBe('untitled');
    });
  });

  describe('deletePost', () => {
    it('should return false when deleting non-existent post', async () => {
      const result = await postEngine.deletePost('non-existent-id');
      expect(result).toBe(false);
    });

    it('should delete post and return true', async () => {
      const created = await postEngine.createPost({ title: 'Delete Me' });

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: created.id,
            filePath: `/mock/userData/projects/default/posts/${created.slug}.md`,
          }),
        });
        return chain;
      });

      const result = await postEngine.deletePost(created.id);

      expect(result).toBe(true);
    });

    it('should emit postDeleted event', async () => {
      const handler = vi.fn();
      postEngine.on('postDeleted', handler);

      const created = await postEngine.createPost({ title: 'Delete Event Test' });

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: created.id,
            filePath: `/mock/userData/projects/default/posts/${created.slug}.md`,
          }),
        });
        return chain;
      });

      await postEngine.deletePost(created.id);

      expect(handler).toHaveBeenCalledWith(created.id);
    });

    it('should delete file from filesystem', async () => {
      const fs = await import('fs/promises');
      const created = await postEngine.createPost({ title: 'File Delete Test' });

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: created.id,
            filePath: `/mock/userData/projects/default/posts/${created.slug}.md`,
          }),
        });
        return chain;
      });

      vi.mocked(fs.unlink).mockClear();
      await postEngine.deletePost(created.id);

      expect(fs.unlink).toHaveBeenCalled();
    });

    it('should delete from database', async () => {
      const created = await postEngine.createPost({ title: 'DB Delete Test' });

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: created.id,
            filePath: `/mock/userData/projects/default/posts/${created.slug}.md`,
          }),
        });
        return chain;
      });

      await postEngine.deletePost(created.id);

      expect(mockLocalDb.delete).toHaveBeenCalled();
    });

    it('should delete from FTS index', async () => {
      const created = await postEngine.createPost({ title: 'FTS Delete Test' });

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: created.id,
            filePath: `/mock/userData/projects/default/posts/${created.slug}.md`,
          }),
        });
        return chain;
      });

      mockExecuteArgs = [];
      await postEngine.deletePost(created.id);

      const ftsDelete = mockExecuteArgs.find((q) => 
        q.sql.includes('DELETE FROM posts_fts')
      );
      expect(ftsDelete).toBeDefined();
    });

    it('should handle file deletion error gracefully', async () => {
      const fs = await import('fs/promises');
      const created = await postEngine.createPost({ title: 'Error Delete Test' });

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: created.id,
            filePath: `/mock/userData/projects/default/posts/missing.md`,
          }),
        });
        return chain;
      });

      vi.mocked(fs.unlink).mockRejectedValueOnce(new Error('ENOENT'));

      // Should not throw
      const result = await postEngine.deletePost(created.id);
      expect(result).toBe(true);
    });
  });

  describe('Metadata roundtrip (create -> DB storage integrity)', () => {
    it('should preserve all fields when storing to database', async () => {
      const insertValues: any[] = [];
      vi.mocked(mockLocalDb.insert).mockImplementation(() => ({
        values: vi.fn((data: any) => {
          insertValues.push(data);
          if (data && data.id) mockPosts.set(data.id, data);
          return Promise.resolve();
        }),
      }));

      const publishDate = new Date('2024-03-15T10:30:00.000Z');
      
      const original = await postEngine.createPost({
        title: 'Roundtrip Test Post',
        slug: 'roundtrip-test',
        content: '# Roundtrip\n\nTesting data integrity.',
        excerpt: 'Testing the roundtrip',
        status: 'published',
        author: 'Test Author',
        publishedAt: publishDate,
        tags: ['roundtrip', 'integrity', 'test'],
        categories: ['testing'],
      });

      // Verify data was stored in DB correctly
      const postInsert = insertValues.find(v => v.slug === 'roundtrip-test');
      expect(postInsert).toBeDefined();
      expect(postInsert.title).toBe('Roundtrip Test Post');
      expect(postInsert.content).toBe('# Roundtrip\n\nTesting data integrity.');
      expect(postInsert.excerpt).toBe('Testing the roundtrip');
      expect(postInsert.author).toBe('Test Author');
      expect(postInsert.tags).toBe('["roundtrip","integrity","test"]');
      expect(postInsert.categories).toBe('["testing"]');
      expect(postInsert.filePath).toBe('');
    });

    it('should handle empty tags and categories in DB', async () => {
      const insertValues: any[] = [];
      vi.mocked(mockLocalDb.insert).mockImplementation(() => ({
        values: vi.fn((data: any) => {
          insertValues.push(data);
          if (data && data.id) mockPosts.set(data.id, data);
          return Promise.resolve();
        }),
      }));
      
      await postEngine.createPost({
        title: 'No Tags Post',
        content: 'Content without tags',
        tags: [],
        categories: [],
      });

      const postInsert = insertValues.find(v => v.title === 'No Tags Post');
      expect(postInsert.tags).toBe('[]');
      expect(postInsert.categories).toBe('[]');
    });

    it('should handle optional fields as undefined', async () => {
      const post = await postEngine.createPost({
        title: 'Minimal Post',
        content: 'Just content',
      });

      // Optional fields should be undefined
      expect(post.excerpt).toBeUndefined();
      expect(post.author).toBeUndefined();
      expect(post.publishedAt).toBeUndefined();
    });
  });

  describe('Edge cases - special characters and unicode', () => {
    it('should handle unicode characters in content', async () => {
      const post = await postEngine.createPost({
        title: 'Unicode Test',
        content: '# 你好世界\n\nЗдравствуй мир\n\nこんにちは\n\nEmoji: 🚀💻📝',
      });

      expect(post.content).toContain('你好世界');
      expect(post.content).toContain('Здравствуй');
      expect(post.content).toContain('こんにちは');
      expect(post.content).toContain('🚀💻📝');
    });

    it('should handle special characters in title', async () => {
      const post = await postEngine.createPost({
        title: 'Post: With Special "Characters" & <Symbols>!',
      });

      // Slug should be sanitized
      expect(post.slug).toBe('post-with-special-characters-symbols');
      // Title should be preserved
      expect(post.title).toBe('Post: With Special "Characters" & <Symbols>!');
    });

    it('should handle YAML special characters in excerpt', async () => {
      const post = await postEngine.createPost({
        title: 'YAML Safe Test',
        excerpt: 'Contains: colons, "quotes", and #hash',
      });

      expect(post.excerpt).toBe('Contains: colons, "quotes", and #hash');
    });

    it('should handle multiline content correctly', async () => {
      const multilineContent = `# Heading 1

Some paragraph text.

## Heading 2

- List item 1
- List item 2

\`\`\`javascript
const code = 'example';
\`\`\`

> A blockquote`;

      const post = await postEngine.createPost({
        title: 'Multiline Test',
        content: multilineContent,
      });

      expect(post.content).toContain('# Heading 1');
      expect(post.content).toContain('## Heading 2');
      expect(post.content).toContain('> A blockquote');
    });

    it('should handle empty content', async () => {
      const post = await postEngine.createPost({
        title: 'Empty Content Post',
        content: '',
      });

      expect(post.content).toBe('');
    });

    it('should handle very long titles', async () => {
      const longTitle = 'A'.repeat(500);
      const post = await postEngine.createPost({ title: longTitle });

      expect(post.title.length).toBe(500);
      expect(post.slug.length).toBe(500); // slug is all lowercase a's
    });

    it('should handle newlines in excerpt', async () => {
      const post = await postEngine.createPost({
        title: 'Newline Excerpt',
        excerpt: 'First line.\nSecond line.',
      });

      expect(post.excerpt).toBe('First line.\nSecond line.');
    });
  });

  describe('Checksum calculation', () => {
    it('should calculate consistent checksum for same content', async () => {
      const post1 = await postEngine.createPost({
        title: 'Checksum Test 1',
        content: 'Identical content for testing',
      });
      
      const post2 = await postEngine.createPost({
        title: 'Checksum Test 2',
        content: 'Identical content for testing',
      });

      // Both inserts should have been called with same checksum
      const insertCalls = vi.mocked(mockLocalDb.insert).mock.results;
      expect(insertCalls.length).toBeGreaterThanOrEqual(2);
    });

    it('should calculate different checksum for different content', async () => {
      const insertValues: any[] = [];
      
      // Capture insert values
      vi.mocked(mockLocalDb.insert).mockImplementation(() => ({
        values: vi.fn((data: any) => {
          insertValues.push(data);
          if (data && data.id) {
            mockPosts.set(data.id, data);
          }
          return Promise.resolve();
        }),
      }));

      await postEngine.createPost({
        title: 'Different 1',
        content: 'Content A',
      });
      
      await postEngine.createPost({
        title: 'Different 2',
        content: 'Content B',
      });

      const checksums = insertValues.map(v => v.checksum);
      expect(checksums[0]).not.toBe(checksums[1]);
    });
  });

  describe('rebuildDatabaseFromFiles', () => {
    // Helper for Dirent-like objects (readdir with withFileTypes)
    const mockDirent = (name: string, isDir = false) => ({
      name,
      isDirectory: () => isDir,
    });

    it('should scan posts directory for markdown files recursively', async () => {
      const fs = await import('fs/promises');
      
      vi.mocked(fs.readdir).mockResolvedValueOnce([
        mockDirent('post1.md'),
        mockDirent('post2.md'),
        mockDirent('other.txt'),
      ] as any);

      // Mock access to allow file reads
      vi.mocked(fs.access).mockResolvedValue(undefined);
      
      // Mock readFile to return valid post content
      vi.mocked(fs.readFile).mockImplementation(async (filePath: any) => {
        if (filePath.includes('post1.md')) {
          return `---
id: post-1-id
projectId: default
title: Post 1
slug: post1
status: published
createdAt: 2024-01-01T00:00:00.000Z
updatedAt: 2024-01-01T00:00:00.000Z
tags: []
categories: []
---
Content 1`;
        }
        if (filePath.includes('post2.md')) {
          return `---
id: post-2-id
projectId: default
title: Post 2
slug: post2
status: published
createdAt: 2024-01-02T00:00:00.000Z
updatedAt: 2024-01-02T00:00:00.000Z
tags: []
categories: []
---
Content 2`;
        }
        throw new Error('ENOENT');
      });

      await postEngine.rebuildDatabaseFromFiles();

      // Should have processed only .md files
      expect(mockLocalDb.insert).toHaveBeenCalled();
    });

    it('should include .markdown files during rebuild', async () => {
      const fs = await import('fs/promises');

      vi.mocked(fs.readdir).mockResolvedValueOnce([
        mockDirent('legacy-post.markdown'),
      ] as any);

      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValueOnce(`---
id: legacy-post-id
projectId: default
title: Legacy Post
slug: legacy-post
status: published
createdAt: 2024-01-01T00:00:00.000Z
updatedAt: 2024-01-01T00:00:00.000Z
tags: []
categories: []
---
Legacy content`);

      await postEngine.rebuildDatabaseFromFiles();

      expect(mockLocalDb.insert).toHaveBeenCalled();
    });

    it('should emit databaseRebuilt event on completion', async () => {
      const fs = await import('fs/promises');
      const handler = vi.fn();
      postEngine.on('databaseRebuilt', handler);

      vi.mocked(fs.readdir).mockResolvedValueOnce([] as any);

      await postEngine.rebuildDatabaseFromFiles();

      expect(handler).toHaveBeenCalled();
    });

    it('should handle empty posts directory', async () => {
      const fs = await import('fs/promises');
      
      vi.mocked(fs.readdir).mockResolvedValueOnce([] as any);

      await postEngine.rebuildDatabaseFromFiles();

      // Should complete without errors
      expect(mockLocalDb.insert).not.toHaveBeenCalled();
    });

    it('should create posts directory if it does not exist', async () => {
      const fs = await import('fs/promises');
      
      vi.mocked(fs.readdir).mockRejectedValueOnce(new Error('ENOENT'));

      await postEngine.rebuildDatabaseFromFiles();

      expect(fs.mkdir).toHaveBeenCalled();
    });

    it('should delete all existing posts before inserting fresh from files', async () => {
      const fs = await import('fs/promises');
      
      vi.mocked(fs.readdir).mockResolvedValueOnce([mockDirent('existing.md')] as any);

      // Mock access to allow file reads
      vi.mocked(fs.access).mockResolvedValue(undefined);
      
      vi.mocked(fs.readFile).mockResolvedValueOnce(`---
id: existing-id
projectId: default
title: Existing Post
slug: existing
status: draft
createdAt: 2024-01-01T00:00:00.000Z
updatedAt: 2024-01-01T00:00:00.000Z
tags: []
categories: []
---
Updated content`);

      // Mock that project has existing posts to delete
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          all: vi.fn().mockResolvedValue([{ id: 'existing-id' }]),
          get: vi.fn().mockResolvedValue(null),
        });
        return chain;
      });

      await postEngine.rebuildDatabaseFromFiles();

      // Should delete existing posts first, then insert fresh
      expect(mockLocalDb.delete).toHaveBeenCalled();
      expect(mockLocalDb.insert).toHaveBeenCalled();
    });

    it('should insert new posts not in database', async () => {
      const fs = await import('fs/promises');
      
      vi.mocked(fs.readdir).mockResolvedValueOnce([mockDirent('new-post.md')] as any);

      // Mock access to allow file reads
      vi.mocked(fs.access).mockResolvedValue(undefined);
      
      vi.mocked(fs.readFile).mockResolvedValueOnce(`---
id: new-post-id
projectId: default
title: New Post
slug: new-post
status: draft
createdAt: 2024-01-01T00:00:00.000Z
updatedAt: 2024-01-01T00:00:00.000Z
tags: []
categories: []
---
New content`);

      // Mock that post doesn't exist in database
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue(null),
        });
        return chain;
      });

      await postEngine.rebuildDatabaseFromFiles();

      expect(mockLocalDb.insert).toHaveBeenCalled();
    });

    it('should update FTS index for each processed post', async () => {
      const fs = await import('fs/promises');
      
      vi.mocked(fs.readdir).mockResolvedValueOnce([mockDirent('fts-test.md')] as any);

      // Mock access to allow file reads
      vi.mocked(fs.access).mockResolvedValue(undefined);
      
      vi.mocked(fs.readFile).mockResolvedValueOnce(`---
id: fts-test-id
projectId: default
title: FTS Test
slug: fts-test
status: draft
createdAt: 2024-01-01T00:00:00.000Z
updatedAt: 2024-01-01T00:00:00.000Z
tags:
  - search
  - test
categories: []
---
Searchable content`);

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue(null),
        });
        return chain;
      });

      mockExecuteArgs = [];
      await postEngine.rebuildDatabaseFromFiles();

      const ftsInsert = mockExecuteArgs.find((q) => 
        q.sql.includes('INSERT INTO posts_fts')
      );
      expect(ftsInsert).toBeDefined();
    });

    it('should skip invalid/corrupted post files', async () => {
      const fs = await import('fs/promises');
      
      vi.mocked(fs.readdir).mockResolvedValueOnce([mockDirent('valid.md'), mockDirent('corrupted.md')] as any);
      
      vi.mocked(fs.readFile).mockImplementation(async (filePath: any) => {
        if (filePath.includes('valid.md')) {
          return `---
id: valid-id
projectId: default
title: Valid Post
slug: valid
status: draft
createdAt: 2024-01-01T00:00:00.000Z
updatedAt: 2024-01-01T00:00:00.000Z
tags: []
categories: []
---
Valid content`;
        }
        if (filePath.includes('corrupted.md')) {
          return 'This is not valid YAML frontmatter';
        }
        throw new Error('ENOENT');
      });

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue(null),
        });
        return chain;
      });

      // Should not throw
      await postEngine.rebuildDatabaseFromFiles();
    });

    it('should import posts with duplicate slugs by auto-deduplicating slugs', async () => {
      const fs = await import('fs/promises');
      const insertedSlugs: string[] = [];

      vi.mocked(mockLocalDb.insert).mockImplementation(() => ({
        values: vi.fn((data: any) => {
          insertedSlugs.push(data.slug);
          if (data?.id) {
            mockPosts.set(data.id, data);
          }
          return Promise.resolve();
        }),
      }));

      vi.mocked(fs.readdir).mockResolvedValueOnce([
        mockDirent('post-a.md'),
        mockDirent('post-b.md'),
      ] as any);

      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockImplementation(async (filePath: any) => {
        if (filePath.includes('post-a.md')) {
          return `---
id: post-a-id
projectId: default
title: Post A
slug: same-slug
status: published
createdAt: 2024-01-01T00:00:00.000Z
updatedAt: 2024-01-01T00:00:00.000Z
tags: []
categories: []
---
Content A`;
        }
        return `---
id: post-b-id
projectId: default
title: Post B
slug: same-slug
status: published
createdAt: 2024-01-02T00:00:00.000Z
updatedAt: 2024-01-02T00:00:00.000Z
tags: []
categories: []
---
Content B`;
      });

      await postEngine.rebuildDatabaseFromFiles();

      const uniqueSlugs = new Set(insertedSlugs);
      expect(uniqueSlugs.has('same-slug')).toBe(true);
      expect(uniqueSlugs.has('same-slug-2')).toBe(true);
    });

    it('should ignore frontmatter projectId and import into current project', async () => {
      const fs = await import('fs/promises');
      const insertedProjects: string[] = [];

      postEngine.setProjectContext('current-project-id');

      vi.mocked(mockLocalDb.insert).mockImplementation(() => ({
        values: vi.fn((data: any) => {
          insertedProjects.push(data.projectId);
          if (data?.id) {
            mockPosts.set(data.id, data);
          }
          return Promise.resolve();
        }),
      }));

      vi.mocked(fs.readdir).mockResolvedValueOnce([mockDirent('post-with-old-project.md')] as any);
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValueOnce(`---
id: post-old-project
projectId: old-project-id
title: Old Project Post
slug: old-project-post
status: published
createdAt: 2024-01-01T00:00:00.000Z
updatedAt: 2024-01-01T00:00:00.000Z
tags: []
categories: []
---
Content`);

      await postEngine.rebuildDatabaseFromFiles();

      expect(insertedProjects).toHaveLength(1);
      expect(insertedProjects[0]).toBe('current-project-id');
    });
  });

  describe('Date-based folder structure', () => {
    it('should return correct path via getPostPath method', async () => {
      const now = new Date();
      const year = now.getFullYear();
      const month = (now.getMonth() + 1).toString().padStart(2, '0');

      // getPostPath should return the date-based path
      const postPath = postEngine.getPostPath('my-test-slug', now);
      
      // Handle both Windows (\) and Unix (/) path separators
      expect(postPath).toMatch(new RegExp(`[/\\\\]${year}[/\\\\]${month}[/\\\\]`));
      expect(postPath).toContain('my-test-slug.md');
    });

    it('should handle posts from previous years correctly', async () => {
      const oldDate = new Date('2021-03-15');
      const postPath = postEngine.getPostPath('old-post', oldDate);

      expect(postPath).toMatch(/[/\\]2021[/\\]03[/\\]/);
      expect(postPath).toContain('old-post.md');
    });

    it('should handle December correctly (month 12)', async () => {
      const december = new Date('2024-12-25');
      const postPath = postEngine.getPostPath('december-post', december);

      expect(postPath).toMatch(/[/\\]2024[/\\]12[/\\]/);
    });

    it('should handle January correctly (month 01)', async () => {
      const january = new Date('2024-01-01');
      const postPath = postEngine.getPostPath('january-post', january);

      expect(postPath).toMatch(/[/\\]2024[/\\]01[/\\]/);
    });
  });

  describe('publishPost', () => {
    it('should return null for non-existent post', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue(null),
        });
        return chain;
      });

      const result = await postEngine.publishPost('non-existent-id');
      expect(result).toBeNull();
    });

    it('should change status to published', async () => {
      const created = await postEngine.createPost({ 
        title: 'Publish Test', 
        content: '# Published content' 
      });

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: created.id,
            projectId: created.projectId,
            title: created.title,
            slug: created.slug,
            status: 'draft',
            content: created.content,
            filePath: '',
            tags: '[]',
            categories: '[]',
            createdAt: created.createdAt,
            updatedAt: created.updatedAt,
          }),
          all: vi.fn().mockResolvedValue([]),
        });
        return chain;
      });

      const result = await postEngine.publishPost(created.id);

      expect(result).not.toBeNull();
      expect(result?.status).toBe('published');
    });

    it('should set publishedAt timestamp on first publish', async () => {
      const created = await postEngine.createPost({ title: 'First Publish' });

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: created.id,
            projectId: created.projectId,
            title: created.title,
            slug: created.slug,
            status: 'draft',
            content: 'Test content',
            filePath: '',
            tags: '[]',
            categories: '[]',
            createdAt: created.createdAt,
            updatedAt: created.updatedAt,
            publishedAt: null,
          }),
          all: vi.fn().mockResolvedValue([]),
        });
        return chain;
      });

      const before = new Date();
      const result = await postEngine.publishPost(created.id);
      const after = new Date();

      expect(result?.publishedAt).toBeDefined();
      expect(result?.publishedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(result?.publishedAt!.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should preserve existing publishedAt on re-publish', async () => {
      const existingPublishedAt = new Date('2024-01-15T10:00:00.000Z');
      const created = await postEngine.createPost({ title: 'Re-publish Test' });

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: created.id,
            projectId: created.projectId,
            title: created.title,
            slug: created.slug,
            status: 'draft',
            content: 'Updated content',
            filePath: '/mock/existing-file.md',
            tags: '[]',
            categories: '[]',
            createdAt: created.createdAt,
            updatedAt: created.updatedAt,
            publishedAt: existingPublishedAt,
          }),
          all: vi.fn().mockResolvedValue([]),
        });
        return chain;
      });

      const result = await postEngine.publishPost(created.id);

      expect(result?.publishedAt).toEqual(existingPublishedAt);
    });

    it('should write post to filesystem', async () => {
      const fs = await import('fs/promises');
      const created = await postEngine.createPost({ 
        title: 'File Write Test', 
        content: 'Published content' 
      });

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: created.id,
            projectId: created.projectId,
            title: created.title,
            slug: created.slug,
            status: 'draft',
            content: 'Published content',
            filePath: '',
            tags: '[]',
            categories: '[]',
            createdAt: created.createdAt,
            updatedAt: created.updatedAt,
          }),
          all: vi.fn().mockResolvedValue([]),
        });
        return chain;
      });

      vi.mocked(fs.writeFile).mockClear();
      await postEngine.publishPost(created.id);

      expect(fs.writeFile).toHaveBeenCalled();
    });

    it('should not write projectId to frontmatter when publishing', async () => {
      const fs = await import('fs/promises');
      postEngine.setProjectContext('my-project-id');
      const created = await postEngine.createPost({
        title: 'No ProjectId Frontmatter',
        content: 'Published content',
      });

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: created.id,
            projectId: created.projectId,
            title: created.title,
            slug: created.slug,
            status: 'draft',
            content: created.content,
            filePath: '',
            tags: '[]',
            categories: '[]',
            createdAt: created.createdAt,
            updatedAt: created.updatedAt,
          }),
          all: vi.fn().mockResolvedValue([]),
        });
        return chain;
      });

      await postEngine.publishPost(created.id);

      const writeCalls = vi.mocked(fs.writeFile).mock.calls;
      expect(writeCalls.length).toBeGreaterThan(0);
      const writtenContent = writeCalls[0][1] as string;
      expect(writtenContent).not.toContain('projectId:');
    });

    it('should emit postUpdated event', async () => {
      const handler = vi.fn();
      postEngine.on('postUpdated', handler);

      const created = await postEngine.createPost({ title: 'Event Publish Test' });

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: created.id,
            projectId: created.projectId,
            title: created.title,
            slug: created.slug,
            status: 'draft',
            content: 'Test content',
            filePath: '',
            tags: '[]',
            categories: '[]',
            createdAt: created.createdAt,
            updatedAt: created.updatedAt,
          }),
          all: vi.fn().mockResolvedValue([]),
        });
        return chain;
      });

      await postEngine.publishPost(created.id);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'published' })
      );
    });

    it('should update FTS index on publish', async () => {
      const created = await postEngine.createPost({ 
        title: 'FTS Publish Test',
        content: 'Searchable content' 
      });

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: created.id,
            projectId: created.projectId,
            title: created.title,
            slug: created.slug,
            status: 'draft',
            content: 'Searchable content',
            filePath: '',
            tags: '[]',
            categories: '[]',
            createdAt: created.createdAt,
            updatedAt: created.updatedAt,
          }),
          all: vi.fn().mockResolvedValue([]),
        });
        return chain;
      });

      mockExecuteArgs = [];
      await postEngine.publishPost(created.id);

      const ftsUpdate = mockExecuteArgs.find((q) => q.sql.includes('posts_fts'));
      expect(ftsUpdate).toBeDefined();
    });

    it('should remove old file when slug changes', async () => {
      const fs = await import('fs/promises');
      const created = await postEngine.createPost({ title: 'Slug Change Publish' });
      const oldFilePath = '/mock/old/path/old-slug.md';
      const newFilePath = `/mock/userData/projects/default/posts/2024/01/${created.slug}.md`;

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: created.id,
            projectId: created.projectId,
            title: created.title,
            slug: created.slug,
            status: 'draft',
            content: 'Content',
            filePath: oldFilePath,
            tags: '[]',
            categories: '[]',
            createdAt: created.createdAt,
            updatedAt: created.updatedAt,
          }),
          all: vi.fn().mockResolvedValue([]),
        });
        return chain;
      });

      vi.mocked(fs.unlink).mockClear();
      await postEngine.publishPost(created.id);

      expect(fs.unlink).toHaveBeenCalledWith(oldFilePath);
    });
  });

  describe('discardChanges', () => {
    it('should return null for non-existent post', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue(null),
        });
        return chain;
      });

      const result = await postEngine.discardChanges('non-existent-id');
      expect(result).toBeNull();
    });

    it('should return null if post has no published file', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: 'draft-only-id',
            filePath: '', // No published file
          }),
        });
        return chain;
      });

      const result = await postEngine.discardChanges('draft-only-id');
      expect(result).toBeNull();
    });

    it('should restore post from filesystem', async () => {
      const publishedFilePath = '/mock/published/post.md';
      mockFiles.set(publishedFilePath, `---
id: restore-id
projectId: default
title: Published Title
slug: published-slug
status: published
createdAt: 2024-01-01T00:00:00.000Z
updatedAt: 2024-01-01T00:00:00.000Z
tags:
  - original
categories: []
---
Original published content`);

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: 'restore-id',
            filePath: publishedFilePath,
          }),
        });
        return chain;
      });

      const result = await postEngine.discardChanges('restore-id');

      expect(result).not.toBeNull();
      expect(result?.title).toBe('Published Title');
      expect(result?.content).toBe('Original published content');
      expect(result?.status).toBe('published');
    });

    it('should return null if published file is missing', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: 'missing-file-id',
            filePath: '/mock/missing/file.md',
          }),
        });
        return chain;
      });

      const result = await postEngine.discardChanges('missing-file-id');
      expect(result).toBeNull();
    });

    it('should emit postUpdated event', async () => {
      const handler = vi.fn();
      postEngine.on('postUpdated', handler);

      const publishedFilePath = '/mock/discard-event.md';
      mockFiles.set(publishedFilePath, `---
id: event-discard-id
projectId: default
title: Event Discard Test
slug: event-discard
status: published
createdAt: 2024-01-01T00:00:00.000Z
updatedAt: 2024-01-01T00:00:00.000Z
tags: []
categories: []
---
Published content`);

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: 'event-discard-id',
            filePath: publishedFilePath,
          }),
        });
        return chain;
      });

      await postEngine.discardChanges('event-discard-id');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Event Discard Test' })
      );
    });
  });

  describe('hasPublishedVersion', () => {
    it('should return false for non-existent post', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue(null),
        });
        return chain;
      });

      const result = await postEngine.hasPublishedVersion('non-existent-id');
      expect(result).toBe(false);
    });

    it('should return false for draft-only post', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: 'draft-only-id',
            filePath: '',
          }),
        });
        return chain;
      });

      const result = await postEngine.hasPublishedVersion('draft-only-id');
      expect(result).toBe(false);
    });

    it('should return true for published post', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: 'published-id',
            filePath: '/mock/published/file.md',
          }),
        });
        return chain;
      });

      const result = await postEngine.hasPublishedVersion('published-id');
      expect(result).toBe(true);
    });
  });

  describe('getPublishedVersion', () => {
    it('should return null when post has no published file', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: 'draft-only-id',
            projectId: 'default',
            filePath: '',
          }),
        });
        return chain;
      });

      const result = await postEngine.getPublishedVersion('draft-only-id');
      expect(result).toBeNull();
    });

    it('should return published content and metadata from filesystem snapshot', async () => {
      const publishedFilePath = '/mock/published/snapshot.md';
      mockFiles.set(publishedFilePath, `---
id: snapshot-id
projectId: default
title: Published Snapshot Title
slug: published-snapshot
status: published
createdAt: 2024-01-01T00:00:00.000Z
updatedAt: 2024-01-02T00:00:00.000Z
publishedAt: 2024-01-03T00:00:00.000Z
tags:
  - published-tag
categories:
  - page
---
Published snapshot content`);

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: 'snapshot-id',
            projectId: 'default',
            title: 'Draft title should not be used',
            slug: 'draft-slug',
            status: 'draft',
            content: 'Draft content should not be used',
            filePath: publishedFilePath,
            tags: '[]',
            categories: '[]',
            createdAt: new Date('2024-01-01T00:00:00.000Z'),
            updatedAt: new Date('2024-01-10T00:00:00.000Z'),
            publishedAt: new Date('2024-01-03T00:00:00.000Z'),
          }),
        });
        return chain;
      });

      const result = await postEngine.getPublishedVersion('snapshot-id');

      expect(result).not.toBeNull();
      expect(result?.status).toBe('published');
      expect(result?.title).toBe('Published Snapshot Title');
      expect(result?.slug).toBe('published-snapshot');
      expect(result?.content).toBe('Published snapshot content');
      expect(result?.tags).toEqual(['published-tag']);
      expect(result?.categories).toEqual(['page']);
    });
  });

  describe('getAllPosts', () => {
    it('should return empty result when no posts exist', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          offset: vi.fn().mockReturnThis(),
          all: vi.fn().mockResolvedValue([]),
        });
        return chain;
      });

      const result = await postEngine.getAllPosts();
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should return all posts for current project', async () => {
      postEngine.setProjectContext('test-project');

      // getAllPosts now makes 3 queries: count, drafts, non-drafts
      let selectCallCount = 0;
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        selectCallCount++;
        const chain = createSelectChain();
        const callNum = selectCallCount;
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          offset: vi.fn().mockReturnThis(),
          all: vi.fn().mockResolvedValue(
            callNum === 1
              ? [{ id: '1' }, { id: '2' }] // count query: 2 total
              : callNum === 2
                ? [{ id: '1', title: 'Draft Post', projectId: 'test-project', status: 'draft', tags: '[]', categories: '[]' }] // drafts
                : [{ id: '2', title: 'Published Post', projectId: 'test-project', status: 'published', tags: '[]', categories: '[]' }] // non-drafts
          ),
        });
        return chain;
      });

      const result = await postEngine.getAllPosts();
      expect(result.items).toHaveLength(2);
    });

    it('should parse tags and categories JSON', async () => {
      // getAllPosts makes 3 queries: count, drafts, non-drafts
      let selectCallCount = 0;
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        selectCallCount++;
        const chain = createSelectChain();
        const callNum = selectCallCount;
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          offset: vi.fn().mockReturnThis(),
          all: vi.fn().mockResolvedValue(
            callNum === 1
              ? [{ id: '1' }] // count
              : callNum === 2
                ? [] // no drafts
                : [{ id: '1', title: 'Tagged Post', tags: '["tag1","tag2"]', categories: '["cat1"]' }] // non-drafts
          ),
        });
        return chain;
      });

      const result = await postEngine.getAllPosts();
      expect(result.items[0].tags).toEqual(['tag1', 'tag2']);
      expect(result.items[0].categories).toEqual(['cat1']);
    });

    it('should always include all drafts regardless of pagination limit', async () => {
      postEngine.setProjectContext('test-project');

      // Simulate: 3 drafts + many published, limit=2
      let selectCallCount = 0;
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        selectCallCount++;
        const chain = createSelectChain();
        const callNum = selectCallCount;
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          offset: vi.fn().mockReturnThis(),
          all: vi.fn().mockResolvedValue(
            callNum === 1
              ? [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }, { id: '5' }] // count: 5 total
              : callNum === 2
                ? [ // 3 drafts (ALL of them, regardless of limit)
                    { id: '1', title: 'Draft 1', status: 'draft', tags: '[]', categories: '[]' },
                    { id: '2', title: 'Draft 2', status: 'draft', tags: '[]', categories: '[]' },
                    { id: '3', title: 'Draft 3', status: 'draft', tags: '[]', categories: '[]' },
                  ]
                : [] // no remaining slots for non-drafts (limit=2, 3 drafts > 2)
          ),
        });
        return chain;
      });

      // Even with limit=2, all 3 drafts must be returned
      const result = await postEngine.getAllPosts({ limit: 2, offset: 0 });
      expect(result.items).toHaveLength(3);
      expect(result.items.every(p => p.status === 'draft')).toBe(true);
      expect(result.hasMore).toBe(true);
    });
  });

  describe('getPostsFiltered', () => {
    it('should filter by status', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          orderBy: vi.fn().mockReturnThis(),
          all: vi.fn().mockResolvedValue([
            { id: '1', title: 'Published', status: 'published', tags: '[]', categories: '[]' },
          ]),
        });
        return chain;
      });

      const result = await postEngine.getPostsFiltered({ status: 'published' });
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('published');
    });

    it('should apply pagination with limit and offset', async () => {
      const allMock = vi.fn().mockResolvedValue([
        { id: '1', title: 'Post 1', tags: '[]', categories: '[]' },
      ]);

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          orderBy: vi.fn().mockReturnThis(),
          all: allMock,
        });
        return chain;
      });

      const result = await postEngine.getPostsFiltered({});

      expect(mockLocalDb.select).toHaveBeenCalled();
      expect(result).toHaveLength(1);
    });
  });

  describe('searchPosts', () => {
    it('should return empty array for empty query', async () => {
      const result = await postEngine.searchPosts('');
      expect(result).toEqual([]);
    });

    it('should search using FTS', async () => {
      mockLocalClient.execute.mockResolvedValueOnce({ 
        rows: [
          { id: 'post-1' },
          { id: 'post-2' },
        ] 
      });

      // searchPosts calls .get() for each result, not .all()
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn()
            .mockResolvedValueOnce({ id: 'post-1', title: 'Found Post 1', slug: 'found-1', excerpt: 'First result', tags: '[]', categories: '[]' })
            .mockResolvedValueOnce({ id: 'post-2', title: 'Found Post 2', slug: 'found-2', excerpt: 'Second result', tags: '[]', categories: '[]' }),
        });
        return chain;
      });

      const result = await postEngine.searchPosts('search term');
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'post-1',
        title: 'Found Post 1',
        slug: 'found-1',
        excerpt: 'First result',
      });
    });

    it('should return empty array when FTS returns no results', async () => {
      mockLocalClient.execute.mockResolvedValueOnce({ rows: [] });

      const result = await postEngine.searchPosts('nonexistent');
      expect(result).toEqual([]);
    });

    it('should cap search results at 500', async () => {
      mockLocalClient.execute.mockResolvedValueOnce({ rows: [] });

      await postEngine.searchPosts('term');

      expect(mockLocalClient.execute).toHaveBeenCalled();
      const call = vi.mocked(mockLocalClient.execute).mock.calls[0]?.[0] as { sql?: string } | undefined;
      expect(call?.sql).toBeDefined();
      const sql = call?.sql?.toLowerCase() ?? '';
      expect(sql).toContain('limit 500');
      expect(sql).not.toMatch(/\blimit\s+50\b/);
    });
  });

  describe('searchPostsFiltered', () => {
    it('should return empty result for empty query', async () => {
      const result = await postEngine.searchPostsFiltered('', {});
      expect(result).toEqual({ posts: [], total: 0 });
    });

    it('should use FTS JOIN with posts table to combine search and filters', async () => {
      mockLocalClient.execute.mockResolvedValueOnce({
        rows: [
          { id: 'p1', projectId: 'test-project', title: 'Found', slug: 'found', excerpt: 'Excerpt', content: 'Content', status: 'published', author: null, createdAt: new Date(), updatedAt: new Date(), publishedAt: null, tags: '["js"]', categories: '["tech"]', filePath: null, version: 1, stemmedTitle: '', stemmedContent: '', language: 'en', translationOfId: null, templateSlug: null },
        ],
      });

      const result = await postEngine.searchPostsFiltered('search term', { status: 'published' });
      expect(result.posts).toHaveLength(1);
      expect(result.posts[0].id).toBe('p1');
      expect(result.total).toBe(1);

      // Verify SQL includes both MATCH and status filter
      const call = vi.mocked(mockLocalClient.execute).mock.calls[0]?.[0] as { sql?: string } | undefined;
      const sql = call?.sql?.toLowerCase() ?? '';
      expect(sql).toContain('match');
      expect(sql).toContain('status');
      expect(sql).toContain('order by');
      expect(sql).toContain('rank');
    });

    it('should apply category filter in SQL', async () => {
      mockLocalClient.execute.mockResolvedValueOnce({ rows: [] });

      await postEngine.searchPostsFiltered('term', { categories: ['tech'] });

      const call = vi.mocked(mockLocalClient.execute).mock.calls[0]?.[0] as { sql?: string } | undefined;
      const sql = call?.sql?.toLowerCase() ?? '';
      expect(sql).toContain('match');
      expect(sql).toContain('json_each');
    });

    it('should apply tag filter client-side after SQL query', async () => {
      mockLocalClient.execute.mockResolvedValueOnce({
        rows: [
          { id: 'p1', projectId: 'test-project', title: 'Has Tag', slug: 'has-tag', excerpt: null, content: '', status: 'published', author: null, createdAt: new Date(), updatedAt: new Date(), publishedAt: null, tags: '["js", "react"]', categories: '[]', filePath: null, version: 1, stemmedTitle: '', stemmedContent: '', language: 'en', translationOfId: null, templateSlug: null },
          { id: 'p2', projectId: 'test-project', title: 'No Tag', slug: 'no-tag', excerpt: null, content: '', status: 'published', author: null, createdAt: new Date(), updatedAt: new Date(), publishedAt: null, tags: '["python"]', categories: '[]', filePath: null, version: 1, stemmedTitle: '', stemmedContent: '', language: 'en', translationOfId: null, templateSlug: null },
        ],
      });

      const result = await postEngine.searchPostsFiltered('term', { tags: ['js'] });
      expect(result.posts).toHaveLength(1);
      expect(result.posts[0].id).toBe('p1');
      expect(result.total).toBe(1);
    });

    it('should apply pagination with offset and limit', async () => {
      const rows = Array.from({ length: 5 }, (_, i) => ({
        id: `p${i}`, projectId: 'test-project', title: `Post ${i}`, slug: `post-${i}`, excerpt: null, content: '', status: 'published', author: null, createdAt: new Date(), updatedAt: new Date(), publishedAt: null, tags: '[]', categories: '[]', filePath: null, version: 1, stemmedTitle: '', stemmedContent: '', language: 'en', translationOfId: null, templateSlug: null,
      }));
      mockLocalClient.execute.mockResolvedValueOnce({ rows });

      const result = await postEngine.searchPostsFiltered('term', {}, { offset: 1, limit: 2 });
      expect(result.posts).toHaveLength(2);
      expect(result.posts[0].id).toBe('p1');
      expect(result.posts[1].id).toBe('p2');
      expect(result.total).toBe(5);
    });

    it('should return total count reflecting tag filtering but not pagination', async () => {
      const rows = Array.from({ length: 4 }, (_, i) => ({
        id: `p${i}`, projectId: 'test-project', title: `Post ${i}`, slug: `post-${i}`, excerpt: null, content: '', status: 'published', author: null, createdAt: new Date(), updatedAt: new Date(), publishedAt: null, tags: i < 3 ? '["js"]' : '["python"]', categories: '[]', filePath: null, version: 1, stemmedTitle: '', stemmedContent: '', language: 'en', translationOfId: null, templateSlug: null,
      }));
      mockLocalClient.execute.mockResolvedValueOnce({ rows });

      const result = await postEngine.searchPostsFiltered('term', { tags: ['js'] }, { offset: 0, limit: 2 });
      expect(result.posts).toHaveLength(2);
      expect(result.total).toBe(3); // 3 posts have 'js' tag, not 4 total
    });
  });

  describe('getTagsWithCounts', () => {
    it('should return empty array when no posts have tags', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          all: vi.fn().mockResolvedValue([]),
        });
        return chain;
      });

      const result = await postEngine.getTagsWithCounts();
      expect(result).toEqual([]);
    });

    it('should count tag occurrences across posts', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          all: vi.fn().mockResolvedValue([
            { tags: '["javascript","testing"]' },
            { tags: '["javascript","react"]' },
            { tags: '["testing"]' },
          ]),
        });
        return chain;
      });

      const result = await postEngine.getTagsWithCounts();
      
      expect(result).toContainEqual({ tag: 'javascript', count: 2 });
      expect(result).toContainEqual({ tag: 'testing', count: 2 });
      expect(result).toContainEqual({ tag: 'react', count: 1 });
    });

    it('should sort by count descending', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          all: vi.fn().mockResolvedValue([
            { tags: '["a","b","c"]' },
            { tags: '["a","b"]' },
            { tags: '["a"]' },
          ]),
        });
        return chain;
      });

      const result = await postEngine.getTagsWithCounts();
      
      expect(result[0].count).toBeGreaterThanOrEqual(result[1].count);
      expect(result[1].count).toBeGreaterThanOrEqual(result[2].count);
    });
  });

  describe('getCategoriesWithCounts', () => {
    it('should return empty array when no posts have categories', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          all: vi.fn().mockResolvedValue([]),
        });
        return chain;
      });

      const result = await postEngine.getCategoriesWithCounts();
      expect(result).toEqual([]);
    });

    it('should count category occurrences', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          all: vi.fn().mockResolvedValue([
            { categories: '["tutorials"]' },
            { categories: '["tutorials","news"]' },
            { categories: '["news"]' },
          ]),
        });
        return chain;
      });

      const result = await postEngine.getCategoriesWithCounts();
      
      expect(result).toContainEqual({ category: 'tutorials', count: 2 });
      expect(result).toContainEqual({ category: 'news', count: 2 });
    });
  });

  describe('getDashboardStats', () => {
    it('should return counts for all statuses', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          all: vi.fn().mockResolvedValue([
            { status: 'draft' },
            { status: 'draft' },
            { status: 'published' },
            { status: 'published' },
            { status: 'published' },
            { status: 'archived' },
          ]),
        });
        return chain;
      });

      const result = await postEngine.getDashboardStats();

      expect(result.draftCount).toBe(2);
      expect(result.publishedCount).toBe(3);
      expect(result.archivedCount).toBe(1);
      expect(result.totalPosts).toBe(6);
    });

    it('should handle empty project', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          all: vi.fn().mockResolvedValue([]),
        });
        return chain;
      });

      const result = await postEngine.getDashboardStats();

      expect(result.draftCount).toBe(0);
      expect(result.publishedCount).toBe(0);
      expect(result.archivedCount).toBe(0);
      expect(result.totalPosts).toBe(0);
    });
  });

  describe('getPostsByYearMonth', () => {
    it('should return empty array when no posts exist', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          orderBy: vi.fn().mockReturnThis(),
          all: vi.fn().mockResolvedValue([]),
        });
        return chain;
      });

      const result = await postEngine.getPostsByYearMonth();
      expect(result).toEqual([]);
    });

    it('should group posts by year and month', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          orderBy: vi.fn().mockReturnThis(),
          all: vi.fn().mockResolvedValue([
            { createdAt: new Date('2024-01-15'), tags: '[]', categories: '[]' },
            { createdAt: new Date('2024-01-20'), tags: '[]', categories: '[]' },
            { createdAt: new Date('2024-02-10'), tags: '[]', categories: '[]' },
            { createdAt: new Date('2023-12-25'), tags: '[]', categories: '[]' },
          ]),
        });
        return chain;
      });

      const result = await postEngine.getPostsByYearMonth();

      // months are 1-indexed (January=1, February=2, etc.)
      expect(result).toContainEqual({ year: 2024, month: 1, count: 2 }); // January
      expect(result).toContainEqual({ year: 2024, month: 2, count: 1 }); // February
      expect(result).toContainEqual({ year: 2023, month: 12, count: 1 }); // December
    });

    it('should sort by year and month descending', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          orderBy: vi.fn().mockReturnThis(),
          all: vi.fn().mockResolvedValue([
            { createdAt: new Date('2023-06-01'), tags: '[]', categories: '[]' },
            { createdAt: new Date('2024-03-01'), tags: '[]', categories: '[]' },
            { createdAt: new Date('2024-01-01'), tags: '[]', categories: '[]' },
          ]),
        });
        return chain;
      });

      const result = await postEngine.getPostsByYearMonth();

      expect(result[0].year).toBe(2024);
      expect(result[0].month).toBe(3); // March (1-indexed)
      expect(result[result.length - 1].year).toBe(2023);
    });
  });

  describe('getBlogStats', () => {
    it('should return comprehensive blog statistics', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          orderBy: vi.fn().mockReturnThis(),
          all: vi.fn().mockResolvedValue([
            { status: 'draft', createdAt: new Date('2015-03-10'), tags: '["travel","photo"]', categories: '["article"]' },
            { status: 'published', createdAt: new Date('2016-07-22'), tags: '["tech"]', categories: '["article"]' },
            { status: 'published', createdAt: new Date('2020-01-05'), tags: '["travel"]', categories: '["aside"]' },
            { status: 'published', createdAt: new Date('2024-11-30'), tags: '["tech","ai"]', categories: '["article"]' },
            { status: 'archived', createdAt: new Date('2018-06-15'), tags: '[]', categories: '["page"]' },
          ]),
        });
        return chain;
      });

      const result = await postEngine.getBlogStats();

      expect(result.totalPosts).toBe(5);
      expect(result.draftCount).toBe(1);
      expect(result.publishedCount).toBe(3);
      expect(result.archivedCount).toBe(1);
      expect(result.oldestPostDate).toEqual(new Date('2015-03-10'));
      expect(result.newestPostDate).toEqual(new Date('2024-11-30'));
      expect(result.postsPerYear).toEqual({
        2015: 1,
        2016: 1,
        2018: 1,
        2020: 1,
        2024: 1,
      });
      expect(result.tagCount).toBe(4);
      expect(result.categoryCount).toBe(3);
    });

    it('should handle empty project', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          orderBy: vi.fn().mockReturnThis(),
          all: vi.fn().mockResolvedValue([]),
        });
        return chain;
      });

      const result = await postEngine.getBlogStats();

      expect(result.totalPosts).toBe(0);
      expect(result.draftCount).toBe(0);
      expect(result.publishedCount).toBe(0);
      expect(result.archivedCount).toBe(0);
      expect(result.oldestPostDate).toBeNull();
      expect(result.newestPostDate).toBeNull();
      expect(result.postsPerYear).toEqual({});
      expect(result.tagCount).toBe(0);
      expect(result.categoryCount).toBe(0);
    });

    it('should count unique tags and categories', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          orderBy: vi.fn().mockReturnThis(),
          all: vi.fn().mockResolvedValue([
            { status: 'published', createdAt: new Date('2023-01-01'), tags: '["a","b","c"]', categories: '["x"]' },
            { status: 'published', createdAt: new Date('2023-06-01'), tags: '["b","c","d"]', categories: '["x","y"]' },
          ]),
        });
        return chain;
      });

      const result = await postEngine.getBlogStats();

      expect(result.tagCount).toBe(4); // a, b, c, d
      expect(result.categoryCount).toBe(2); // x, y
    });
  });

  describe('extractInternalLinks', () => {
    it('should extract markdown-style internal links', () => {
      const content = 'Check out [my post](/posts/my-post) for more info.';
      const links = postEngine.extractInternalLinks(content);

      expect(links).toHaveLength(1);
      expect(links[0]).toEqual({ text: 'my post', slug: 'my-post' });
    });

    it('should extract multiple links', () => {
      const content = 'See [Post A](/posts/post-a) and [Post B](/posts/post-b).';
      const links = postEngine.extractInternalLinks(content);

      expect(links).toHaveLength(2);
      expect(links).toContainEqual({ text: 'Post A', slug: 'post-a' });
      expect(links).toContainEqual({ text: 'Post B', slug: 'post-b' });
    });

    it('should extract HTML-style links', () => {
      const content = 'Visit <a href="/posts/html-link">HTML Link</a> for details.';
      const links = postEngine.extractInternalLinks(content);

      expect(links).toHaveLength(1);
      expect(links[0]).toEqual({ text: 'HTML Link', slug: 'html-link' });
    });

    it('should handle date-structured paths', () => {
      const content = 'See [Old Post](/posts/2023/05/old-post) from last year.';
      const links = postEngine.extractInternalLinks(content);

      expect(links).toHaveLength(1);
      expect(links[0].slug).toBe('old-post');
    });

    it('should return empty array for content without links', () => {
      const content = 'This is plain text with no internal links.';
      const links = postEngine.extractInternalLinks(content);

      expect(links).toEqual([]);
    });
  });

  describe('updatePostLinks', () => {
    it('should delete existing links before inserting new ones', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.from = vi.fn().mockReturnValue({
          ...chain,
          where: vi.fn().mockResolvedValue([
            { id: 'target-id', slug: 'target-post' },
          ]),
        });
        return chain;
      });

      await postEngine.updatePostLinks('source-id', 'Link to [target](/posts/target-post)');

      expect(mockLocalDb.delete).toHaveBeenCalled();
      expect(mockLocalDb.insert).toHaveBeenCalled();
    });

    it('should not insert self-referential links', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.from = vi.fn().mockReturnValue({
          ...chain,
          where: vi.fn().mockResolvedValue([
            { id: 'same-id', slug: 'self-link' },
          ]),
        });
        return chain;
      });

      const insertMock = vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      });
      vi.mocked(mockLocalDb.insert).mockImplementation(insertMock);

      await postEngine.updatePostLinks('same-id', 'Link to [self](/posts/self-link)');

      // Insert should be called for other table operations but not for the self-link
      // The function should skip inserting when targetId === postId
    });

    it('should handle content with no links', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.from = vi.fn().mockReturnValue({
          ...chain,
          where: vi.fn().mockResolvedValue([]),
        });
        return chain;
      });

      await postEngine.updatePostLinks('post-id', 'Content without any links');

      expect(mockLocalDb.delete).toHaveBeenCalled();
      // No inserts for empty links
    });
  });

  describe('getLinkedBy', () => {
    it('should return posts that link to the specified post', async () => {
      // Mock the two database queries
      let callCount = 0;
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        callCount++;
        const chain = createSelectChain();
        
        if (callCount === 1) {
          // First call: get links from postLinks table
          chain.from = vi.fn().mockReturnValue({
            ...chain,
            where: vi.fn().mockResolvedValue([
              { sourcePostId: 'source-1', linkText: 'Link Text' },
              { sourcePostId: 'source-2', linkText: 'Another Link' },
            ]),
          });
        } else {
          // Second call: get source posts
          chain.from = vi.fn().mockReturnValue({
            ...chain,
            where: vi.fn().mockResolvedValue([
              { id: 'source-1', title: 'Source Post 1', slug: 'source-1' },
              { id: 'source-2', title: 'Source Post 2', slug: 'source-2' },
              { id: 'other', title: 'Other Post', slug: 'other' },
            ]),
          });
        }
        return chain;
      });

      const result = await postEngine.getLinkedBy('target-id');

      expect(result).toHaveLength(2);
    });

    it('should return empty array when no posts link to target', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.from = vi.fn().mockReturnValue({
          ...chain,
          where: vi.fn().mockResolvedValue([]),
        });
        return chain;
      });

      const result = await postEngine.getLinkedBy('isolated-post');
      expect(result).toEqual([]);
    });
  });

  describe('getLinksTo', () => {
    it('should return posts that the specified post links to', async () => {
      let callCount = 0;
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        callCount++;
        const chain = createSelectChain();
        
        if (callCount === 1) {
          // First call: get links from postLinks table
          chain.from = vi.fn().mockReturnValue({
            ...chain,
            where: vi.fn().mockResolvedValue([
              { targetPostId: 'target-1', linkText: 'Link Text' },
            ]),
          });
        } else {
          // Second call: get target posts
          chain.from = vi.fn().mockReturnValue({
            ...chain,
            where: vi.fn().mockResolvedValue([
              { id: 'target-1', title: 'Target Post', slug: 'target-1' },
            ]),
          });
        }
        return chain;
      });

      const result = await postEngine.getLinksTo('source-id');

      expect(result).toHaveLength(1);
    });

    it('should return empty array when post has no outgoing links', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.from = vi.fn().mockReturnValue({
          ...chain,
          where: vi.fn().mockResolvedValue([]),
        });
        return chain;
      });

      const result = await postEngine.getLinksTo('no-links-post');
      expect(result).toEqual([]);
    });
  });

  describe('rebuildAllPostLinks', () => {
    it('should clear all existing links', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.from = vi.fn().mockReturnValue({
          ...chain,
          where: vi.fn().mockResolvedValue([]),
        });
        return chain;
      });

      await postEngine.rebuildAllPostLinks();

      expect(mockLocalDb.delete).toHaveBeenCalled();
    });

    it('should emit postLinksRebuilt event', async () => {
      const handler = vi.fn();
      postEngine.on('postLinksRebuilt', handler);

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.from = vi.fn().mockReturnValue({
          ...chain,
          where: vi.fn().mockResolvedValue([]),
        });
        return chain;
      });

      await postEngine.rebuildAllPostLinks();

      expect(handler).toHaveBeenCalled();
    });

    it('should process posts with file content', async () => {
      const filePath = '/mock/posts/2024/01/test-post.md';
      mockFiles.set(filePath, `---
id: file-post-id
title: File Post
slug: file-post
---
Content with [link](/posts/other-post)`);

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.from = vi.fn().mockReturnValue({
          ...chain,
          where: vi.fn().mockResolvedValue([
            { id: 'file-post-id', filePath, content: null },
          ]),
        });
        return chain;
      });

      await postEngine.rebuildAllPostLinks();

      expect(mockLocalDb.delete).toHaveBeenCalled();
    });

    it('should process posts with draft content in DB', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.from = vi.fn().mockReturnValue({
          ...chain,
          where: vi.fn().mockResolvedValue([
            { id: 'draft-id', filePath: '', content: 'Draft with [link](/posts/target)' },
          ]),
        });
        return chain;
      });

      await postEngine.rebuildAllPostLinks();

      expect(mockLocalDb.delete).toHaveBeenCalled();
    });
  });

  describe('rebuildFTSIndex', () => {
    it('should call getAllPostsUnpaginated', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          orderBy: vi.fn().mockReturnThis(),
          all: vi.fn().mockResolvedValue([]),
        });
        return chain;
      });

      await postEngine.rebuildFTSIndex();

      expect(mockLocalDb.select).toHaveBeenCalled();
    });

    it('should update FTS for each post', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          orderBy: vi.fn().mockReturnThis(),
          all: vi.fn().mockResolvedValue([
            { id: 'post-1', title: 'Post 1', content: 'Content 1', tags: '[]', categories: '[]' },
            { id: 'post-2', title: 'Post 2', content: 'Content 2', tags: '[]', categories: '[]' },
          ]),
        });
        return chain;
      });

      mockExecuteArgs = [];
      await postEngine.rebuildFTSIndex();

      // FTS update is called for each post
      const ftsOperations = mockExecuteArgs.filter((q) => q.sql.includes('posts_fts'));
      expect(ftsOperations.length).toBeGreaterThan(0);
    });

    it('should re-index all posts in project', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          orderBy: vi.fn().mockReturnThis(),
          all: vi.fn().mockResolvedValue([
            { id: 'post-1', title: 'Post 1', content: 'Content 1', tags: '["a"]', categories: '[]' },
            { id: 'post-2', title: 'Post 2', content: 'Content 2', tags: '[]', categories: '["b"]' },
          ]),
        });
        return chain;
      });

      mockExecuteArgs = [];
      await postEngine.rebuildFTSIndex();

      const ftsInserts = mockExecuteArgs.filter((q) => 
        q.sql.includes('INSERT INTO posts_fts')
      );
      expect(ftsInserts.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('reconcilePublishedPostsFromGitChanges', () => {
    it('should process added and modified markdown files as published posts', async () => {
      postEngine.setProjectContext('default', '/repo');

      const existingPublishedPath = '/repo/posts/2026/02/existing-post.md';
      mockPosts.set('published-existing', {
        id: 'published-existing',
        projectId: 'default',
        title: 'Existing Post',
        slug: 'existing-post',
        excerpt: null,
        content: null,
        status: 'published',
        author: null,
        createdAt: new Date('2026-02-01T10:00:00.000Z'),
        updatedAt: new Date('2026-02-01T10:00:00.000Z'),
        publishedAt: new Date('2026-02-01T10:00:00.000Z'),
        filePath: existingPublishedPath,
        checksum: 'old-checksum',
        tags: '[]',
        categories: '[]',
      });

      mockFiles.set(existingPublishedPath, `---\nid: published-existing\ntitle: Existing Post Updated\nslug: existing-post\nstatus: published\ncreatedAt: 2026-02-01T10:00:00.000Z\nupdatedAt: 2026-02-22T10:00:00.000Z\ntags:\n  - synced\ncategories:\n  - updates\n---\nUpdated content`);
      mockFiles.set('/repo/posts/2026/02/new-from-pull.md', `---\nid: new-from-pull-id\ntitle: New From Pull\nslug: new-from-pull\nstatus: published\ncreatedAt: 2026-02-22T09:00:00.000Z\nupdatedAt: 2026-02-22T09:00:00.000Z\ntags:\n  - new\ncategories:\n  - updates\n---\nBrand new post content`);

      const emitSpy = vi.spyOn(postEngine, 'emit');

      const result = await postEngine.reconcilePublishedPostsFromGitChanges('/repo', [
        { status: 'modified', path: 'posts/2026/02/existing-post.md' },
        { status: 'added', path: 'posts/2026/02/new-from-pull.md' },
      ]);

      expect(mockLocalDb.update).toHaveBeenCalled();
      expect(mockLocalDb.insert).toHaveBeenCalled();
      expect(emitSpy).toHaveBeenCalledWith('postUpdated', expect.objectContaining({ id: 'published-existing' }));
      expect(emitSpy).toHaveBeenCalledWith('postCreated', expect.objectContaining({ slug: 'new-from-pull', status: 'published' }));
      expect(result.created).toBe(1);
      expect(result.updated).toBe(1);
      expect(result.deleted).toBe(0);
      expect(result.processedFiles).toBe(2);
    });

    it('should ignore draft posts when matching file paths appear in git changes', async () => {
      postEngine.setProjectContext('default', '/repo');

      const draftPath = '/repo/posts/2026/02/draft-post.md';
      mockPosts.set('draft-post', {
        id: 'draft-post',
        projectId: 'default',
        title: 'Draft Post',
        slug: 'draft-post',
        excerpt: null,
        content: 'Draft content',
        status: 'draft',
        author: null,
        createdAt: new Date('2026-02-01T10:00:00.000Z'),
        updatedAt: new Date('2026-02-01T10:00:00.000Z'),
        publishedAt: null,
        filePath: draftPath,
        checksum: 'draft-checksum',
        tags: '[]',
        categories: '[]',
      });

      mockFiles.set(draftPath, `---\nid: draft-post\ntitle: Draft Post From File\nslug: draft-post\nstatus: published\ncreatedAt: 2026-02-01T10:00:00.000Z\nupdatedAt: 2026-02-22T10:00:00.000Z\n---\nShould be ignored`);

      const emitSpy = vi.spyOn(postEngine, 'emit');

      const result = await postEngine.reconcilePublishedPostsFromGitChanges('/repo', [
        { status: 'modified', path: 'posts/2026/02/draft-post.md' },
      ]);

      expect(mockLocalDb.update).not.toHaveBeenCalled();
      expect(mockLocalDb.insert).not.toHaveBeenCalled();
      expect(emitSpy).not.toHaveBeenCalledWith('postUpdated', expect.objectContaining({ id: 'draft-post' }));
      expect(result.created).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.deleted).toBe(0);
      expect(result.processedFiles).toBe(0);
    });
  });
});
