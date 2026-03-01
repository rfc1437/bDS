/**
 * OpenCodeManager Tool Execution Tests
 *
 * Tests the executeTool method for post-related tools,
 * specifically that backlinks and linksTo are included in results.
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

describe('OpenCodeManager tool execution – backlinks & linksTo', () => {
  let mockPostEngine: ReturnType<typeof createMockPostEngine>;
  let manager: OpenCodeManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPostEngine = createMockPostEngine();
    manager = createManager(mockPostEngine);
  });

  describe('read_post', () => {
    it('includes backlinks and linksTo in the response', async () => {
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
      mockPostEngine.getLinksTo.mockResolvedValue([
        { id: 'p4', title: 'Linked Target', slug: 'linked-target' },
      ]);

      const result = await (manager as any).executeTool('read_post', { postId: 'p1' });

      expect(result.success).toBe(true);
      expect(result.post.backlinks).toEqual([
        { id: 'p2', title: 'Linking Post A', slug: 'linking-a' },
        { id: 'p3', title: 'Linking Post B', slug: 'linking-b' },
      ]);
      expect(result.post.linksTo).toEqual([
        { id: 'p4', title: 'Linked Target', slug: 'linked-target' },
      ]);
      expect(mockPostEngine.getLinkedBy).toHaveBeenCalledWith('p1');
      expect(mockPostEngine.getLinksTo).toHaveBeenCalledWith('p1');
    });

    it('returns empty backlinks and linksTo arrays when none exist', async () => {
      const post = {
        id: 'p1', title: 'Lonely Post', slug: 'lonely-post',
        content: '# Alone', excerpt: '', status: 'draft',
        categories: [], tags: [],
        createdAt: new Date(), updatedAt: new Date(),
      };
      mockPostEngine.getPost.mockResolvedValue(post);
      mockPostEngine.getLinkedBy.mockResolvedValue([]);
      mockPostEngine.getLinksTo.mockResolvedValue([]);

      const result = await (manager as any).executeTool('read_post', { postId: 'p1' });

      expect(result.success).toBe(true);
      expect(result.post.backlinks).toEqual([]);
      expect(result.post.linksTo).toEqual([]);
    });
  });

  describe('search_posts', () => {
    it('includes backlinks and linksTo for each post in search results', async () => {
      const posts = [
        { id: 'p1', title: 'Post One', slug: 'post-one', excerpt: '', status: 'published', categories: [], tags: [], createdAt: new Date(), updatedAt: new Date() },
        { id: 'p2', title: 'Post Two', slug: 'post-two', excerpt: '', status: 'published', categories: [], tags: [], createdAt: new Date(), updatedAt: new Date() },
      ];
      mockPostEngine.searchPostsFiltered.mockResolvedValue(posts);
      mockPostEngine.getLinkedBy
        .mockResolvedValueOnce([{ id: 'p3', title: 'Linker', slug: 'linker' }])
        .mockResolvedValueOnce([]);
      mockPostEngine.getLinksTo
        .mockResolvedValueOnce([{ id: 'p4', title: 'Target', slug: 'target' }])
        .mockResolvedValueOnce([{ id: 'p5', title: 'Other', slug: 'other' }]);

      const result = await (manager as any).executeTool('search_posts', { query: 'test' });

      expect(result.success).toBe(true);
      expect(result.posts[0].backlinks).toEqual([{ id: 'p3', title: 'Linker', slug: 'linker' }]);
      expect(result.posts[0].linksTo).toEqual([{ id: 'p4', title: 'Target', slug: 'target' }]);
      expect(result.posts[1].backlinks).toEqual([]);
      expect(result.posts[1].linksTo).toEqual([{ id: 'p5', title: 'Other', slug: 'other' }]);
      expect(mockPostEngine.getLinkedBy).toHaveBeenCalledTimes(2);
      expect(mockPostEngine.getLinksTo).toHaveBeenCalledTimes(2);
    });
  });

  describe('list_posts', () => {
    it('includes backlinks and linksTo for each post in listed results', async () => {
      const posts = [
        { id: 'p1', title: 'Post A', slug: 'post-a', status: 'published', categories: [], tags: [], createdAt: new Date(), updatedAt: new Date() },
      ];
      mockPostEngine.getAllPosts.mockResolvedValue({ items: posts, total: 1 });
      mockPostEngine.getLinkedBy.mockResolvedValue([
        { id: 'px', title: 'Cross Ref', slug: 'cross-ref' },
      ]);
      mockPostEngine.getLinksTo.mockResolvedValue([
        { id: 'py', title: 'Forward Ref', slug: 'forward-ref' },
      ]);

      const result = await (manager as any).executeTool('list_posts', {});

      expect(result.success).toBe(true);
      expect(result.posts[0].backlinks).toEqual([{ id: 'px', title: 'Cross Ref', slug: 'cross-ref' }]);
      expect(result.posts[0].linksTo).toEqual([{ id: 'py', title: 'Forward Ref', slug: 'forward-ref' }]);
      expect(mockPostEngine.getLinkedBy).toHaveBeenCalledWith('p1');
      expect(mockPostEngine.getLinksTo).toHaveBeenCalledWith('p1');
    });

    it('includes backlinks and linksTo for filtered list results', async () => {
      const posts = [
        { id: 'p5', title: 'Tagged Post', slug: 'tagged', status: 'published', categories: [], tags: ['js'], createdAt: new Date(), updatedAt: new Date() },
      ];
      mockPostEngine.getPostsFiltered.mockResolvedValue(posts);
      mockPostEngine.getLinkedBy.mockResolvedValue([]);
      mockPostEngine.getLinksTo.mockResolvedValue([]);

      const result = await (manager as any).executeTool('list_posts', { tags: ['js'] });

      expect(result.success).toBe(true);
      expect(result.posts[0].backlinks).toEqual([]);
      expect(result.posts[0].linksTo).toEqual([]);
      expect(mockPostEngine.getLinkedBy).toHaveBeenCalledWith('p5');
      expect(mockPostEngine.getLinksTo).toHaveBeenCalledWith('p5');
    });
  });
});

describe('OpenCodeManager – getMaxOutputTokens (ModelCatalogEngine delegate)', () => {
  let manager: OpenCodeManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = createManager(createMockPostEngine());
  });

  it('delegates to ModelCatalogEngine.getMaxOutputTokens', async () => {
    const engine = (manager as any).modelCatalogEngine;
    vi.spyOn(engine, 'getMaxOutputTokens').mockResolvedValue(64000);

    const result = await (manager as any).getMaxOutputTokens('claude-sonnet-4-5');
    expect(result).toBe(64000);
    expect(engine.getMaxOutputTokens).toHaveBeenCalledWith('claude-sonnet-4-5');
  });

  it('returns default when ModelCatalogEngine has no data', async () => {
    const engine = (manager as any).modelCatalogEngine;
    vi.spyOn(engine, 'getMaxOutputTokens').mockResolvedValue(16384);

    const result = await (manager as any).getMaxOutputTokens('unknown-model');
    expect(result).toBe(16384);
  });

  it('exposes ModelCatalogEngine via getModelCatalogEngine()', () => {
    const engine = manager.getModelCatalogEngine();
    expect(engine).toBeDefined();
    expect(engine).toBeInstanceOf(Object);
  });
});
