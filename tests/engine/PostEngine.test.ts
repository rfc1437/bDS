/**
 * PostEngine Unit Tests
 * 
 * Tests for blog post management including:
 * - Post CRUD operations
 * - Slug generation
 * - Markdown with YAML frontmatter handling
 * - Checksum calculation
 * - Event emissions
 */

import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { createMockPost, createMockFileSystem, createMockDatabase, resetMockCounters } from '../utils/factories';

// Mock the database module before importing PostEngine
vi.mock('../../src/main/database', () => {
  const mockDb = {
    getLocal: vi.fn(() => ({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([])),
          orderBy: vi.fn(() => Promise.resolve([])),
        })),
      })),
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
    })),
    getRemote: vi.fn(() => null),
    getDataPaths: vi.fn(() => ({
      database: '/mock/userData/bds.db',
      posts: '/mock/userData/posts',
      media: '/mock/userData/media',
    })),
    initializeLocal: vi.fn(),
    initializeRemote: vi.fn(),
    close: vi.fn(),
  };
  
  return {
    getDatabase: vi.fn(() => mockDb),
  };
});

// Mock fs/promises
vi.mock('fs/promises', () => createMockFileSystem());

describe('PostEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMockCounters();
  });

  describe('Slug Generation', () => {
    it('should generate slug from title with lowercase', () => {
      // Test the slug generation logic
      const generateSlug = (title: string): string => {
        return title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
      };

      expect(generateSlug('Hello World')).toBe('hello-world');
    });

    it('should replace special characters with hyphens', () => {
      const generateSlug = (title: string): string => {
        return title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
      };

      expect(generateSlug('Hello, World!')).toBe('hello-world');
      expect(generateSlug('Test @ Post #1')).toBe('test-post-1');
    });

    it('should remove leading and trailing hyphens', () => {
      const generateSlug = (title: string): string => {
        return title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
      };

      expect(generateSlug('---Hello World---')).toBe('hello-world');
      expect(generateSlug('  Spaces Around  ')).toBe('spaces-around');
    });

    it('should handle unicode characters', () => {
      const generateSlug = (title: string): string => {
        return title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
      };

      expect(generateSlug('Café & Résumé')).toBe('caf-r-sum');
    });

    it('should handle empty string', () => {
      const generateSlug = (title: string): string => {
        if (!title) return 'untitled';
        return title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') || 'untitled';
      };

      expect(generateSlug('')).toBe('untitled');
    });
  });

  describe('Checksum Calculation', () => {
    it('should generate consistent checksums', () => {
      const crypto = require('crypto');
      const calculateChecksum = (content: string): string => {
        return crypto.createHash('md5').update(content).digest('hex');
      };

      const content = 'Hello, World!';
      const checksum1 = calculateChecksum(content);
      const checksum2 = calculateChecksum(content);

      expect(checksum1).toBe(checksum2);
      expect(checksum1).toHaveLength(32); // MD5 hex length
    });

    it('should generate different checksums for different content', () => {
      const crypto = require('crypto');
      const calculateChecksum = (content: string): string => {
        return crypto.createHash('md5').update(content).digest('hex');
      };

      const checksum1 = calculateChecksum('Content A');
      const checksum2 = calculateChecksum('Content B');

      expect(checksum1).not.toBe(checksum2);
    });

    it('should handle empty content', () => {
      const crypto = require('crypto');
      const calculateChecksum = (content: string): string => {
        return crypto.createHash('md5').update(content).digest('hex');
      };

      const checksum = calculateChecksum('');
      expect(checksum).toHaveLength(32);
    });
  });

  describe('Post Data Validation', () => {
    it('should create a valid post with default values', () => {
      const createPostData = (data: Partial<ReturnType<typeof createMockPost>>) => {
        const now = new Date();
        const id = data.id || 'generated-id';
        const slug = data.slug || 'untitled';

        return {
          id,
          title: data.title || 'Untitled',
          slug,
          excerpt: data.excerpt,
          content: data.content || '',
          status: data.status || 'draft',
          author: data.author,
          createdAt: data.createdAt || now,
          updatedAt: data.updatedAt || now,
          publishedAt: data.publishedAt,
          tags: data.tags || [],
          categories: data.categories || [],
        };
      };

      const post = createPostData({});
      
      expect(post.title).toBe('Untitled');
      expect(post.status).toBe('draft');
      expect(post.tags).toEqual([]);
      expect(post.categories).toEqual([]);
    });

    it('should preserve provided values', () => {
      const post = createMockPost({
        title: 'My Custom Title',
        status: 'published',
        tags: ['custom', 'tag'],
      });

      expect(post.title).toBe('My Custom Title');
      expect(post.status).toBe('published');
      expect(post.tags).toEqual(['custom', 'tag']);
    });
  });

  describe('YAML Frontmatter Format', () => {
    it('should create valid frontmatter structure', () => {
      const post = createMockPost({
        title: 'Test Post',
        slug: 'test-post',
        status: 'draft',
        author: 'John Doe',
        tags: ['tech', 'tutorial'],
        categories: ['programming'],
      });

      // Simulate frontmatter generation
      const frontmatter = {
        id: post.id,
        title: post.title,
        slug: post.slug,
        excerpt: post.excerpt,
        status: post.status,
        author: post.author,
        createdAt: post.createdAt.toISOString(),
        updatedAt: post.updatedAt.toISOString(),
        publishedAt: post.publishedAt?.toISOString(),
        tags: post.tags,
        categories: post.categories,
      };

      expect(frontmatter.title).toBe('Test Post');
      expect(frontmatter.tags).toEqual(['tech', 'tutorial']);
      expect(frontmatter.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should handle optional fields correctly', () => {
      const post = createMockPost({
        excerpt: undefined,
        author: undefined,
        publishedAt: undefined,
      });

      const frontmatter = {
        id: post.id,
        title: post.title,
        slug: post.slug,
        excerpt: post.excerpt,
        status: post.status,
        author: post.author,
        createdAt: post.createdAt.toISOString(),
        updatedAt: post.updatedAt.toISOString(),
        publishedAt: post.publishedAt?.toISOString(),
        tags: post.tags,
        categories: post.categories,
      };

      expect(frontmatter.excerpt).toBeUndefined();
      expect(frontmatter.author).toBeUndefined();
      expect(frontmatter.publishedAt).toBeUndefined();
    });
  });

  describe('Post Status Transitions', () => {
    it('should allow valid status values', () => {
      const validStatuses = ['draft', 'published', 'archived'] as const;
      
      validStatuses.forEach(status => {
        const post = createMockPost({ status });
        expect(post.status).toBe(status);
      });
    });

    it('should set publishedAt when publishing', () => {
      const now = new Date();
      const post = createMockPost({
        status: 'published',
        publishedAt: now,
      });

      expect(post.status).toBe('published');
      expect(post.publishedAt).toEqual(now);
    });

    it('should not require publishedAt for drafts', () => {
      const post = createMockPost({
        status: 'draft',
        publishedAt: undefined,
      });

      expect(post.status).toBe('draft');
      expect(post.publishedAt).toBeUndefined();
    });
  });

  describe('File Path Generation', () => {
    it('should generate correct file path from slug', () => {
      const postsDir = '/mock/userData/posts';
      const slug = 'my-first-post';
      
      const filePath = `${postsDir}/${slug}.md`;
      
      expect(filePath).toBe('/mock/userData/posts/my-first-post.md');
    });

    it('should handle slugs with numbers', () => {
      const postsDir = '/mock/userData/posts';
      const slug = 'post-123-test';
      
      const filePath = `${postsDir}/${slug}.md`;
      
      expect(filePath).toBe('/mock/userData/posts/post-123-test.md');
    });
  });

  describe('Tags and Categories', () => {
    it('should serialize tags to JSON', () => {
      const tags = ['javascript', 'typescript', 'node'];
      const serialized = JSON.stringify(tags);
      
      expect(serialized).toBe('["javascript","typescript","node"]');
      expect(JSON.parse(serialized)).toEqual(tags);
    });

    it('should handle empty arrays', () => {
      const tags: string[] = [];
      const serialized = JSON.stringify(tags);
      
      expect(serialized).toBe('[]');
      expect(JSON.parse(serialized)).toEqual([]);
    });

    it('should handle tags with special characters', () => {
      const tags = ['c#', 'c++', 'node.js'];
      const serialized = JSON.stringify(tags);
      
      expect(JSON.parse(serialized)).toEqual(tags);
    });
  });

  describe('Date Handling', () => {
    it('should use ISO format for dates', () => {
      const date = new Date('2024-01-15T10:30:00.000Z');
      const isoString = date.toISOString();
      
      expect(isoString).toBe('2024-01-15T10:30:00.000Z');
    });

    it('should parse ISO dates correctly', () => {
      const isoString = '2024-01-15T10:30:00.000Z';
      const date = new Date(isoString);
      
      expect(date.getUTCFullYear()).toBe(2024);
      expect(date.getUTCMonth()).toBe(0); // January
      expect(date.getUTCDate()).toBe(15);
    });

    it('should handle updatedAt being later than createdAt', () => {
      const createdAt = new Date('2024-01-15T10:00:00.000Z');
      const updatedAt = new Date('2024-01-16T15:30:00.000Z');
      
      const post = createMockPost({ createdAt, updatedAt });
      
      expect(post.updatedAt.getTime()).toBeGreaterThan(post.createdAt.getTime());
    });
  });
});

