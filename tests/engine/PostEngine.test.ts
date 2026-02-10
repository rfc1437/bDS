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

    it('should write post to filesystem', async () => {
      const fs = await import('fs/promises');
      await postEngine.createPost({ title: 'File Test' });

      expect(fs.writeFile).toHaveBeenCalled();
      expect(fs.mkdir).toHaveBeenCalled();
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

    it('should handle post without title using "Untitled"', async () => {
      const post = await postEngine.createPost({});
      expect(post.title).toBe('Untitled');
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

  describe('Post Creation writes correct file format', () => {
    it('should write markdown file with YAML frontmatter', async () => {
      const fs = await import('fs/promises');
      
      await postEngine.createPost({
        title: 'Frontmatter Test',
        content: '# Hello World',
        tags: ['test'],
      });

      expect(fs.writeFile).toHaveBeenCalled();
      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const filePath = writeCall[0] as string;
      const content = writeCall[1] as string;

      expect(filePath).toContain('frontmatter-test.md');
      expect(content).toContain('---');
      expect(content).toContain('title: Frontmatter Test');
      expect(content).toContain('# Hello World');
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
});
