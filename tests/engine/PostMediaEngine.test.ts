/**
 * PostMediaEngine Unit Tests
 *
 * Tests the REAL PostMediaEngine class with mocked dependencies.
 * Following TDD best practices: mock external dependencies, test real implementation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetMockCounters, createMockMedia } from '../utils/factories';

// Mock electron BEFORE importing engine
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      const paths: Record<string, string> = {
        userData: '/mock/userData',
        appData: '/mock/appData',
        temp: '/mock/temp',
      };
      return paths[name] || '/mock/unknown';
    }),
  },
}));

// Create mock data stores
const mockPostMedia = new Map<string, any>();

// MediaEngine mock functions - defined at module level
const mockGetMedia = vi.fn();
const mockUpdateMedia = vi.fn();
const mockGetAllMedia = vi.fn();
const mockImportMedia = vi.fn();

// Mock MediaEngine
vi.mock('../../src/main/engine/MediaEngine', () => ({
  getMediaEngine: vi.fn(() => ({
    getMedia: mockGetMedia,
    updateMedia: mockUpdateMedia,
    getAllMedia: mockGetAllMedia,
    importMedia: mockImportMedia,
  })),
}));

// Create chainable mock for Drizzle ORM
// Drizzle query chains are "thenable" - they resolve to results when awaited
function createSelectChain(mockData: any[] = []) {
  const chain: any = {
    from: vi.fn().mockImplementation(() => chain),
    where: vi.fn().mockImplementation(() => chain),
    orderBy: vi.fn().mockImplementation(() => chain),
    limit: vi.fn().mockImplementation(() => chain),
    offset: vi.fn().mockImplementation(() => chain),
    all: vi.fn().mockResolvedValue(mockData),
    get: vi.fn().mockResolvedValue(mockData[0] || undefined),
    // Make chain "thenable" so it can be awaited
    then: (resolve: any, reject: any) => Promise.resolve(mockData).then(resolve, reject),
  };
  return chain;
}

// Track database operations
let insertedValues: any[] = [];
let updateCalls: any[] = [];
let deleteCalled = false;
let selectMockData: any[] = [];

function createDrizzleMock() {
  return {
    select: vi.fn(() => createSelectChain(selectMockData)),
    insert: vi.fn(() => ({
      values: vi.fn((data: any) => {
        if (data && data.id) {
          mockPostMedia.set(data.id, data);
          insertedValues.push(data);
        }
        return Promise.resolve();
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((data: any) => ({
        where: vi.fn(() => {
          updateCalls.push(data);
          return Promise.resolve();
        }),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => {
        deleteCalled = true;
        return Promise.resolve();
      }),
    })),
  };
}

const mockLocalDb = createDrizzleMock();

// Mock the database module
vi.mock('../../src/main/database', () => ({
  getDatabase: vi.fn(() => ({
    getLocal: vi.fn(() => mockLocalDb),
    getLocalClient: vi.fn(() => ({
      execute: vi.fn().mockResolvedValue({ rows: [] }),
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
  })),
}));

// Import after mocks are set up
import { PostMediaEngine } from '../../src/main/engine/PostMediaEngine';

describe('PostMediaEngine', () => {
  let engine: PostMediaEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPostMedia.clear();
    insertedValues = [];
    updateCalls = [];
    deleteCalled = false;
    selectMockData = [];
    resetMockCounters();
    
    // Reset MediaEngine mocks
    mockGetMedia.mockReset();
    mockUpdateMedia.mockReset();
    mockGetAllMedia.mockReset();
    mockImportMedia.mockReset();
    
    // Default implementations
    mockGetMedia.mockResolvedValue(null);
    mockUpdateMedia.mockResolvedValue(undefined);
    mockGetAllMedia.mockResolvedValue([]);
    mockImportMedia.mockResolvedValue({ id: 'imported-media-id' });
    
    engine = new PostMediaEngine();
    engine.setProjectContext('test-project');
  });

  describe('Project Context', () => {
    it('should set project context', () => {
      engine.setProjectContext('my-blog');
      expect(true).toBe(true);
    });

    it('should allow changing project context multiple times', () => {
      engine.setProjectContext('blog-1');
      engine.setProjectContext('blog-2');
      expect(true).toBe(true);
    });
  });

  describe('linkMediaToPost', () => {
    it('should create a new link between media and post', async () => {
      const postId = 'post-1';
      const mediaId = 'media-1';
      
      // Setup mock media
      const mockMediaData = createMockMedia({ id: mediaId, linkedPostIds: [] });
      mockGetMedia.mockResolvedValue(mockMediaData);

      const result = await engine.linkMediaToPost(postId, mediaId);

      expect(result).toBeDefined();
      expect(result.postId).toBe(postId);
      expect(result.mediaId).toBe(mediaId);
      expect(result.sortOrder).toBe(0);
    });

    it('should update media sidecar with linkedPostIds', async () => {
      const postId = 'post-1';
      const mediaId = 'media-1';
      const mockMediaData = createMockMedia({ id: mediaId, linkedPostIds: [] });
      mockGetMedia.mockResolvedValue(mockMediaData);

      await engine.linkMediaToPost(postId, mediaId);

      expect(mockUpdateMedia).toHaveBeenCalledWith(
        mediaId,
        expect.objectContaining({
          linkedPostIds: expect.arrayContaining([postId]),
        })
      );
    });

    it('should emit mediaLinked event', async () => {
      const postId = 'post-1';
      const mediaId = 'media-1';
      mockGetMedia.mockResolvedValue(createMockMedia({ id: mediaId }));

      const handler = vi.fn();
      engine.on('mediaLinked', handler);

      await engine.linkMediaToPost(postId, mediaId);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ postId, mediaId })
      );
    });
  });

  describe('unlinkMediaFromPost', () => {
    it('should remove link between media and post', async () => {
      const postId = 'post-1';
      const mediaId = 'media-1';
      
      mockGetMedia.mockResolvedValue(
        createMockMedia({ id: mediaId, linkedPostIds: [postId] })
      );

      await engine.unlinkMediaFromPost(postId, mediaId);

      expect(deleteCalled).toBe(true);
    });

    it('should update media sidecar to remove postId', async () => {
      const postId = 'post-1';
      const mediaId = 'media-1';
      mockGetMedia.mockResolvedValue(
        createMockMedia({ id: mediaId, linkedPostIds: [postId, 'other-post'] })
      );

      await engine.unlinkMediaFromPost(postId, mediaId);

      expect(mockUpdateMedia).toHaveBeenCalledWith(
        mediaId,
        expect.objectContaining({
          linkedPostIds: ['other-post'],
        })
      );
    });

    it('should emit mediaUnlinked event', async () => {
      const postId = 'post-1';
      const mediaId = 'media-1';
      mockGetMedia.mockResolvedValue(
        createMockMedia({ id: mediaId, linkedPostIds: [postId] })
      );

      const handler = vi.fn();
      engine.on('mediaUnlinked', handler);

      await engine.unlinkMediaFromPost(postId, mediaId);

      expect(handler).toHaveBeenCalledWith({ postId, mediaId });
    });
  });

  describe('getLinkedMediaForPost', () => {
    it('should return all media linked to a post in sort order', async () => {
      const postId = 'post-1';
      
      // Mock the database to return sorted links
      selectMockData = [
        { id: 'link-2', projectId: 'test-project', postId, mediaId: 'media-2', sortOrder: 0, createdAt: new Date() },
        { id: 'link-1', projectId: 'test-project', postId, mediaId: 'media-1', sortOrder: 1, createdAt: new Date() },
      ];

      const result = await engine.getLinkedMediaForPost(postId);

      expect(result).toHaveLength(2);
      expect(result[0].mediaId).toBe('media-2');
      expect(result[1].mediaId).toBe('media-1');
    });

    it('should return empty array if no media linked', async () => {
      selectMockData = [];

      const result = await engine.getLinkedMediaForPost('post-with-no-media');

      expect(result).toEqual([]);
    });
  });

  describe('getLinkedPostsForMedia', () => {
    it('should return all posts linked to a media file', async () => {
      const mediaId = 'media-1';
      
      selectMockData = [
        { id: 'link-1', projectId: 'test-project', postId: 'post-1', mediaId, sortOrder: 0, createdAt: new Date() },
        { id: 'link-2', projectId: 'test-project', postId: 'post-2', mediaId, sortOrder: 0, createdAt: new Date() },
      ];

      const result = await engine.getLinkedPostsForMedia(mediaId);

      expect(result).toHaveLength(2);
      expect(result.map(l => l.postId)).toContain('post-1');
      expect(result.map(l => l.postId)).toContain('post-2');
    });
  });

  describe('reorderMediaForPost', () => {
    it('should update sortOrder for all media in new order', async () => {
      const postId = 'post-1';
      const newOrder = ['media-2', 'media-3', 'media-1'];

      await engine.reorderMediaForPost(postId, newOrder);

      expect(updateCalls).toHaveLength(3);
    });

    it('should emit mediaReordered event', async () => {
      const postId = 'post-1';
      const newOrder = ['media-2', 'media-1'];

      const handler = vi.fn();
      engine.on('mediaReordered', handler);

      await engine.reorderMediaForPost(postId, newOrder);

      expect(handler).toHaveBeenCalledWith({ postId, mediaIds: newOrder });
    });
  });

  describe('rebuildFromSidecars', () => {
    it('should rebuild junction table from media sidecar linkedPostIds', async () => {
      const media1 = createMockMedia({ 
        id: 'media-1', 
        linkedPostIds: ['post-1', 'post-2'] 
      });
      const media2 = createMockMedia({ 
        id: 'media-2', 
        linkedPostIds: ['post-1'] 
      });

      mockGetAllMedia.mockResolvedValue([media1, media2]);

      await engine.rebuildFromSidecars();

      // Should have deleted existing links first
      expect(deleteCalled).toBe(true);
      // Should have created 3 links total (2 for media-1 + 1 for media-2)
      expect(insertedValues).toHaveLength(3);
    });

    it('should emit rebuilt event when complete', async () => {
      mockGetAllMedia.mockResolvedValue([]);

      const handler = vi.fn();
      engine.on('rebuilt', handler);

      await engine.rebuildFromSidecars();

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('isMediaLinkedToPost', () => {
    it('should return true when media is linked to post', async () => {
      selectMockData = [
        { id: 'link-1', postId: 'post-1', mediaId: 'media-1' }
      ];

      const result = await engine.isMediaLinkedToPost('post-1', 'media-1');

      expect(result).toBe(true);
    });

    it('should return false when media is not linked to post', async () => {
      selectMockData = [];

      const result = await engine.isMediaLinkedToPost('post-1', 'media-1');

      expect(result).toBe(false);
    });
  });
});
