/**
 * OpenCodeManager Tool Execution Tests
 *
 * Tests the executeTool method for post-related tools,
 * specifically that backlinks are included in results.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies before importing the class
vi.mock('../../src/main/engine/ChatEngine', () => ({
  ChatEngine: class {
    getSetting = vi.fn();
    setSetting = vi.fn();
    getSelectedModel = vi.fn();
    getDefaultSystemPrompt = vi.fn();
  },
}));

vi.mock('../../src/main/engine/PostEngine', () => ({
  getPostEngine: vi.fn(() => ({})),
}));

vi.mock('../../src/main/engine/MediaEngine', () => ({
  getMediaEngine: vi.fn(() => ({})),
}));

vi.mock('../../src/main/database', () => ({
  getDatabase: vi.fn(() => ({})),
}));

import { OpenCodeManager } from '../../src/main/engine/OpenCodeManager';

function createMockPostEngine() {
  return {
    getPost: vi.fn(),
    searchPosts: vi.fn(),
    searchPostsFiltered: vi.fn(),
    getAllPosts: vi.fn(),
    getPostsFiltered: vi.fn(),
    getDashboardStats: vi.fn().mockResolvedValue({ totalPosts: 0 }),
    getLinkedBy: vi.fn().mockResolvedValue([]),
    getLinksTo: vi.fn().mockResolvedValue([]),
    getTagsWithCounts: vi.fn().mockResolvedValue([]),
    getCategoriesWithCounts: vi.fn().mockResolvedValue([]),
    getBlogStats: vi.fn().mockResolvedValue({}),
  };
}

function createMockMediaEngine() {
  return {
    getAllMedia: vi.fn(),
    getMedia: vi.fn(),
    getThumbnailDataUrl: vi.fn(),
  };
}

function createMockPostMediaEngine() {
  return {
    getLinkedMediaDataForPost: vi.fn().mockResolvedValue([]),
    getLinkedPostsForMedia: vi.fn().mockResolvedValue([]),
  };
}

function createManager(postEngine: ReturnType<typeof createMockPostEngine>, mediaEngine?: ReturnType<typeof createMockMediaEngine>, postMediaEngine?: ReturnType<typeof createMockPostMediaEngine>) {
  const manager = new OpenCodeManager(
    { getSetting: vi.fn(), setSetting: vi.fn() } as never,
    postEngine as never,
    (mediaEngine ?? createMockMediaEngine()) as never,
    (postMediaEngine ?? createMockPostMediaEngine()) as never,
    () => null,
  );
  return manager;
}

describe('OpenCodeManager tool execution – backlinks', () => {
  let mockPostEngine: ReturnType<typeof createMockPostEngine>;
  let manager: OpenCodeManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPostEngine = createMockPostEngine();
    manager = createManager(mockPostEngine);
  });

  describe('read_post', () => {
    it('includes backlinks in the response', async () => {
      const post = {
        id: 'p1', title: 'Target Post', slug: 'target-post',
        content: '# Hello', excerpt: 'Hello', status: 'published',
        author: 'Test', categories: ['article'], tags: ['test'],
        createdAt: new Date('2025-01-01'), updatedAt: new Date('2025-01-02'),
        publishedAt: new Date('2025-01-01'),
      };
      mockPostEngine.getPost.mockResolvedValue(post);
      mockPostEngine.getLinkedBy.mockResolvedValue([
        { id: 'p2', title: 'Linking Post A', slug: 'linking-a' },
        { id: 'p3', title: 'Linking Post B', slug: 'linking-b' },
      ]);

      const result = await (manager as any).executeTool('read_post', { postId: 'p1' });

      expect(result.success).toBe(true);
      expect(result.post.backlinks).toEqual([
        { id: 'p2', title: 'Linking Post A', slug: 'linking-a' },
        { id: 'p3', title: 'Linking Post B', slug: 'linking-b' },
      ]);
      expect(mockPostEngine.getLinkedBy).toHaveBeenCalledWith('p1');
    });

    it('returns empty backlinks array when no backlinks exist', async () => {
      const post = {
        id: 'p1', title: 'Lonely Post', slug: 'lonely-post',
        content: '# Alone', excerpt: '', status: 'draft',
        categories: [], tags: [],
        createdAt: new Date(), updatedAt: new Date(),
      };
      mockPostEngine.getPost.mockResolvedValue(post);
      mockPostEngine.getLinkedBy.mockResolvedValue([]);

      const result = await (manager as any).executeTool('read_post', { postId: 'p1' });

      expect(result.success).toBe(true);
      expect(result.post.backlinks).toEqual([]);
    });
  });

  describe('search_posts', () => {
    it('includes backlinks for each post in search results', async () => {
      const posts = [
        { id: 'p1', title: 'Post One', slug: 'post-one', excerpt: '', status: 'published', categories: [], tags: [], createdAt: new Date(), updatedAt: new Date() },
        { id: 'p2', title: 'Post Two', slug: 'post-two', excerpt: '', status: 'published', categories: [], tags: [], createdAt: new Date(), updatedAt: new Date() },
      ];
      mockPostEngine.searchPostsFiltered.mockResolvedValue(posts);
      mockPostEngine.getLinkedBy
        .mockResolvedValueOnce([{ id: 'p3', title: 'Linker', slug: 'linker' }])
        .mockResolvedValueOnce([]);

      const result = await (manager as any).executeTool('search_posts', { query: 'test' });

      expect(result.success).toBe(true);
      expect(result.posts[0].backlinks).toEqual([{ id: 'p3', title: 'Linker', slug: 'linker' }]);
      expect(result.posts[1].backlinks).toEqual([]);
      expect(mockPostEngine.getLinkedBy).toHaveBeenCalledTimes(2);
    });
  });

  describe('list_posts', () => {
    it('includes backlinks for each post in listed results', async () => {
      const posts = [
        { id: 'p1', title: 'Post A', slug: 'post-a', status: 'published', categories: [], tags: [], createdAt: new Date(), updatedAt: new Date() },
      ];
      mockPostEngine.getAllPosts.mockResolvedValue({ items: posts, total: 1 });
      mockPostEngine.getLinkedBy.mockResolvedValue([
        { id: 'px', title: 'Cross Ref', slug: 'cross-ref' },
      ]);

      const result = await (manager as any).executeTool('list_posts', {});

      expect(result.success).toBe(true);
      expect(result.posts[0].backlinks).toEqual([{ id: 'px', title: 'Cross Ref', slug: 'cross-ref' }]);
      expect(mockPostEngine.getLinkedBy).toHaveBeenCalledWith('p1');
    });

    it('includes backlinks for filtered list results', async () => {
      const posts = [
        { id: 'p5', title: 'Tagged Post', slug: 'tagged', status: 'published', categories: [], tags: ['js'], createdAt: new Date(), updatedAt: new Date() },
      ];
      mockPostEngine.getPostsFiltered.mockResolvedValue(posts);
      mockPostEngine.getLinkedBy.mockResolvedValue([]);

      const result = await (manager as any).executeTool('list_posts', { tags: ['js'] });

      expect(result.success).toBe(true);
      expect(result.posts[0].backlinks).toEqual([]);
      expect(mockPostEngine.getLinkedBy).toHaveBeenCalledWith('p5');
    });
  });
});
