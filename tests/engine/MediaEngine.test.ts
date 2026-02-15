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
const mockPostMedia = new Map<string, any>();
const mockFiles = new Map<string, Buffer | string>();

// Track database operations for testing
let mediaDeleteCalled = false;
let postMediaDeleteCalled = false;
let postMediaInserts: any[] = [];

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
    insert: vi.fn((table: any) => ({
      values: vi.fn((data: any) => {
        // Check if this is an insert to postMedia table by looking at inserted data structure
        if (data && data.postId && data.mediaId && !data.filename) {
          // This is a postMedia insert
          mockPostMedia.set(data.id, data);
          postMediaInserts.push(data);
        } else if (data && data.id) {
          // This is a media insert
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
    delete: vi.fn((table: any) => ({
      where: vi.fn((condition: any) => {
        // Track which table is being deleted from
        // We detect by the condition - if it involves projectId and no filename, it's likely postMedia
        // This is a simplified heuristic for testing
        if (table && table.postId !== undefined) {
          postMediaDeleteCalled = true;
          mockPostMedia.clear();
        } else {
          mediaDeleteCalled = true;
          mockMedia.clear();
        }
        return Promise.resolve();
      }),
    })),
  };
}

const mockLocalDb = createDrizzleMock();

// Track FTS operations
let ftsExecuteCalls: { sql: string; args?: any[] }[] = [];

// Mock the database module
vi.mock('../../src/main/database', () => ({
  getDatabase: vi.fn(() => ({
    getLocal: vi.fn(() => mockLocalDb),
    getLocalClient: vi.fn(() => ({
      execute: vi.fn(async (query: { sql: string; args?: any[] } | string) => {
        const sqlObj = typeof query === 'string' ? { sql: query } : query;
        ftsExecuteCalls.push(sqlObj);
        
        // Mock FTS search results
        if (sqlObj.sql.includes('media_fts MATCH')) {
          return { rows: [] }; // Return empty results by default
        }
        return { rows: [] };
      }),
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
    mockPostMedia.clear();
    mockFiles.clear();
    mediaDeleteCalled = false;
    postMediaDeleteCalled = false;
    postMediaInserts = [];
    ftsExecuteCalls = [];
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

    it('should have default search language', () => {
      expect(mediaEngine.getSearchLanguage()).toBe('english');
    });
  });

  describe('Search Language', () => {
    it('should set search language', () => {
      mediaEngine.setSearchLanguage('german');
      expect(mediaEngine.getSearchLanguage()).toBe('german');
    });

    it('should allow changing search language multiple times', () => {
      mediaEngine.setSearchLanguage('french');
      expect(mediaEngine.getSearchLanguage()).toBe('french');

      mediaEngine.setSearchLanguage('spanish');
      expect(mediaEngine.getSearchLanguage()).toBe('spanish');
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
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    
    beforeEach(() => {
      // Spy on console.error to suppress expected error output (sharp can't read mock files)
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      // Setup a source file for import
      const imageBuffer = Buffer.from('fake-image-data');
      mockFiles.set('/source/image.jpg', imageBuffer);
    });
    
    afterEach(() => {
      consoleErrorSpy.mockRestore();
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

    it('should use provided createdAt date when specified', async () => {
      const historicalDate = new Date('2018-05-15T10:30:00Z');
      const media = await mediaEngine.importMedia('/source/image.jpg', {
        createdAt: historicalDate,
        updatedAt: historicalDate,
      });

      expect(media.createdAt.getTime()).toBe(historicalDate.getTime());
      expect(media.updatedAt.getTime()).toBe(historicalDate.getTime());
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

    it('should copy media file to destination', async () => {
      const fs = await import('fs/promises');
      await mediaEngine.importMedia('/source/image.jpg');

      expect(fs.copyFile).toHaveBeenCalled();
    });

    it('should insert media record into database', async () => {
      await mediaEngine.importMedia('/source/image.jpg');

      expect(mockLocalDb.insert).toHaveBeenCalled();
    });

    it('should write sidecar metadata file', async () => {
      const fs = await import('fs/promises');
      await mediaEngine.importMedia('/source/image.jpg');

      // Should copy the media file and write the sidecar file
      expect(vi.mocked(fs.copyFile).mock.calls.length).toBeGreaterThanOrEqual(1);
      expect(vi.mocked(fs.writeFile).mock.calls.length).toBeGreaterThanOrEqual(1);
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

  describe('getRelativePath', () => {
    it('should return relative path from dataDir for a media item', async () => {
      mediaEngine.setProjectContext('test-project', '/projects/my-blog');

      const selectChain = createSelectChain();
      selectChain.get.mockResolvedValue({
        id: 'abc-123',
        filePath: '/projects/my-blog/media/2025/01/abc-123.jpg',
      });
      vi.mocked(mockLocalDb.select).mockReturnValue(selectChain as any);

      const result = await mediaEngine.getRelativePath('abc-123');

      expect(result).toBe('media/2025/01/abc-123.jpg');
    });

    it('should return null when media item is not found', async () => {
      mediaEngine.setProjectContext('test-project', '/projects/my-blog');

      const selectChain = createSelectChain();
      selectChain.get.mockResolvedValue(undefined);
      vi.mocked(mockLocalDb.select).mockReturnValue(selectChain as any);

      const result = await mediaEngine.getRelativePath('nonexistent');

      expect(result).toBeNull();
    });

    it('should return null when filePath is empty', async () => {
      mediaEngine.setProjectContext('test-project', '/projects/my-blog');

      const selectChain = createSelectChain();
      selectChain.get.mockResolvedValue({ id: 'abc-123', filePath: '' });
      vi.mocked(mockLocalDb.select).mockReturnValue(selectChain as any);

      const result = await mediaEngine.getRelativePath('abc-123');

      expect(result).toBeNull();
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

  describe('Title, Alt Text and Caption', () => {
    beforeEach(() => {
      mockFiles.set('/source/image.jpg', Buffer.from('image-data'));
    });

    it('should store title for display in lists and search', async () => {
      const media = await mediaEngine.importMedia('/source/image.jpg', {
        title: 'Mountain Sunrise Photo',
      });

      expect(media.title).toBe('Mountain Sunrise Photo');
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

    it('should handle media without title, alt or caption', async () => {
      const media = await mediaEngine.importMedia('/source/image.jpg');

      expect(media.title).toBeUndefined();
      expect(media.alt).toBeUndefined();
      expect(media.caption).toBeUndefined();
    });
  });

  describe('Author Field', () => {
    beforeEach(() => {
      mockFiles.set('/source/author-test.jpg', Buffer.from('image-data'));
    });

    it('should store author when provided during import', async () => {
      const media = await mediaEngine.importMedia('/source/author-test.jpg', {
        author: 'John Doe',
      });

      expect(media.author).toBe('John Doe');
    });

    it('should handle media without author', async () => {
      const media = await mediaEngine.importMedia('/source/author-test.jpg');

      expect(media.author).toBeUndefined();
    });

    it('should include author in database insert', async () => {
      await mediaEngine.importMedia('/source/author-test.jpg', {
        author: 'Jane Smith',
      });

      // Check that the database insert was called with author
      expect(mockLocalDb.insert).toHaveBeenCalled();
      // The mock captures the inserted data in mockMedia
      const insertedMedia = Array.from(mockMedia.values()).pop();
      expect(insertedMedia?.author).toBe('Jane Smith');
    });
  });

  describe('Date-based folder structure', () => {
    beforeEach(() => {
      mockFiles.set('/source/dated-image.jpg', Buffer.from('image-data'));
    });

    it('should store media in YYYY/MM folder based on createdAt date', async () => {
      const fs = await import('fs/promises');
      
      const media = await mediaEngine.importMedia('/source/dated-image.jpg');

      const copyCall = vi.mocked(fs.copyFile).mock.calls[0];
      expect(copyCall).toBeDefined();

      const destPath = copyCall[1] as string;
      const year = media.createdAt.getFullYear();
      const month = (media.createdAt.getMonth() + 1).toString().padStart(2, '0');

      // Path should contain YYYY/MM structure (handle both / and \ separators)
      expect(destPath).toMatch(new RegExp(`[/\\\\]${year}[/\\\\]${month}[/\\\\]`));
    });

    it('should create nested year/month directories on media import', async () => {
      const fs = await import('fs/promises');
      
      await mediaEngine.importMedia('/source/dated-image.jpg');

      // mkdir should be called with recursive: true
      expect(fs.mkdir).toHaveBeenCalled();
      const mkdirCalls = vi.mocked(fs.mkdir).mock.calls;
      
      // Should have created directory containing year/month structure
      const yearMonthDirCall = mkdirCalls.find((call) => {
        const dirPath = call[0] as string;
        return dirPath.match(/[/\\]\d{4}[/\\]\d{2}$/);
      });
      expect(yearMonthDirCall).toBeDefined();
    });

    it('should return correct path via getMediaPath method', async () => {
      const now = new Date();
      const year = now.getFullYear();
      const month = (now.getMonth() + 1).toString().padStart(2, '0');

      const mediaPath = mediaEngine.getMediaPathForDate('test-uuid', 'jpg', now);
      
      // Handle both Windows (\) and Unix (/) path separators
      expect(mediaPath).toMatch(new RegExp(`[/\\\\]${year}[/\\\\]${month}[/\\\\]`));
      expect(mediaPath).toContain('test-uuid.jpg');
    });

    it('should handle media from previous years correctly', async () => {
      const oldDate = new Date('2021-06-20');
      const mediaPath = mediaEngine.getMediaPathForDate('old-id', 'png', oldDate);

      expect(mediaPath).toMatch(/[/\\]2021[/\\]06[/\\]/);
      expect(mediaPath).toContain('old-id.png');
    });

    it('should use zero-padded month numbers (01-12)', async () => {
      const january = new Date('2024-01-15');
      const december = new Date('2024-12-15');
      
      const januaryPath = mediaEngine.getMediaPathForDate('jan-id', 'jpg', january);
      const decemberPath = mediaEngine.getMediaPathForDate('dec-id', 'jpg', december);

      expect(januaryPath).toMatch(/[/\\]2024[/\\]01[/\\]/);
      expect(decemberPath).toMatch(/[/\\]2024[/\\]12[/\\]/);
    });
  });

  describe('rebuildDatabaseFromFiles', () => {
    beforeEach(() => {
      mediaEngine.setProjectContext('test-project');
    });

    it('should delete post-media links for the project during rebuild', async () => {
      const fs = await import('fs/promises');

      // Mock readdir to return media with sidecar
      vi.mocked(fs.readdir).mockImplementation(async (dir: string, options?: any) => {
        if (typeof dir === 'string' && dir.includes('media')) {
          return [
            { name: 'media-1.jpg', isFile: () => true, isDirectory: () => false },
            { name: 'media-1.jpg.meta', isFile: () => true, isDirectory: () => false },
          ] as any;
        }
        return [];
      });

      // Set up sidecar file with linkedPostIds
      const sidecarContent = `id: media-1
originalName: test-image.jpg
mimeType: image/jpeg
size: 1024
createdAt: 2024-01-15T10:00:00.000Z
updatedAt: 2024-01-15T10:00:00.000Z
linkedPostIds: ["post-1", "post-2"]`;
      mockFiles.set('/mock/userData/projects/test-project/media/media-1.jpg.meta', sidecarContent);
      mockFiles.set('/mock/userData/projects/test-project/media/media-1.jpg', Buffer.from('image-data'));

      await mediaEngine.rebuildDatabaseFromFiles();

      expect(postMediaDeleteCalled).toBe(true);
    });

    it('should insert post-media links based on linkedPostIds from sidecar files', async () => {
      const fs = await import('fs/promises');

      // Mock readdir to simulate directory traversal
      vi.mocked(fs.readdir).mockImplementation(async (dir: string, options?: any) => {
        if (typeof dir === 'string' && dir.includes('media')) {
          return [
            { name: 'media-1.jpg', isFile: () => true, isDirectory: () => false },
            { name: 'media-1.jpg.meta', isFile: () => true, isDirectory: () => false },
          ] as any;
        }
        return [];
      });

      // Set up sidecar file with linkedPostIds
      const sidecarContent = `id: media-1
originalName: test-image.jpg
mimeType: image/jpeg
size: 1024
createdAt: 2024-01-15T10:00:00.000Z
updatedAt: 2024-01-15T10:00:00.000Z
linkedPostIds: ["post-1", "post-2"]`;
      mockFiles.set('/mock/userData/projects/test-project/media/media-1.jpg.meta', sidecarContent);
      mockFiles.set('/mock/userData/projects/test-project/media/media-1.jpg', Buffer.from('image-data'));

      await mediaEngine.rebuildDatabaseFromFiles();

      // Should have inserted 2 post-media links
      expect(postMediaInserts).toHaveLength(2);
      expect(postMediaInserts[0].postId).toBe('post-1');
      expect(postMediaInserts[0].mediaId).toBe('media-1');
      expect(postMediaInserts[1].postId).toBe('post-2');
      expect(postMediaInserts[1].mediaId).toBe('media-1');
    });

    it('should handle media without linkedPostIds', async () => {
      const fs = await import('fs/promises');

      vi.mocked(fs.readdir).mockImplementation(async (dir: string, options?: any) => {
        if (typeof dir === 'string' && dir.includes('media')) {
          return [
            { name: 'media-1.jpg', isFile: () => true, isDirectory: () => false },
            { name: 'media-1.jpg.meta', isFile: () => true, isDirectory: () => false },
          ] as any;
        }
        return [];
      });

      // Sidecar without linkedPostIds
      const sidecarContent = `id: media-1
originalName: test-image.jpg
mimeType: image/jpeg
size: 1024
createdAt: 2024-01-15T10:00:00.000Z
updatedAt: 2024-01-15T10:00:00.000Z`;
      mockFiles.set('/mock/userData/projects/test-project/media/media-1.jpg.meta', sidecarContent);
      mockFiles.set('/mock/userData/projects/test-project/media/media-1.jpg', Buffer.from('image-data'));

      await mediaEngine.rebuildDatabaseFromFiles();

      // Should not insert any post-media links
      expect(postMediaInserts).toHaveLength(0);
    });

    it('should set correct sortOrder for post-media links', async () => {
      const fs = await import('fs/promises');

      vi.mocked(fs.readdir).mockImplementation(async (dir: string, options?: any) => {
        if (typeof dir === 'string' && dir.includes('media')) {
          return [
            { name: 'media-1.jpg', isFile: () => true, isDirectory: () => false },
            { name: 'media-1.jpg.meta', isFile: () => true, isDirectory: () => false },
          ] as any;
        }
        return [];
      });

      // Sidecar with multiple linked posts
      const sidecarContent = `id: media-1
originalName: test-image.jpg
mimeType: image/jpeg
size: 1024
createdAt: 2024-01-15T10:00:00.000Z
updatedAt: 2024-01-15T10:00:00.000Z
linkedPostIds: ["post-a", "post-b", "post-c"]`;
      mockFiles.set('/mock/userData/projects/test-project/media/media-1.jpg.meta', sidecarContent);
      mockFiles.set('/mock/userData/projects/test-project/media/media-1.jpg', Buffer.from('image-data'));

      await mediaEngine.rebuildDatabaseFromFiles();

      // Verify sortOrder is set correctly (0, 1, 2)
      expect(postMediaInserts).toHaveLength(3);
      expect(postMediaInserts[0].sortOrder).toBe(0);
      expect(postMediaInserts[1].sortOrder).toBe(1);
      expect(postMediaInserts[2].sortOrder).toBe(2);
    });

    it('should restore title from sidecar metadata during rebuild', async () => {
      const fs = await import('fs/promises');

      vi.mocked(fs.readdir).mockImplementation(async (dir: string, options?: any) => {
        if (typeof dir === 'string' && dir.includes('media')) {
          return [
            { name: 'media-1.jpg', isFile: () => true, isDirectory: () => false },
            { name: 'media-1.jpg.meta', isFile: () => true, isDirectory: () => false },
          ] as any;
        }
        return [];
      });

      // Sidecar with title field
      const sidecarContent = `id: media-1
originalName: test-image.jpg
mimeType: image/jpeg
size: 1024
title: My Beautiful Sunset Photo
alt: A sunset over the ocean
caption: Taken during vacation
createdAt: 2024-01-15T10:00:00.000Z
updatedAt: 2024-01-15T10:00:00.000Z
tags: ["nature", "sunset"]`;
      mockFiles.set('/mock/userData/projects/test-project/media/media-1.jpg.meta', sidecarContent);
      mockFiles.set('/mock/userData/projects/test-project/media/media-1.jpg', Buffer.from('image-data'));

      await mediaEngine.rebuildDatabaseFromFiles();

      // Verify title is stored in database
      const insertedMedia = mockMedia.get('media-1');
      expect(insertedMedia).toBeDefined();
      expect(insertedMedia.title).toBe('My Beautiful Sunset Photo');
      expect(insertedMedia.alt).toBe('A sunset over the ocean');
      expect(insertedMedia.caption).toBe('Taken during vacation');
    });
  });

  describe('Full-Text Search', () => {
    it('should search media using FTS with stemmed query', async () => {
      // Search for media
      await mediaEngine.searchMedia('beautiful sunset');

      // Should have called the FTS search
      const ftsSearchCall = ftsExecuteCalls.find(c => c.sql.includes('media_fts MATCH'));
      expect(ftsSearchCall).toBeDefined();
      expect(ftsSearchCall?.args?.[0]).toBe('default'); // project_id
      // The query should be stemmed (e.g., 'beautiful sunset' -> 'beauti sunset')
      expect(ftsSearchCall?.args?.[1]).toBeDefined();
    });

    it('should filter search by project_id', async () => {
      mediaEngine.setProjectContext('my-project');
      await mediaEngine.searchMedia('test');

      const ftsSearchCall = ftsExecuteCalls.find(c => c.sql.includes('media_fts MATCH'));
      expect(ftsSearchCall?.args?.[0]).toBe('my-project');
    });

    it('should return empty array when no results found', async () => {
      const results = await mediaEngine.searchMedia('nonexistent');
      expect(results).toEqual([]);
    });
  });

  describe('getMedia', () => {
    it('should return null for non-existent media', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue(null),
        });
        return chain;
      });

      const result = await mediaEngine.getMedia('non-existent-id');
      expect(result).toBeNull();
    });

    it('should return media by ID', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: 'media-id',
            projectId: 'default',
            originalName: 'test.jpg',
            mimeType: 'image/jpeg',
            size: 1024,
            filePath: '/mock/media/test.jpg',
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        });
        return chain;
      });

      const result = await mediaEngine.getMedia('media-id');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('media-id');
      expect(result?.originalName).toBe('test.jpg');
    });
  });

  describe('updateMedia', () => {
    it('should return null for non-existent media', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue(null),
        });
        return chain;
      });

      const result = await mediaEngine.updateMedia('non-existent-id', { title: 'New title' });
      expect(result).toBeNull();
    });

    it('should update media title', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: 'media-id',
            projectId: 'default',
            originalName: 'test.jpg',
            mimeType: 'image/jpeg',
            size: 1024,
            filePath: '/mock/media/test.jpg',
            title: 'Old title',
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        });
        return chain;
      });

      const result = await mediaEngine.updateMedia('media-id', { title: 'New title' });

      expect(result).not.toBeNull();
      expect(result?.title).toBe('New title');
    });

    it('should update media caption', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: 'media-id',
            projectId: 'default',
            originalName: 'test.jpg',
            mimeType: 'image/jpeg',
            size: 1024,
            filePath: '/mock/media/test.jpg',
            caption: 'Old caption',
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        });
        return chain;
      });

      const result = await mediaEngine.updateMedia('media-id', { caption: 'New caption' });

      expect(result).not.toBeNull();
      expect(result?.caption).toBe('New caption');
    });

    it('should update media alt text', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: 'media-id',
            projectId: 'default',
            originalName: 'test.jpg',
            mimeType: 'image/jpeg',
            size: 1024,
            filePath: '/mock/media/test.jpg',
            alt: '',
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        });
        return chain;
      });

      const result = await mediaEngine.updateMedia('media-id', { alt: 'Descriptive alt text' });

      expect(result).not.toBeNull();
      expect(result?.alt).toBe('Descriptive alt text');
    });

    it('should emit mediaUpdated event', async () => {
      const handler = vi.fn();
      mediaEngine.on('mediaUpdated', handler);

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: 'event-media-id',
            projectId: 'default',
            originalName: 'test.jpg',
            mimeType: 'image/jpeg',
            size: 1024,
            filePath: '/mock/media/test.jpg',
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        });
        return chain;
      });

      await mediaEngine.updateMedia('event-media-id', { caption: 'Updated' });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'event-media-id' })
      );
    });

    it('should update sidecar file', async () => {
      const fs = await import('fs/promises');
      const filePath = '/mock/media/test.jpg';

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: 'sidecar-media-id',
            projectId: 'default',
            originalName: 'test.jpg',
            mimeType: 'image/jpeg',
            size: 1024,
            filePath,
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        });
        return chain;
      });

      vi.mocked(fs.writeFile).mockClear();
      await mediaEngine.updateMedia('sidecar-media-id', { caption: 'Test' });

      // Should write to sidecar file (with optional encoding parameter)
      expect(fs.writeFile).toHaveBeenCalledWith(
        `${filePath}.meta`,
        expect.any(String),
        expect.anything()
      );
    });

    it('should update FTS index', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: 'fts-media-id',
            projectId: 'default',
            originalName: 'test.jpg',
            mimeType: 'image/jpeg',
            size: 1024,
            filePath: '/mock/media/test.jpg',
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        });
        return chain;
      });

      ftsExecuteCalls = [];
      await mediaEngine.updateMedia('fts-media-id', { caption: 'Searchable caption' });

      const ftsUpdate = ftsExecuteCalls.find(c => c.sql.includes('media_fts'));
      expect(ftsUpdate).toBeDefined();
    });
  });

  describe('deleteMedia', () => {
    it('should return false for non-existent media', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue(null),
        });
        return chain;
      });

      const result = await mediaEngine.deleteMedia('non-existent-id');
      expect(result).toBe(false);
    });

    it('should delete media file from filesystem', async () => {
      const fs = await import('fs/promises');
      const filePath = '/mock/media/delete-me.jpg';

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: 'delete-media-id',
            filePath,
          }),
        });
        return chain;
      });

      vi.mocked(fs.unlink).mockClear();
      await mediaEngine.deleteMedia('delete-media-id');

      expect(fs.unlink).toHaveBeenCalledWith(filePath);
    });

    it('should delete sidecar file', async () => {
      const fs = await import('fs/promises');
      const filePath = '/mock/media/delete-me.jpg';
      const sidecarPath = `${filePath}.meta`;

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: 'delete-media-id',
            filePath,
            sidecarPath,
          }),
        });
        return chain;
      });

      vi.mocked(fs.unlink).mockClear();
      await mediaEngine.deleteMedia('delete-media-id');

      expect(fs.unlink).toHaveBeenCalledWith(sidecarPath);
    });

    it('should delete from database', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: 'db-delete-id',
            filePath: '/mock/media/test.jpg',
          }),
        });
        return chain;
      });

      await mediaEngine.deleteMedia('db-delete-id');

      expect(mockLocalDb.delete).toHaveBeenCalled();
    });

    it('should emit mediaDeleted event', async () => {
      const handler = vi.fn();
      mediaEngine.on('mediaDeleted', handler);

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: 'event-delete-id',
            filePath: '/mock/media/test.jpg',
          }),
        });
        return chain;
      });

      await mediaEngine.deleteMedia('event-delete-id');

      expect(handler).toHaveBeenCalledWith('event-delete-id');
    });

    it('should delete from FTS index', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: 'fts-delete-id',
            filePath: '/mock/media/test.jpg',
          }),
        });
        return chain;
      });

      ftsExecuteCalls = [];
      await mediaEngine.deleteMedia('fts-delete-id');

      const ftsDelete = ftsExecuteCalls.find(c => c.sql.includes('DELETE FROM media_fts'));
      expect(ftsDelete).toBeDefined();
    });

    it('should handle file deletion error gracefully', async () => {
      const fs = await import('fs/promises');

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: 'error-delete-id',
            filePath: '/mock/media/missing-file.jpg',
          }),
        });
        return chain;
      });

      vi.mocked(fs.unlink).mockRejectedValueOnce(new Error('ENOENT'));

      // Should not throw
      const result = await mediaEngine.deleteMedia('error-delete-id');
      expect(result).toBe(true);
    });

    it('should return true on successful deletion', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: 'success-delete-id',
            filePath: '/mock/media/test.jpg',
          }),
        });
        return chain;
      });

      const result = await mediaEngine.deleteMedia('success-delete-id');
      expect(result).toBe(true);
    });
  });

  describe('getAllMedia', () => {
    it('should return empty array when no media exists', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          orderBy: vi.fn().mockReturnThis(),
          all: vi.fn().mockResolvedValue([]),
        });
        return chain;
      });

      const result = await mediaEngine.getAllMedia();
      expect(result).toEqual([]);
    });

    it('should return all media for current project', async () => {
      mediaEngine.setProjectContext('media-project');

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          orderBy: vi.fn().mockReturnThis(),
          all: vi.fn().mockResolvedValue([
            { id: 'm1', originalName: 'image1.jpg', projectId: 'media-project' },
            { id: 'm2', originalName: 'image2.png', projectId: 'media-project' },
          ]),
        });
        return chain;
      });

      const result = await mediaEngine.getAllMedia();
      expect(result).toHaveLength(2);
    });
  });

  describe('getMediaFiltered', () => {
    it('should filter by MIME type', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.from = vi.fn().mockReturnValue({
          ...chain,
          where: vi.fn().mockReturnValue({
            ...chain,
            orderBy: vi.fn().mockReturnValue({
              ...chain,
              all: vi.fn().mockResolvedValue([
                { id: 'm1', mimeType: 'image/jpeg', tags: '[]' },
              ]),
            }),
          }),
        });
        return chain;
      });

      const result = await mediaEngine.getMediaFiltered({ mimeType: 'image/jpeg' });
      expect(result).toHaveLength(1);
    });

    it('should filter by date range', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.from = vi.fn().mockReturnValue({
          ...chain,
          where: vi.fn().mockReturnValue({
            ...chain,
            orderBy: vi.fn().mockReturnValue({
              ...chain,
              all: vi.fn().mockResolvedValue([
                { id: 'm1', mimeType: 'image/jpeg', createdAt: new Date('2024-01-15'), tags: '[]' },
              ]),
            }),
          }),
        });
        return chain;
      });

      const result = await mediaEngine.getMediaFiltered({ 
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31')
      });
      expect(result).toHaveLength(1);
    });

    it('should filter by year and month', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.from = vi.fn().mockReturnValue({
          ...chain,
          where: vi.fn().mockReturnValue({
            ...chain,
            orderBy: vi.fn().mockReturnValue({
              ...chain,
              all: vi.fn().mockResolvedValue([
                { id: 'm1', mimeType: 'image/jpeg', createdAt: new Date('2024-06-15'), tags: '[]' },
              ]),
            }),
          }),
        });
        return chain;
      });

      const result = await mediaEngine.getMediaFiltered({ year: 2024, month: 5 }); // June (0-indexed)
      expect(result).toHaveLength(1);
    });

    it('should filter by tags on client side', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.from = vi.fn().mockReturnValue({
          ...chain,
          where: vi.fn().mockReturnValue({
            ...chain,
            orderBy: vi.fn().mockReturnValue({
              ...chain,
              all: vi.fn().mockResolvedValue([
                { id: 'm1', mimeType: 'image/jpeg', tags: '["nature", "landscape"]' },
                { id: 'm2', mimeType: 'image/jpeg', tags: '["portrait"]' },
              ]),
            }),
          }),
        });
        return chain;
      });

      const result = await mediaEngine.getMediaFiltered({ tags: ['nature'] });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('m1');
    });
  });

  describe('getMediaByYearMonth', () => {
    it('should return empty array when no media exists', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.from = vi.fn().mockReturnValue({
          ...chain,
          where: vi.fn().mockReturnValue({
            ...chain,
            orderBy: vi.fn().mockReturnValue({
              ...chain,
              all: vi.fn().mockResolvedValue([]),
            }),
          }),
        });
        return chain;
      });

      const result = await mediaEngine.getMediaByYearMonth();
      expect(result).toEqual([]);
    });

    it('should group media by year and month', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.from = vi.fn().mockReturnValue({
          ...chain,
          where: vi.fn().mockReturnValue({
            ...chain,
            orderBy: vi.fn().mockReturnValue({
              ...chain,
              all: vi.fn().mockResolvedValue([
                { createdAt: new Date('2024-01-15'), tags: '[]' },
                { createdAt: new Date('2024-01-20'), tags: '[]' },
                { createdAt: new Date('2024-02-10'), tags: '[]' },
              ]),
            }),
          }),
        });
        return chain;
      });

      const result = await mediaEngine.getMediaByYearMonth();

      // Note: month is 0-indexed from Date.getMonth()
      expect(result).toContainEqual({ year: 2024, month: 0, count: 2 }); // January
      expect(result).toContainEqual({ year: 2024, month: 1, count: 1 }); // February
    });

    it('should sort by year and month descending', async () => {
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.from = vi.fn().mockReturnValue({
          ...chain,
          where: vi.fn().mockReturnValue({
            ...chain,
            orderBy: vi.fn().mockReturnValue({
              ...chain,
              all: vi.fn().mockResolvedValue([
                { createdAt: new Date('2023-06-01'), tags: '[]' },
                { createdAt: new Date('2024-03-01'), tags: '[]' },
              ]),
            }),
          }),
        });
        return chain;
      });

      const result = await mediaEngine.getMediaByYearMonth();

      expect(result[0].year).toBe(2024);
      expect(result[0].month).toBe(2); // March is month 2 (0-indexed)
    });
  });

  describe('generateThumbnails', () => {
    it('should skip non-image media', async () => {
      const fs = await import('fs/promises');
      
      // Spy on console.error to suppress expected error output
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue({
            id: 'pdf-id',
            mimeType: 'application/pdf',
            filePath: '/mock/media/document.pdf',
          }),
        });
        return chain;
      });

      vi.mocked(fs.writeFile).mockClear();
      await mediaEngine.generateThumbnails('pdf-id');

      // Should not write any thumbnail files for non-images
      const thumbnailWrites = vi.mocked(fs.writeFile).mock.calls.filter(
        call => String(call[0]).includes('thumbnail')
      );
      expect(thumbnailWrites).toHaveLength(0);
      
      // Verify error was logged (graceful degradation behavior)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to generate thumbnails:',
        expect.any(Error)
      );
      
      consoleErrorSpy.mockRestore();
    });
  });

  describe('getThumbnailPaths', () => {
    it('should return object with all size keys', async () => {
      // getThumbnailPaths checks fs.access for each thumbnail
      // By default our mock throws ENOENT, so all paths will be null
      const paths = await mediaEngine.getThumbnailPaths('test-media-id');

      expect(paths).toHaveProperty('small');
      expect(paths).toHaveProperty('medium');
      expect(paths).toHaveProperty('large');
    });

    it('should return null for non-existent thumbnails', async () => {
      const paths = await mediaEngine.getThumbnailPaths('non-existent-media-id');

      expect(paths.small).toBeNull();
      expect(paths.medium).toBeNull();
      expect(paths.large).toBeNull();
    });

    it('should return paths when thumbnails exist', async () => {
      const fs = await import('fs/promises');
      const mediaId = 'existing-media-id';

      // Mock fs.access to succeed for small thumbnail
      vi.mocked(fs.access).mockImplementation(async (path: any) => {
        if (path.includes(`${mediaId}-small.webp`)) {
          return undefined; // File exists
        }
        throw new Error('ENOENT');
      });

      const paths = await mediaEngine.getThumbnailPaths(mediaId);

      expect(paths.small).not.toBeNull();
      expect(paths.small).toContain(`${mediaId}-small.webp`);
      expect(paths.medium).toBeNull();
      expect(paths.large).toBeNull();
    });
  });

  describe('replaceMediaFile', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    
    beforeEach(() => {
      // Spy on console.error to suppress expected error output (sharp can't read mock files)
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    
    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    it('should return null for non-existent media', async () => {
      // Mock database to return nothing
      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue(undefined),
        });
        return chain;
      });

      const result = await mediaEngine.replaceMediaFile('non-existent-id', '/source/new-image.jpg');
      expect(result).toBeNull();
    });

    it('should replace file and update database when checksum differs', async () => {
      const fs = await import('fs/promises');

      // Spy on console.error to suppress expected error output (sharp can't read mock file)
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Setup new source file with different content
      const newImageBuffer = Buffer.from('new-image-data-different');
      mockFiles.set('/source/new-image.jpg', newImageBuffer);

      // Setup existing media in database with different checksum
      const existingMedia = {
        id: 'media-id-123',
        projectId: 'default',
        filename: 'media-id-123.jpg',
        originalName: 'original.jpg',
        mimeType: 'image/jpeg',
        size: 100,
        width: 800,
        height: 600,
        filePath: '/mock/media/2025/01/media-id-123.jpg',
        sidecarPath: '/mock/media/2025/01/media-id-123.jpg.meta',
        createdAt: new Date('2025-01-15'),
        updatedAt: new Date('2025-01-15'),
        checksum: 'old-checksum',
        tags: '[]',
      };

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue(existingMedia),
        });
        return chain;
      });

      // Clear any previous mock calls
      vi.mocked(fs.copyFile).mockClear();

      const result = await mediaEngine.replaceMediaFile('media-id-123', '/source/new-image.jpg');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('media-id-123');
      // File should be copied to the existing location
      expect(fs.copyFile).toHaveBeenCalledWith('/source/new-image.jpg', existingMedia.filePath);
      
      // Verify error was logged (graceful degradation for image dimensions)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to get image dimensions:',
        expect.any(Error)
      );
      
      consoleErrorSpy.mockRestore();
    });

    it('should not replace file when checksum is the same', async () => {
      const fs = await import('fs/promises');
      const crypto = await import('crypto');

      // Create content that we know the checksum of
      const imageBuffer = Buffer.from('same-content');
      const checksum = crypto.createHash('md5').update(imageBuffer).digest('hex');
      mockFiles.set('/source/same-image.jpg', imageBuffer);

      // Setup existing media with same checksum
      const existingMedia = {
        id: 'media-id-456',
        projectId: 'default',
        filename: 'media-id-456.jpg',
        originalName: 'original.jpg',
        mimeType: 'image/jpeg',
        size: imageBuffer.length,
        width: 800,
        height: 600,
        filePath: '/mock/media/2025/01/media-id-456.jpg',
        sidecarPath: '/mock/media/2025/01/media-id-456.jpg.meta',
        createdAt: new Date('2025-01-15'),
        updatedAt: new Date('2025-01-15'),
        checksum: checksum, // Same checksum as the source file
        tags: '[]',
      };

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue(existingMedia),
        });
        return chain;
      });

      vi.mocked(fs.copyFile).mockClear();

      const result = await mediaEngine.replaceMediaFile('media-id-456', '/source/same-image.jpg');

      // Should return null because file hasn't changed
      expect(result).toBeNull();
      // File should NOT be copied
      expect(fs.copyFile).not.toHaveBeenCalled();
    });

    it('should emit mediaFileReplaced event when file is replaced', async () => {
      const fs = await import('fs/promises');

      const newImageBuffer = Buffer.from('event-test-data');
      mockFiles.set('/source/event-test.jpg', newImageBuffer);

      const existingMedia = {
        id: 'media-event-id',
        projectId: 'default',
        filename: 'media-event-id.jpg',
        originalName: 'original.jpg',
        mimeType: 'image/jpeg',
        size: 100,
        width: 800,
        height: 600,
        filePath: '/mock/media/2025/01/media-event-id.jpg',
        sidecarPath: '/mock/media/2025/01/media-event-id.jpg.meta',
        createdAt: new Date('2025-01-15'),
        updatedAt: new Date('2025-01-15'),
        checksum: 'different-checksum',
        tags: '[]',
      };

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue(existingMedia),
        });
        return chain;
      });

      const eventHandler = vi.fn();
      mediaEngine.on('mediaFileReplaced', eventHandler);

      await mediaEngine.replaceMediaFile('media-event-id', '/source/event-test.jpg');

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'media-event-id' })
      );
    });

    it('should call generateThumbnails for image files when checksum differs', async () => {
      const newImageBuffer = Buffer.from('thumbnail-test-data');
      mockFiles.set('/source/thumb-test.jpg', newImageBuffer);

      const existingMedia = {
        id: 'media-thumb-id',
        projectId: 'default',
        filename: 'media-thumb-id.jpg',
        originalName: 'original.jpg',
        mimeType: 'image/jpeg',
        size: 100,
        width: 800,
        height: 600,
        filePath: '/mock/media/2025/01/media-thumb-id.jpg',
        sidecarPath: '/mock/media/2025/01/media-thumb-id.jpg.meta',
        createdAt: new Date('2025-01-15'),
        updatedAt: new Date('2025-01-15'),
        checksum: 'old-checksum-different',
        tags: '[]',
      };

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue(existingMedia),
        });
        return chain;
      });

      // Spy on generateThumbnails
      const generateThumbnailsSpy = vi.spyOn(mediaEngine, 'generateThumbnails').mockResolvedValue({
        small: '/mock/thumbnails/media-thumb-id-small.webp',
        medium: '/mock/thumbnails/media-thumb-id-medium.webp',
        large: '/mock/thumbnails/media-thumb-id-large.webp',
      });

      await mediaEngine.replaceMediaFile('media-thumb-id', '/source/thumb-test.jpg');

      expect(generateThumbnailsSpy).toHaveBeenCalledWith('media-thumb-id', existingMedia.filePath);

      generateThumbnailsSpy.mockRestore();
    });

    it('should not generate thumbnails for non-image files', async () => {
      const pdfBuffer = Buffer.from('pdf-content');
      mockFiles.set('/source/document.pdf', pdfBuffer);

      const existingMedia = {
        id: 'media-pdf-id',
        projectId: 'default',
        filename: 'media-pdf-id.pdf',
        originalName: 'document.pdf',
        mimeType: 'application/pdf',
        size: 100,
        filePath: '/mock/media/2025/01/media-pdf-id.pdf',
        sidecarPath: '/mock/media/2025/01/media-pdf-id.pdf.meta',
        createdAt: new Date('2025-01-15'),
        updatedAt: new Date('2025-01-15'),
        checksum: 'old-pdf-checksum',
        tags: '[]',
      };

      vi.mocked(mockLocalDb.select).mockImplementation(() => {
        const chain = createSelectChain();
        chain.where = vi.fn().mockReturnValue({
          ...chain,
          get: vi.fn().mockResolvedValue(existingMedia),
        });
        return chain;
      });

      const generateThumbnailsSpy = vi.spyOn(mediaEngine, 'generateThumbnails');

      await mediaEngine.replaceMediaFile('media-pdf-id', '/source/document.pdf');

      expect(generateThumbnailsSpy).not.toHaveBeenCalled();

      generateThumbnailsSpy.mockRestore();
    });
  });
});
