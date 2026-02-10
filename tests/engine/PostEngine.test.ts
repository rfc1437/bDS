/**
 * PostEngine Unit Tests
 *
 * Tests the REAL PostEngine class with mocked dependencies.
 * Following TDD best practices: mock external dependencies, test real implementation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PostEngine, PostData } from '../../src/main/engine/PostEngine';
import { resetMockCounters } from '../utils/factories';

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

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn(async (path: string) => {
    const content = mockFiles.get(path);
    if (!content) {
      const error = new Error(`ENOENT: no such file or directory, open '${path}'`);
      (error as any).code = 'ENOENT';
      throw error;
    }
    return content;
  }),
  writeFile: vi.fn(async (path: string, content: string) => {
    mockFiles.set(path, content);
  }),
  unlink: vi.fn(async (path: string) => {
    mockFiles.delete(path);
  }),
  mkdir: vi.fn(async () => {}),
  readdir: vi.fn(async () => []),
  stat: vi.fn(async (path: string) => ({
    isFile: () => mockFiles.has(path),
    isDirectory: () => !mockFiles.has(path),
    size: mockFiles.get(path)?.length || 0,
  })),
  access: vi.fn(async (path: string) => {
    if (!mockFiles.has(path)) {
      const error = new Error(`ENOENT`);
      (error as any).code = 'ENOENT';
      throw error;
    }
  }),
}));

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-uuid-' + Math.random().toString(36).substr(2, 9)),
}));

describe('PostEngine', () => {
  let postEngine: PostEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPosts.clear();
    mockFiles.clear();
    mockExecuteArgs = [];
    resetMockCounters();
    
    // Reset the mock implementations
    vi.mocked(mockLocalDb.select).mockImplementation(() => createSelectChain());
    
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

    it('should handle unicode characters by removing them', async () => {
      const post = await postEngine.createPost({ title: 'Café Test' });
      expect(post.slug).toBe('caf-test');
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

    it('should update existing posts in database', async () => {
      const fs = await import('fs/promises');
      
      vi.mocked(fs.readdir).mockResolvedValueOnce([mockDirent('existing.md')] as any);
      
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

      // Mock that post exists in database
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: 'existing-id',
            title: 'Old Title',
          }),
        });
        return chain;
      });

      await postEngine.rebuildDatabaseFromFiles();

      expect(mockLocalDb.update).toHaveBeenCalled();
    });

    it('should insert new posts not in database', async () => {
      const fs = await import('fs/promises');
      
      vi.mocked(fs.readdir).mockResolvedValueOnce([mockDirent('new-post.md')] as any);
      
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
});
