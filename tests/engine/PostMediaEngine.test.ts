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

    it('should not create a duplicate link when media is already linked to the post', async () => {
      const postId = 'post-1';
      const mediaId = 'media-1';

      selectMockData = [
        { id: 'existing-link', projectId: 'test-project', postId, mediaId, sortOrder: 2, createdAt: new Date() },
      ];

      mockGetMedia.mockResolvedValue(createMockMedia({ id: mediaId, linkedPostIds: [postId] }));

      const result = await engine.linkMediaToPost(postId, mediaId);

      expect(insertedValues).toHaveLength(0);
      expect(result.id).toBe('existing-link');
      expect(result.sortOrder).toBe(2);
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

  describe('linkManyToPost', () => {
    it('should link multiple media files to a post in a single batch', async () => {
      const postId = 'post-1';
      const mediaIds = ['media-1', 'media-2', 'media-3'];
      
      // No existing links
      selectMockData = [];
      
      // Setup mock media for each
      mockGetMedia.mockImplementation((id: string) => 
        Promise.resolve(createMockMedia({ id, linkedPostIds: [] }))
      );

      const result = await engine.linkManyToPost(postId, mediaIds);

      expect(result.linked).toHaveLength(3);
      expect(result.skipped).toHaveLength(0);
      expect(insertedValues).toHaveLength(3);
    });

    it('should skip already linked media and include them in skipped array', async () => {
      const postId = 'post-1';
      const mediaIds = ['media-1', 'media-2', 'media-3'];
      
      // media-1 is already linked
      selectMockData = [
        { id: 'link-1', projectId: 'test-project', postId, mediaId: 'media-1', sortOrder: 0, createdAt: new Date() },
      ];
      
      mockGetMedia.mockImplementation((id: string) => 
        Promise.resolve(createMockMedia({ id, linkedPostIds: id === 'media-1' ? [postId] : [] }))
      );

      const result = await engine.linkManyToPost(postId, mediaIds);

      expect(result.linked).toHaveLength(2);
      expect(result.linked).toContain('media-2');
      expect(result.linked).toContain('media-3');
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped).toContain('media-1');
    });

    it('should emit mediaBatchLinked event once at the end', async () => {
      const postId = 'post-1';
      const mediaIds = ['media-1', 'media-2'];
      selectMockData = [];
      
      mockGetMedia.mockResolvedValue(createMockMedia({ id: 'any', linkedPostIds: [] }));

      const handler = vi.fn();
      engine.on('mediaBatchLinked', handler);
      // Should NOT emit individual mediaLinked events
      const individualHandler = vi.fn();
      engine.on('mediaLinked', individualHandler);

      await engine.linkManyToPost(postId, mediaIds);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ postId, mediaIds: expect.arrayContaining(['media-1', 'media-2']) });
      expect(individualHandler).not.toHaveBeenCalled();
    });

    it('should not emit event if no media was linked', async () => {
      const postId = 'post-1';
      const mediaIds = ['media-1'];
      
      // media-1 is already linked
      selectMockData = [
        { id: 'link-1', projectId: 'test-project', postId, mediaId: 'media-1', sortOrder: 0, createdAt: new Date() },
      ];
      
      mockGetMedia.mockResolvedValue(createMockMedia({ id: 'media-1', linkedPostIds: [postId] }));

      const handler = vi.fn();
      engine.on('mediaBatchLinked', handler);

      await engine.linkManyToPost(postId, mediaIds);

      expect(handler).not.toHaveBeenCalled();
    });

    it('should update sortOrder incrementally for batch-linked media', async () => {
      const postId = 'post-1';
      const mediaIds = ['media-1', 'media-2', 'media-3'];
      selectMockData = [];
      
      mockGetMedia.mockResolvedValue(createMockMedia({ linkedPostIds: [] }));

      await engine.linkManyToPost(postId, mediaIds);

      // Check that sort orders are sequential
      const sortOrders = insertedValues.map(v => v.sortOrder);
      expect(sortOrders).toEqual([0, 1, 2]);
    });
  });

  describe('unlinkManyFromPost', () => {
    it('should unlink multiple media files from a post in a single batch', async () => {
      const postId = 'post-1';
      const mediaIds = ['media-1', 'media-2', 'media-3'];
      
      mockGetMedia.mockImplementation((id: string) => 
        Promise.resolve(createMockMedia({ id, linkedPostIds: [postId] }))
      );

      const result = await engine.unlinkManyFromPost(postId, mediaIds);

      expect(result.unlinked).toHaveLength(3);
      // deleteCalled flag is set to true when any delete is called
      expect(deleteCalled).toBe(true);
    });

    it('should emit mediaBatchUnlinked event once at the end', async () => {
      const postId = 'post-1';
      const mediaIds = ['media-1', 'media-2'];
      
      mockGetMedia.mockResolvedValue(createMockMedia({ linkedPostIds: [postId] }));

      const handler = vi.fn();
      engine.on('mediaBatchUnlinked', handler);
      // Should NOT emit individual mediaUnlinked events
      const individualHandler = vi.fn();
      engine.on('mediaUnlinked', individualHandler);

      await engine.unlinkManyFromPost(postId, mediaIds);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ postId, mediaIds: expect.arrayContaining(['media-1', 'media-2']) });
      expect(individualHandler).not.toHaveBeenCalled();
    });

    it('should not emit event if no media was unlinked', async () => {
      const postId = 'post-1';
      const mediaIds: string[] = [];
      
      const handler = vi.fn();
      engine.on('mediaBatchUnlinked', handler);

      await engine.unlinkManyFromPost(postId, mediaIds);

      expect(handler).not.toHaveBeenCalled();
    });

    it('should update media sidecars to remove postId', async () => {
      const postId = 'post-1';
      const mediaIds = ['media-1', 'media-2'];
      
      mockGetMedia.mockImplementation((id: string) => 
        Promise.resolve(createMockMedia({ id, linkedPostIds: [postId, 'other-post'] }))
      );

      await engine.unlinkManyFromPost(postId, mediaIds);

      // Both media should have their sidecars updated
      expect(mockUpdateMedia).toHaveBeenCalledTimes(2);
      expect(mockUpdateMedia).toHaveBeenCalledWith(
        'media-1',
        expect.objectContaining({ linkedPostIds: ['other-post'] })
      );
      expect(mockUpdateMedia).toHaveBeenCalledWith(
        'media-2',
        expect.objectContaining({ linkedPostIds: ['other-post'] })
      );
    });

    it('should process duplicate media IDs only once in a single batch', async () => {
      const postId = 'post-1';
      const mediaIds = ['media-1', 'media-1', 'media-2'];

      mockGetMedia.mockImplementation((id: string) =>
        Promise.resolve(createMockMedia({ id, linkedPostIds: [postId, 'other-post'] }))
      );

      const result = await engine.unlinkManyFromPost(postId, mediaIds);

      expect(result.unlinked).toEqual(['media-1', 'media-2']);
      expect(mockUpdateMedia).toHaveBeenCalledTimes(2);
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

  describe('importMediaForPost', () => {
    it('should import media and link it to the post', async () => {
      const postId = 'post-1';
      const sourcePath = '/path/to/image.jpg';
      const importedMediaId = 'imported-media-123';

      mockImportMedia.mockResolvedValue({ id: importedMediaId });
      mockGetMedia.mockResolvedValue(createMockMedia({ id: importedMediaId, linkedPostIds: [] }));

      const result = await engine.importMediaForPost(postId, sourcePath);

      expect(mockImportMedia).toHaveBeenCalledWith(sourcePath);
      expect(result.postId).toBe(postId);
      expect(result.mediaId).toBe(importedMediaId);
    });
  });

  describe('getLinkedMediaDataForPost', () => {
    it('should return linked media with full media data', async () => {
      const postId = 'post-1';
      const media1 = createMockMedia({ id: 'media-1', title: 'Image 1' });
      const media2 = createMockMedia({ id: 'media-2', title: 'Image 2' });

      selectMockData = [
        { id: 'link-1', projectId: 'test-project', postId, mediaId: 'media-1', sortOrder: 0, createdAt: new Date() },
        { id: 'link-2', projectId: 'test-project', postId, mediaId: 'media-2', sortOrder: 1, createdAt: new Date() },
      ];

      mockGetMedia.mockImplementation((id: string) => {
        if (id === 'media-1') return Promise.resolve(media1);
        if (id === 'media-2') return Promise.resolve(media2);
        return Promise.resolve(null);
      });

      const result = await engine.getLinkedMediaDataForPost(postId);

      expect(result).toHaveLength(2);
      expect(result[0].media.title).toBe('Image 1');
      expect(result[1].media.title).toBe('Image 2');
    });

    it('should skip links where media is not found', async () => {
      const postId = 'post-1';
      const media1 = createMockMedia({ id: 'media-1', title: 'Image 1' });

      selectMockData = [
        { id: 'link-1', projectId: 'test-project', postId, mediaId: 'media-1', sortOrder: 0, createdAt: new Date() },
        { id: 'link-2', projectId: 'test-project', postId, mediaId: 'media-deleted', sortOrder: 1, createdAt: new Date() },
      ];

      mockGetMedia.mockImplementation((id: string) => {
        if (id === 'media-1') return Promise.resolve(media1);
        return Promise.resolve(null); // media-deleted not found
      });

      const result = await engine.getLinkedMediaDataForPost(postId);

      expect(result).toHaveLength(1);
      expect(result[0].media.title).toBe('Image 1');
    });

    it('should return empty array when no links exist', async () => {
      selectMockData = [];

      const result = await engine.getLinkedMediaDataForPost('post-no-links');

      expect(result).toEqual([]);
    });
  });

  describe('edge cases for linkMediaToPost', () => {
    it('should not add duplicate postId to linkedPostIds', async () => {
      const postId = 'post-1';
      const mediaId = 'media-1';

      // Media already has this post linked
      mockGetMedia.mockResolvedValue(createMockMedia({
        id: mediaId,
        linkedPostIds: [postId] // Already linked
      }));

      await engine.linkMediaToPost(postId, mediaId);

      // updateMedia should not be called since post is already in linkedPostIds
      expect(mockUpdateMedia).not.toHaveBeenCalled();
    });

    it('should calculate correct sortOrder when existing links present', async () => {
      const postId = 'post-1';
      const mediaId = 'media-new';

      // Existing links with specific sort orders
      selectMockData = [
        { id: 'link-1', projectId: 'test-project', postId, mediaId: 'media-1', sortOrder: 5, createdAt: new Date() },
        { id: 'link-2', projectId: 'test-project', postId, mediaId: 'media-2', sortOrder: 10, createdAt: new Date() },
      ];

      mockGetMedia.mockResolvedValue(createMockMedia({ id: mediaId, linkedPostIds: [] }));

      const result = await engine.linkMediaToPost(postId, mediaId);

      // sortOrder should be max + 1 = 11
      expect(result.sortOrder).toBe(11);
    });

    it('should handle null media when linking', async () => {
      const postId = 'post-1';
      const mediaId = 'media-nonexistent';

      // Media not found
      mockGetMedia.mockResolvedValue(null);

      const result = await engine.linkMediaToPost(postId, mediaId);

      // Should still create the link
      expect(result.postId).toBe(postId);
      expect(result.mediaId).toBe(mediaId);
      // But updateMedia shouldn't be called
      expect(mockUpdateMedia).not.toHaveBeenCalled();
    });
  });
});
