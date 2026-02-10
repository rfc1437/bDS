/**
 * MediaEngine Unit Tests
 *
 * Tests the REAL MediaEngine class with mocked dependencies.
 * Following TDD best practices: mock external dependencies, test real implementation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetMockCounters } from '../utils/factories';

// Mock electron BEFORE importing MediaEngine (it uses require('electron') internally)
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

// Import MediaEngine after mocks are set up
import { MediaEngine, MediaData } from '../../src/main/engine/MediaEngine';

// Create mock data stores
const mockMedia = new Map<string, any>();
const mockFiles = new Map<string, Buffer | string>();

// Create chainable mock for Drizzle ORM
function createSelectChain() {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockImplementation(function (this: any) {
      return this;
    }),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    all: vi.fn().mockImplementation(() => Promise.resolve(Array.from(mockMedia.values()))),
    get: vi.fn().mockImplementation(() => Promise.resolve(undefined)),
  };
}

function createDrizzleMock() {
  return {
    select: vi.fn(() => createSelectChain()),
    insert: vi.fn(() => ({
      values: vi.fn((data: any) => {
        if (data && data.id) {
          mockMedia.set(data.id, data);
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

// Mock the database module
vi.mock('../../src/main/database', () => ({
  getDatabase: vi.fn(() => ({
    getLocal: vi.fn(() => mockLocalDb),
    getLocalClient: vi.fn(() => null),
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
  writeFile: vi.fn(async (path: string, content: Buffer | string) => {
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
  copyFile: vi.fn(async (src: string, dest: string) => {
    const content = mockFiles.get(src);
    if (content) {
      mockFiles.set(dest, content);
    }
  }),
}));

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-media-uuid-' + Math.random().toString(36).substr(2, 9)),
}));

describe('MediaEngine', () => {
  let mediaEngine: MediaEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMedia.clear();
    mockFiles.clear();
    resetMockCounters();

    // Reset the mock implementations
    vi.mocked(mockLocalDb.select).mockImplementation(() => createSelectChain());

    mediaEngine = new MediaEngine();
  });

  describe('Constructor and Initialization', () => {
    it('should create a MediaEngine instance', () => {
      expect(mediaEngine).toBeInstanceOf(MediaEngine);
    });

    it('should extend EventEmitter', () => {
      expect(typeof mediaEngine.on).toBe('function');
      expect(typeof mediaEngine.emit).toBe('function');
    });

    it('should have default project context', () => {
      expect(mediaEngine.getProjectContext()).toBe('default');
    });
  });

  describe('Project Context', () => {
    it('should set project context', () => {
      mediaEngine.setProjectContext('my-blog');
      expect(mediaEngine.getProjectContext()).toBe('my-blog');
    });

    it('should allow changing project context multiple times', () => {
      mediaEngine.setProjectContext('blog-1');
      expect(mediaEngine.getProjectContext()).toBe('blog-1');

      mediaEngine.setProjectContext('blog-2');
      expect(mediaEngine.getProjectContext()).toBe('blog-2');
    });
  });

  describe('Media Import', () => {
    beforeEach(() => {
      // Setup a source file for import
      const imageBuffer = Buffer.from('fake-image-data');
      mockFiles.set('/source/image.jpg', imageBuffer);
    });

    it('should import media from source path', async () => {
      const media = await mediaEngine.importMedia('/source/image.jpg');

      expect(media).toBeDefined();
      expect(media.id).toBeDefined();
      expect(media.originalName).toBe('image.jpg');
    });

    it('should detect mime type from file extension', async () => {
      const jpgMedia = await mediaEngine.importMedia('/source/image.jpg');
      expect(jpgMedia.mimeType).toBe('image/jpeg');
    });

    it('should set file size from source', async () => {
      const media = await mediaEngine.importMedia('/source/image.jpg');
      expect(media.size).toBe(Buffer.from('fake-image-data').length);
    });

    it('should use provided metadata', async () => {
      const media = await mediaEngine.importMedia('/source/image.jpg', {
        alt: 'A beautiful sunset',
        caption: 'Sunset over the ocean',
        tags: ['nature', 'sunset'],
      });

      expect(media.alt).toBe('A beautiful sunset');
      expect(media.caption).toBe('Sunset over the ocean');
      expect(media.tags).toEqual(['nature', 'sunset']);
    });

    it('should set createdAt and updatedAt timestamps', async () => {
      const before = new Date();
      const media = await mediaEngine.importMedia('/source/image.jpg');
      const after = new Date();

      expect(media.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(media.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
      expect(media.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(media.updatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should emit mediaImported event', async () => {
      const handler = vi.fn();
      mediaEngine.on('mediaImported', handler);

      const media = await mediaEngine.importMedia('/source/image.jpg');

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          originalName: 'image.jpg',
        })
      );
    });

    it('should create media directory if it does not exist', async () => {
      const fs = await import('fs/promises');
      await mediaEngine.importMedia('/source/image.jpg');

      expect(fs.mkdir).toHaveBeenCalled();
    });

    it('should write media file to destination', async () => {
      const fs = await import('fs/promises');
      await mediaEngine.importMedia('/source/image.jpg');

      expect(fs.writeFile).toHaveBeenCalled();
    });

    it('should insert media record into database', async () => {
      await mediaEngine.importMedia('/source/image.jpg');

      expect(mockLocalDb.insert).toHaveBeenCalled();
    });

    it('should write sidecar metadata file', async () => {
      const fs = await import('fs/promises');
      await mediaEngine.importMedia('/source/image.jpg');

      // Should write both the media file and the sidecar file
      expect(vi.mocked(fs.writeFile).mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('MIME Type Detection', () => {
    beforeEach(() => {
      // Setup various file types
      mockFiles.set('/source/photo.jpg', Buffer.from('jpg-data'));
      mockFiles.set('/source/photo.jpeg', Buffer.from('jpeg-data'));
      mockFiles.set('/source/image.png', Buffer.from('png-data'));
      mockFiles.set('/source/animation.gif', Buffer.from('gif-data'));
      mockFiles.set('/source/modern.webp', Buffer.from('webp-data'));
      mockFiles.set('/source/vector.svg', Buffer.from('svg-data'));
      mockFiles.set('/source/unknown.xyz', Buffer.from('unknown-data'));
    });

    it('should detect image/jpeg for .jpg files', async () => {
      const media = await mediaEngine.importMedia('/source/photo.jpg');
      expect(media.mimeType).toBe('image/jpeg');
    });

    it('should detect image/jpeg for .jpeg files', async () => {
      const media = await mediaEngine.importMedia('/source/photo.jpeg');
      expect(media.mimeType).toBe('image/jpeg');
    });

    it('should detect image/png for .png files', async () => {
      const media = await mediaEngine.importMedia('/source/image.png');
      expect(media.mimeType).toBe('image/png');
    });

    it('should detect image/gif for .gif files', async () => {
      const media = await mediaEngine.importMedia('/source/animation.gif');
      expect(media.mimeType).toBe('image/gif');
    });

    it('should detect image/webp for .webp files', async () => {
      const media = await mediaEngine.importMedia('/source/modern.webp');
      expect(media.mimeType).toBe('image/webp');
    });

    it('should detect image/svg+xml for .svg files', async () => {
      const media = await mediaEngine.importMedia('/source/vector.svg');
      expect(media.mimeType).toBe('image/svg+xml');
    });

    it('should fallback to application/octet-stream for unknown types', async () => {
      const media = await mediaEngine.importMedia('/source/unknown.xyz');
      expect(media.mimeType).toBe('application/octet-stream');
    });
  });

  describe('Media with Image Dimensions', () => {
    beforeEach(() => {
      mockFiles.set('/source/image.jpg', Buffer.from('image-data'));
    });

    it('should store width and height when provided', async () => {
      const media = await mediaEngine.importMedia('/source/image.jpg', {
        width: 1920,
        height: 1080,
      });

      expect(media.width).toBe(1920);
      expect(media.height).toBe(1080);
    });

    it('should handle media without dimensions', async () => {
      const media = await mediaEngine.importMedia('/source/image.jpg');

      expect(media.width).toBeUndefined();
      expect(media.height).toBeUndefined();
    });
  });

  describe('Media Tags', () => {
    beforeEach(() => {
      mockFiles.set('/source/image.jpg', Buffer.from('image-data'));
    });

    it('should store tags', async () => {
      const media = await mediaEngine.importMedia('/source/image.jpg', {
        tags: ['landscape', 'outdoor', 'nature'],
      });

      expect(media.tags).toEqual(['landscape', 'outdoor', 'nature']);
    });

    it('should default to empty tags array', async () => {
      const media = await mediaEngine.importMedia('/source/image.jpg');

      expect(media.tags).toEqual([]);
    });
  });

  describe('Event Emission', () => {
    it('should be an EventEmitter', () => {
      expect(mediaEngine.on).toBeDefined();
      expect(mediaEngine.emit).toBeDefined();
      expect(mediaEngine.removeListener).toBeDefined();
    });

    it('should allow adding event listeners', () => {
      const listener = vi.fn();
      mediaEngine.on('testEvent', listener);
      mediaEngine.emit('testEvent', { data: 'test' });

      expect(listener).toHaveBeenCalledWith({ data: 'test' });
    });

    it('should allow removing event listeners', () => {
      const listener = vi.fn();
      mediaEngine.on('testEvent', listener);
      mediaEngine.removeListener('testEvent', listener);
      mediaEngine.emit('testEvent', { data: 'test' });

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('getMediaPath', () => {
    it('should return path in media directory', () => {
      const path = mediaEngine.getMediaPath('test-id');
      expect(path).toContain('test-id');
      expect(path).toContain('media');
    });
  });

  describe('Multiple Media Import', () => {
    beforeEach(() => {
      mockFiles.set('/source/image1.jpg', Buffer.from('image1-data'));
      mockFiles.set('/source/image2.jpg', Buffer.from('image2-data'));
      mockFiles.set('/source/image3.png', Buffer.from('image3-data'));
    });

    it('should import multiple media with unique IDs', async () => {
      const media1 = await mediaEngine.importMedia('/source/image1.jpg');
      const media2 = await mediaEngine.importMedia('/source/image2.jpg');

      expect(media1.id).toBeDefined();
      expect(media2.id).toBeDefined();
      expect(media1.id).not.toBe(media2.id);
    });

    it('should handle different file types', async () => {
      const jpg = await mediaEngine.importMedia('/source/image1.jpg');
      const png = await mediaEngine.importMedia('/source/image3.png');

      expect(jpg.mimeType).toBe('image/jpeg');
      expect(png.mimeType).toBe('image/png');
    });
  });

  describe('Error Handling', () => {
    it('should throw when source file does not exist', async () => {
      await expect(mediaEngine.importMedia('/source/nonexistent.jpg')).rejects.toThrow('ENOENT');
    });
  });

  describe('Alt Text and Caption', () => {
    beforeEach(() => {
      mockFiles.set('/source/image.jpg', Buffer.from('image-data'));
    });

    it('should store alt text for accessibility', async () => {
      const media = await mediaEngine.importMedia('/source/image.jpg', {
        alt: 'A scenic mountain view',
      });

      expect(media.alt).toBe('A scenic mountain view');
    });

    it('should store caption for display', async () => {
      const media = await mediaEngine.importMedia('/source/image.jpg', {
        caption: 'Photo taken at Mt. Rainier, 2024',
      });

      expect(media.caption).toBe('Photo taken at Mt. Rainier, 2024');
    });

    it('should handle media without alt or caption', async () => {
      const media = await mediaEngine.importMedia('/source/image.jpg');

      expect(media.alt).toBeUndefined();
      expect(media.caption).toBeUndefined();
    });
  });
});