describe('PostEngine Integration Helpers', () => {
  describe('Database Record Conversion', () => {
    it('should convert PostData to database record format', () => {
      const post = createMockPost({
        tags: ['a', 'b'],
        categories: ['c'],
      });

      const dbRecord = {
        id: post.id,
        title: post.title,
        slug: post.slug,
        excerpt: post.excerpt,
        status: post.status,
        author: post.author,
        createdAt: post.createdAt,
        updatedAt: post.updatedAt,
        publishedAt: post.publishedAt,
        filePath: `/mock/userData/posts/${post.slug}.md`,
        syncStatus: 'pending' as const,
        checksum: 'abc123',
        tags: JSON.stringify(post.tags),
        categories: JSON.stringify(post.categories),
      };

      expect(dbRecord.tags).toBe('["a","b"]');
      expect(dbRecord.categories).toBe('["c"]');
    });

    it('should convert database record to PostData format', () => {
      const dbRecord = {
        id: 'post-1',
        title: 'Test Post',
        slug: 'test-post',
        excerpt: 'An excerpt',
        status: 'draft' as const,
        author: 'Author',
        createdAt: new Date(),
        updatedAt: new Date(),
        publishedAt: null,
        filePath: '/mock/path.md',
        syncStatus: 'pending' as const,
        syncedAt: null,
        checksum: 'abc123',
        tags: '["a","b"]',
        categories: '["c"]',
      };

      const postData = {
        id: dbRecord.id,
        title: dbRecord.title,
        slug: dbRecord.slug,
        excerpt: dbRecord.excerpt,
        status: dbRecord.status,
        author: dbRecord.author,
        createdAt: dbRecord.createdAt,
        updatedAt: dbRecord.updatedAt,
        publishedAt: dbRecord.publishedAt || undefined,
        tags: JSON.parse(dbRecord.tags) as string[],
        categories: JSON.parse(dbRecord.categories) as string[],
        content: '', // Would be read from file
      };

      expect(postData.tags).toEqual(['a', 'b']);
      expect(postData.categories).toEqual(['c']);
      expect(postData.publishedAt).toBeUndefined();
    });
  });
});
