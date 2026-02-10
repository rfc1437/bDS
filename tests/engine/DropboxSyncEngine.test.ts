/**
 * DropboxSyncEngine Unit Tests
 *
 * Tests the REAL DropboxSyncEngine class with mocked dependencies.
 * Following TDD best practices: mock external dependencies (Dropbox SDK, filesystem),
 * test real implementation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DropboxSyncEngine,
  DropboxSyncConfig,
  DropboxSyncStatus,
  DropboxConflict,
  FileSyncResult,
} from '../../src/main/engine/DropboxSyncEngine';
import { resetMockCounters, createMockDropboxClient, createMockDropboxConfig } from '../utils/factories';

// ============================================
// Mock Dependencies
// ============================================

// Mock fs/promises - vi.mock is hoisted, so we use vi.hoisted() for shared state
const { mockFs, mockWatcher, mockChokidarWatch } = vi.hoisted(() => {
  const mockFs = {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    unlink: vi.fn(),
    readdir: vi.fn(),
    stat: vi.fn(),
    access: vi.fn(),
  };
  const mockWatcher = {
    on: vi.fn().mockReturnThis(),
    close: vi.fn().mockResolvedValue(undefined),
    add: vi.fn(),
    unwatch: vi.fn(),
  };
  const mockChokidarWatch = vi.fn(() => mockWatcher);
  return { mockFs, mockWatcher, mockChokidarWatch };
});

vi.mock('fs/promises', () => mockFs);

// Mock path (use posix-style for consistent tests)
vi.mock('path', async () => {
  const actual = await vi.importActual<typeof import('path')>('path');
  return {
    ...actual,
    default: actual,
  };
});

// Mock electron
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/userData'),
  },
}));

// Mock chokidar
vi.mock('chokidar', () => ({
  watch: mockChokidarWatch,
  default: { watch: mockChokidarWatch },
}));

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-dropbox-uuid-' + Math.random().toString(36).substr(2, 9)),
}));

// Mock the database module
vi.mock('../../src/main/database', () => ({
  getDatabase: vi.fn(() => ({
    getLocal: vi.fn(() => ({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            get: vi.fn(() => Promise.resolve(undefined)),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoUpdate: vi.fn(() => Promise.resolve()),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve()),
        })),
      })),
    })),
    getDataPaths: vi.fn(() => ({
      database: '/mock/userData/bds.db',
      posts: '/mock/userData/projects/default/posts',
      media: '/mock/userData/projects/default/media',
    })),
  })),
}));

describe('DropboxSyncEngine', () => {
  let engine: DropboxSyncEngine;
  let mockDropboxClient: ReturnType<typeof createMockDropboxClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockCounters();

    // Re-set mock implementations after clearAllMocks
    mockChokidarWatch.mockReturnValue(mockWatcher);
    mockWatcher.on.mockReturnThis();
    mockWatcher.close.mockResolvedValue(undefined);

    mockDropboxClient = createMockDropboxClient();
    engine = new DropboxSyncEngine(mockDropboxClient as any, mockChokidarWatch as any);

    // Default mock implementations
    mockFs.readFile.mockResolvedValue(Buffer.from('test content'));
    mockFs.writeFile.mockResolvedValue(undefined);
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.unlink.mockResolvedValue(undefined);
    mockFs.readdir.mockResolvedValue([]);
    mockFs.stat.mockResolvedValue({
      isFile: () => true,
      isDirectory: () => false,
      size: 100,
      mtime: new Date('2026-01-15T10:00:00Z'),
    });
    mockFs.access.mockResolvedValue(undefined);
  });

  afterEach(() => {
    engine.stopWatching();
    engine.stopPolling();
  });

  // ============================================
  // Constructor and Initialization
  // ============================================

  describe('Constructor and Initialization', () => {
    it('should create a DropboxSyncEngine instance', () => {
      expect(engine).toBeInstanceOf(DropboxSyncEngine);
    });

    it('should extend EventEmitter', () => {
      expect(typeof engine.on).toBe('function');
      expect(typeof engine.emit).toBe('function');
    });

    it('should start with idle status', () => {
      expect(engine.getStatus()).toBe('idle');
    });

    it('should start as not configured', () => {
      expect(engine.isConfigured()).toBe(false);
    });

    it('should accept a custom Dropbox client', () => {
      const customClient = createMockDropboxClient();
      const customEngine = new DropboxSyncEngine(customClient as any);
      expect(customEngine).toBeInstanceOf(DropboxSyncEngine);
    });
  });

  // ============================================
  // Configuration
  // ============================================

  describe('Configuration', () => {
    it('should configure with valid settings', async () => {
      const config = createMockDropboxConfig();
      await engine.configure(config);

      expect(engine.isConfigured()).toBe(true);
    });

    it('should emit configured event on successful configuration', async () => {
      const handler = vi.fn();
      engine.on('configured', handler);

      const config = createMockDropboxConfig();
      await engine.configure(config);

      expect(handler).toHaveBeenCalledWith(config);
    });

    it('should reject invalid configuration without access token', async () => {
      const config = createMockDropboxConfig({ accessToken: '' });
      await engine.configure(config);

      expect(engine.isConfigured()).toBe(false);
    });

    it('should update configuration when called multiple times', async () => {
      const config1 = createMockDropboxConfig({ accessToken: 'token-1' });
      const config2 = createMockDropboxConfig({ accessToken: 'token-2' });

      await engine.configure(config1);
      expect(engine.isConfigured()).toBe(true);

      await engine.configure(config2);
      expect(engine.isConfigured()).toBe(true);
    });

    it('should store remote base path from config', async () => {
      const config = createMockDropboxConfig({ remoteBasePath: '/my-blog' });
      await engine.configure(config);

      expect(engine.getRemoteBasePath()).toBe('/my-blog');
    });

    it('should default remote base path to empty string for app folder', async () => {
      const config = createMockDropboxConfig({ remoteBasePath: undefined });
      await engine.configure(config);

      expect(engine.getRemoteBasePath()).toBe('');
    });
  });

  // ============================================
  // Path Mapping
  // ============================================

  describe('Path Mapping', () => {
    beforeEach(async () => {
      await engine.configure(createMockDropboxConfig({
        localPostsDir: '/mock/userData/projects/default/posts',
        localMediaDir: '/mock/userData/projects/default/media',
        remoteBasePath: '/bds',
      }));
    });

    it('should map local post path to remote path', () => {
      const localPath = '/mock/userData/projects/default/posts/2026/01/hello-world.md';
      const remotePath = engine.localToRemotePath(localPath);
      expect(remotePath).toBe('/bds/posts/2026/01/hello-world.md');
    });

    it('should map local media path to remote path', () => {
      const localPath = '/mock/userData/projects/default/media/2026/01/image.jpg';
      const remotePath = engine.localToRemotePath(localPath);
      expect(remotePath).toBe('/bds/media/2026/01/image.jpg');
    });

    it('should map remote post path to local path', () => {
      const remotePath = '/bds/posts/2026/01/hello-world.md';
      const localPath = engine.remoteToLocalPath(remotePath);
      expect(localPath).toBe('/mock/userData/projects/default/posts/2026/01/hello-world.md');
    });

    it('should map remote media path to local path', () => {
      const remotePath = '/bds/media/2026/01/image.jpg';
      const localPath = engine.remoteToLocalPath(remotePath);
      expect(localPath).toBe('/mock/userData/projects/default/media/2026/01/image.jpg');
    });

    it('should return null for unmapped paths', () => {
      const localPath = '/some/other/path/file.txt';
      const remotePath = engine.localToRemotePath(localPath);
      expect(remotePath).toBeNull();
    });
  });

  // ============================================
  // File Upload
  // ============================================

  describe('File Upload', () => {
    beforeEach(async () => {
      await engine.configure(createMockDropboxConfig({
        localPostsDir: '/mock/userData/projects/default/posts',
        localMediaDir: '/mock/userData/projects/default/media',
        remoteBasePath: '/bds',
      }));
    });

    it('should upload a local file to Dropbox', async () => {
      const localPath = '/mock/userData/projects/default/posts/2026/01/hello-world.md';
      mockFs.readFile.mockResolvedValue(Buffer.from('# Hello World'));

      await engine.uploadFile(localPath);

      expect(mockDropboxClient.filesUpload).toHaveBeenCalledWith({
        path: '/bds/posts/2026/01/hello-world.md',
        contents: Buffer.from('# Hello World'),
        mode: { '.tag': 'overwrite' },
        autorename: false,
      });
    });

    it('should emit fileUploaded event on successful upload', async () => {
      const handler = vi.fn();
      engine.on('fileUploaded', handler);

      const localPath = '/mock/userData/projects/default/posts/2026/01/test.md';
      mockFs.readFile.mockResolvedValue(Buffer.from('content'));

      await engine.uploadFile(localPath);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          localPath,
          remotePath: '/bds/posts/2026/01/test.md',
        })
      );
    });

    it('should throw error when file does not exist', async () => {
      const localPath = '/mock/userData/projects/default/posts/missing.md';
      const error = new Error('ENOENT: no such file');
      (error as NodeJS.ErrnoException).code = 'ENOENT';
      mockFs.readFile.mockRejectedValue(error);

      await expect(engine.uploadFile(localPath)).rejects.toThrow('ENOENT');
    });

    it('should throw error for unmapped paths', async () => {
      await expect(engine.uploadFile('/random/path/file.txt'))
        .rejects.toThrow('Cannot map local path to remote path');
    });

    it('should return upload result with metadata', async () => {
      const localPath = '/mock/userData/projects/default/posts/2026/01/test.md';
      mockFs.readFile.mockResolvedValue(Buffer.from('content'));

      mockDropboxClient.filesUpload.mockResolvedValue({
        result: {
          name: 'test.md',
          path_lower: '/bds/posts/2026/01/test.md',
          content_hash: 'abc123hash',
          server_modified: '2026-01-15T10:00:00Z',
          size: 7,
        },
      });

      const result = await engine.uploadFile(localPath);

      expect(result).toEqual(
        expect.objectContaining({
          remotePath: '/bds/posts/2026/01/test.md',
          contentHash: 'abc123hash',
          size: 7,
        })
      );
    });
  });

  // ============================================
  // File Download
  // ============================================

  describe('File Download', () => {
    beforeEach(async () => {
      await engine.configure(createMockDropboxConfig({
        localPostsDir: '/mock/userData/projects/default/posts',
        localMediaDir: '/mock/userData/projects/default/media',
        remoteBasePath: '/bds',
      }));
    });

    it('should download a remote file to local path', async () => {
      const remotePath = '/bds/posts/2026/01/hello-world.md';
      const fileContent = Buffer.from('# Hello World');

      mockDropboxClient.filesDownload.mockResolvedValue({
        result: {
          name: 'hello-world.md',
          path_lower: remotePath,
          fileBinary: fileContent,
          content_hash: 'hash123',
          server_modified: '2026-01-15T10:00:00Z',
          size: fileContent.length,
        },
      });

      await engine.downloadFile(remotePath);

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        '/mock/userData/projects/default/posts/2026/01/hello-world.md',
        fileContent
      );
    });

    it('should create directories before writing downloaded file', async () => {
      const remotePath = '/bds/posts/2026/02/new-post.md';

      mockDropboxClient.filesDownload.mockResolvedValue({
        result: {
          name: 'new-post.md',
          path_lower: remotePath,
          fileBinary: Buffer.from('content'),
          content_hash: 'hash456',
          server_modified: '2026-02-01T10:00:00Z',
          size: 7,
        },
      });

      await engine.downloadFile(remotePath);

      expect(mockFs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('2026'),
        { recursive: true }
      );
    });

    it('should emit fileDownloaded event on successful download', async () => {
      const handler = vi.fn();
      engine.on('fileDownloaded', handler);

      const remotePath = '/bds/posts/2026/01/test.md';
      mockDropboxClient.filesDownload.mockResolvedValue({
        result: {
          name: 'test.md',
          path_lower: remotePath,
          fileBinary: Buffer.from('content'),
          content_hash: 'hash789',
          server_modified: '2026-01-15T10:00:00Z',
          size: 7,
        },
      });

      await engine.downloadFile(remotePath);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          remotePath,
          localPath: '/mock/userData/projects/default/posts/2026/01/test.md',
        })
      );
    });

    it('should throw error for unmapped remote paths', async () => {
      await expect(engine.downloadFile('/unknown/path/file.txt'))
        .rejects.toThrow('Cannot map remote path to local path');
    });
  });

  // ============================================
  // File Deletion
  // ============================================

  describe('File Deletion', () => {
    beforeEach(async () => {
      await engine.configure(createMockDropboxConfig({
        localPostsDir: '/mock/userData/projects/default/posts',
        localMediaDir: '/mock/userData/projects/default/media',
        remoteBasePath: '/bds',
      }));
    });

    it('should delete a remote file', async () => {
      const remotePath = '/bds/posts/2026/01/old-post.md';

      await engine.deleteRemoteFile(remotePath);

      expect(mockDropboxClient.filesDeleteV2).toHaveBeenCalledWith({
        path: remotePath,
      });
    });

    it('should emit fileDeleted event on successful deletion', async () => {
      const handler = vi.fn();
      engine.on('fileDeleted', handler);

      const remotePath = '/bds/posts/2026/01/old-post.md';
      await engine.deleteRemoteFile(remotePath);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ remotePath })
      );
    });

    it('should handle deletion of non-existent file gracefully', async () => {
      mockDropboxClient.filesDeleteV2.mockRejectedValue({
        error: { '.tag': 'path_lookup', path_lookup: { '.tag': 'not_found' } },
        status: 409,
      });

      // Should not throw - file already doesn't exist
      await expect(engine.deleteRemoteFile('/bds/posts/missing.md'))
        .resolves.not.toThrow();
    });
  });

  // ============================================
  // Delta Sync (Cursor-based)
  // ============================================

  describe('Delta Sync', () => {
    beforeEach(async () => {
      await engine.configure(createMockDropboxConfig({
        localPostsDir: '/mock/userData/projects/default/posts',
        localMediaDir: '/mock/userData/projects/default/media',
        remoteBasePath: '/bds',
      }));
    });

    it('should get initial cursor from Dropbox', async () => {
      mockDropboxClient.filesListFolderGetLatestCursor.mockResolvedValue({
        result: { cursor: 'initial-cursor-abc' },
      });

      const cursor = await engine.getLatestCursor();
      expect(cursor).toBe('initial-cursor-abc');

      expect(mockDropboxClient.filesListFolderGetLatestCursor).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '/bds',
          recursive: true,
        })
      );
    });

    it('should list changes since last cursor', async () => {
      mockDropboxClient.filesListFolderContinue.mockResolvedValue({
        result: {
          entries: [
            {
              '.tag': 'file',
              name: 'new-post.md',
              path_lower: '/bds/posts/2026/01/new-post.md',
              content_hash: 'newhash123',
              server_modified: '2026-01-20T12:00:00Z',
              size: 500,
            },
            {
              '.tag': 'deleted',
              name: 'old-post.md',
              path_lower: '/bds/posts/2025/12/old-post.md',
            },
          ],
          cursor: 'new-cursor-def',
          has_more: false,
        },
      });

      const changes = await engine.getRemoteChanges('previous-cursor');

      expect(changes.entries).toHaveLength(2);
      expect(changes.entries[0]).toEqual(
        expect.objectContaining({
          tag: 'file',
          pathLower: '/bds/posts/2026/01/new-post.md',
        })
      );
      expect(changes.entries[1]).toEqual(
        expect.objectContaining({
          tag: 'deleted',
          pathLower: '/bds/posts/2025/12/old-post.md',
        })
      );
      expect(changes.cursor).toBe('new-cursor-def');
      expect(changes.hasMore).toBe(false);
    });

    it('should handle paginated results', async () => {
      mockDropboxClient.filesListFolderContinue
        .mockResolvedValueOnce({
          result: {
            entries: [
              {
                '.tag': 'file',
                name: 'file1.md',
                path_lower: '/bds/posts/2026/01/file1.md',
                content_hash: 'hash1',
                server_modified: '2026-01-20T12:00:00Z',
                size: 100,
              },
            ],
            cursor: 'cursor-page2',
            has_more: true,
          },
        })
        .mockResolvedValueOnce({
          result: {
            entries: [
              {
                '.tag': 'file',
                name: 'file2.md',
                path_lower: '/bds/posts/2026/01/file2.md',
                content_hash: 'hash2',
                server_modified: '2026-01-20T12:00:00Z',
                size: 200,
              },
            ],
            cursor: 'cursor-final',
            has_more: false,
          },
        });

      const allChanges = await engine.getAllRemoteChanges('initial-cursor');

      expect(allChanges.entries).toHaveLength(2);
      expect(allChanges.cursor).toBe('cursor-final');
    });
  });

  // ============================================
  // Full Sync Operation
  // ============================================

  describe('Full Sync', () => {
    beforeEach(async () => {
      await engine.configure(createMockDropboxConfig({
        localPostsDir: '/mock/userData/projects/default/posts',
        localMediaDir: '/mock/userData/projects/default/media',
        remoteBasePath: '/bds',
      }));
    });

    it('should return error result when not configured', async () => {
      const unconfiguredEngine = new DropboxSyncEngine(mockDropboxClient as any);
      const result = await unconfiguredEngine.syncAll();

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Dropbox sync not configured');
    });

    it('should prevent concurrent sync operations', async () => {
      // Make the first sync take a while
      mockDropboxClient.filesListFolder.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({
          result: { entries: [], cursor: 'cursor', has_more: false },
        }), 100))
      );
      mockDropboxClient.filesListFolderGetLatestCursor.mockResolvedValue({
        result: { cursor: 'test-cursor' },
      });

      const sync1 = engine.syncAll();
      const sync2 = engine.syncAll();

      const result2 = await sync2;
      expect(result2.success).toBe(false);
      expect(result2.errors).toContain('Sync already in progress');

      await sync1;
    });

    it('should emit syncStarted and syncCompleted events', async () => {
      const startHandler = vi.fn();
      const completeHandler = vi.fn();
      engine.on('syncStarted', startHandler);
      engine.on('syncCompleted', completeHandler);

      // Mock empty remote state
      mockDropboxClient.filesListFolder.mockResolvedValue({
        result: { entries: [], cursor: 'cursor', has_more: false },
      });
      mockDropboxClient.filesListFolderGetLatestCursor.mockResolvedValue({
        result: { cursor: 'cursor' },
      });
      mockFs.readdir.mockResolvedValue([]);

      await engine.syncAll();

      expect(startHandler).toHaveBeenCalled();
      expect(completeHandler).toHaveBeenCalled();
    });

    it('should set status to syncing during operation', async () => {
      let statusDuringSync: DropboxSyncStatus | null = null;

      mockDropboxClient.filesListFolder.mockImplementation(async () => {
        statusDuringSync = engine.getStatus();
        return { result: { entries: [], cursor: 'cursor', has_more: false } };
      });
      mockDropboxClient.filesListFolderGetLatestCursor.mockResolvedValue({
        result: { cursor: 'cursor' },
      });
      mockFs.readdir.mockResolvedValue([]);

      await engine.syncAll();

      expect(statusDuringSync).toBe('syncing');
      expect(engine.getStatus()).toBe('idle');
    });

    it('should return sync result with counts', async () => {
      mockDropboxClient.filesListFolder.mockResolvedValue({
        result: { entries: [], cursor: 'cursor', has_more: false },
      });
      mockDropboxClient.filesListFolderGetLatestCursor.mockResolvedValue({
        result: { cursor: 'cursor' },
      });
      mockFs.readdir.mockResolvedValue([]);

      const result = await engine.syncAll();

      expect(result).toEqual(
        expect.objectContaining({
          success: true,
          uploaded: expect.any(Number),
          downloaded: expect.any(Number),
          deleted: expect.any(Number),
          conflicts: expect.any(Number),
          errors: expect.any(Array),
        })
      );
    });
  });

  // ============================================
  // Conflict Detection
  // ============================================

  describe('Conflict Detection', () => {
    beforeEach(async () => {
      await engine.configure(createMockDropboxConfig({
        localPostsDir: '/mock/userData/projects/default/posts',
        localMediaDir: '/mock/userData/projects/default/media',
        remoteBasePath: '/bds',
      }));
    });

    it('should detect conflict when both local and remote changed', async () => {
      const localPath = '/mock/userData/projects/default/posts/2026/01/conflicted.md';
      const remotePath = '/bds/posts/2026/01/conflicted.md';

      // Local file was modified
      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        isDirectory: () => false,
        size: 200,
        mtime: new Date('2026-01-20T15:00:00Z'),
      });
      mockFs.readFile.mockResolvedValue(Buffer.from('local content'));

      const conflict = engine.createConflict(localPath, remotePath, {
        localModified: new Date('2026-01-20T15:00:00Z'),
        remoteModified: new Date('2026-01-20T14:00:00Z'),
        localHash: 'localhash',
        remoteHash: 'remotehash',
      });

      expect(conflict).toEqual(
        expect.objectContaining({
          localPath,
          remotePath,
          localModified: expect.any(Date),
          remoteModified: expect.any(Date),
        })
      );
    });

    it('should resolve conflict with local-wins strategy', async () => {
      const conflict: DropboxConflict = {
        id: 'conflict-1',
        localPath: '/mock/userData/projects/default/posts/2026/01/test.md',
        remotePath: '/bds/posts/2026/01/test.md',
        localModified: new Date('2026-01-20T15:00:00Z'),
        remoteModified: new Date('2026-01-20T14:00:00Z'),
        localHash: 'localhash',
        remoteHash: 'remotehash',
      };

      mockFs.readFile.mockResolvedValue(Buffer.from('local content'));
      mockDropboxClient.filesUpload.mockResolvedValue({
        result: {
          name: 'test.md',
          path_lower: conflict.remotePath,
          content_hash: 'newhash',
          server_modified: '2026-01-20T15:30:00Z',
          size: 13,
        },
      });

      await engine.resolveConflict(conflict, 'local-wins');

      // Should upload local version to remote
      expect(mockDropboxClient.filesUpload).toHaveBeenCalled();
    });

    it('should resolve conflict with remote-wins strategy', async () => {
      const conflict: DropboxConflict = {
        id: 'conflict-1',
        localPath: '/mock/userData/projects/default/posts/2026/01/test.md',
        remotePath: '/bds/posts/2026/01/test.md',
        localModified: new Date('2026-01-20T14:00:00Z'),
        remoteModified: new Date('2026-01-20T15:00:00Z'),
        localHash: 'localhash',
        remoteHash: 'remotehash',
      };

      mockDropboxClient.filesDownload.mockResolvedValue({
        result: {
          name: 'test.md',
          path_lower: conflict.remotePath,
          fileBinary: Buffer.from('remote content'),
          content_hash: 'remotehash',
          server_modified: '2026-01-20T15:00:00Z',
          size: 14,
        },
      });

      await engine.resolveConflict(conflict, 'remote-wins');

      // Should download remote version to local
      expect(mockFs.writeFile).toHaveBeenCalled();
    });

    it('should emit conflictDetected event', () => {
      const handler = vi.fn();
      engine.on('conflictDetected', handler);

      const conflict = engine.createConflict(
        '/mock/userData/projects/default/posts/2026/01/test.md',
        '/bds/posts/2026/01/test.md',
        {
          localModified: new Date(),
          remoteModified: new Date(),
          localHash: 'a',
          remoteHash: 'b',
        }
      );

      expect(handler).toHaveBeenCalledWith(conflict);
    });

    it('should emit conflictResolved event after resolution', async () => {
      const handler = vi.fn();
      engine.on('conflictResolved', handler);

      const conflict: DropboxConflict = {
        id: 'conflict-1',
        localPath: '/mock/userData/projects/default/posts/2026/01/test.md',
        remotePath: '/bds/posts/2026/01/test.md',
        localModified: new Date(),
        remoteModified: new Date(),
        localHash: 'a',
        remoteHash: 'b',
      };

      mockFs.readFile.mockResolvedValue(Buffer.from('content'));
      mockDropboxClient.filesUpload.mockResolvedValue({
        result: { name: 'test.md', path_lower: '/bds/posts/2026/01/test.md', content_hash: 'new', server_modified: '2026-01-20T15:00:00Z', size: 7 },
      });

      await engine.resolveConflict(conflict, 'local-wins');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'conflict-1' }),
        'local-wins'
      );
    });
  });

  // ============================================
  // Local File Watching
  // ============================================

  describe('Local File Watching', () => {
    beforeEach(async () => {
      await engine.configure(createMockDropboxConfig({
        localPostsDir: '/mock/userData/projects/default/posts',
        localMediaDir: '/mock/userData/projects/default/media',
        remoteBasePath: '/bds',
      }));
    });

    it('should start watching local directories', () => {
      engine.startWatching();

      expect(mockChokidarWatch).toHaveBeenCalledWith(
        expect.arrayContaining([
          '/mock/userData/projects/default/posts',
          '/mock/userData/projects/default/media',
        ]),
        expect.objectContaining({
          ignoreInitial: true,
          persistent: true,
        })
      );
    });

    it('should set status to watching when watching starts', () => {
      engine.startWatching();
      expect(engine.getStatus()).toBe('watching');
    });

    it('should stop watching when requested', () => {
      engine.startWatching();
      engine.stopWatching();

      expect(mockWatcher.close).toHaveBeenCalled();
    });

    it('should set status to idle when watching stops', () => {
      engine.startWatching();
      engine.stopWatching();
      expect(engine.getStatus()).toBe('idle');
    });

    it('should emit watchStarted event', () => {
      const handler = vi.fn();
      engine.on('watchStarted', handler);

      engine.startWatching();

      expect(handler).toHaveBeenCalled();
    });

    it('should emit watchStopped event', () => {
      const handler = vi.fn();
      engine.on('watchStopped', handler);

      engine.startWatching();
      engine.stopWatching();

      expect(handler).toHaveBeenCalled();
    });

    it('should register add, change, and unlink handlers', () => {
      engine.startWatching();

      const onCalls = mockWatcher.on.mock.calls.map((call: any[]) => call[0]);
      expect(onCalls).toContain('add');
      expect(onCalls).toContain('change');
      expect(onCalls).toContain('unlink');
    });
  });

  // ============================================
  // Remote Polling
  // ============================================

  describe('Remote Polling', () => {
    beforeEach(async () => {
      await engine.configure(createMockDropboxConfig({
        localPostsDir: '/mock/userData/projects/default/posts',
        localMediaDir: '/mock/userData/projects/default/media',
        remoteBasePath: '/bds',
        syncInterval: 30,
      }));
    });

    it('should start polling for remote changes', () => {
      vi.useFakeTimers();

      engine.startPolling();
      expect(engine.isPolling()).toBe(true);

      vi.useRealTimers();
    });

    it('should stop polling when requested', () => {
      vi.useFakeTimers();

      engine.startPolling();
      engine.stopPolling();
      expect(engine.isPolling()).toBe(false);

      vi.useRealTimers();
    });

    it('should emit pollingStarted event', () => {
      vi.useFakeTimers();
      const handler = vi.fn();
      engine.on('pollingStarted', handler);

      engine.startPolling();
      expect(handler).toHaveBeenCalled();

      engine.stopPolling();
      vi.useRealTimers();
    });

    it('should emit pollingStopped event', () => {
      vi.useFakeTimers();
      const handler = vi.fn();
      engine.on('pollingStopped', handler);

      engine.startPolling();
      engine.stopPolling();
      expect(handler).toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  // ============================================
  // Content Hash Comparison
  // ============================================

  describe('Content Hash', () => {
    it('should calculate content hash for a buffer', () => {
      const content = Buffer.from('Hello, World!');
      const hash = engine.calculateContentHash(content);

      expect(hash).toBeTruthy();
      expect(typeof hash).toBe('string');
    });

    it('should return same hash for same content', () => {
      const content = Buffer.from('Test content');
      const hash1 = engine.calculateContentHash(content);
      const hash2 = engine.calculateContentHash(content);

      expect(hash1).toBe(hash2);
    });

    it('should return different hash for different content', () => {
      const hash1 = engine.calculateContentHash(Buffer.from('Content A'));
      const hash2 = engine.calculateContentHash(Buffer.from('Content B'));

      expect(hash1).not.toBe(hash2);
    });
  });

  // ============================================
  // Error Handling
  // ============================================

  describe('Error Handling', () => {
    beforeEach(async () => {
      await engine.configure(createMockDropboxConfig({
        localPostsDir: '/mock/userData/projects/default/posts',
        localMediaDir: '/mock/userData/projects/default/media',
        remoteBasePath: '/bds',
      }));
    });

    it('should handle Dropbox API errors gracefully', async () => {
      mockDropboxClient.filesUpload.mockRejectedValue(
        new Error('Dropbox API error: insufficient_space')
      );

      const localPath = '/mock/userData/projects/default/posts/2026/01/test.md';
      mockFs.readFile.mockResolvedValue(Buffer.from('content'));

      await expect(engine.uploadFile(localPath)).rejects.toThrow('Dropbox API error');
    });

    it('should emit error event on sync failure', async () => {
      const handler = vi.fn();
      engine.on('syncFailed', handler);

      mockDropboxClient.filesListFolder.mockRejectedValue(new Error('Network error'));
      mockDropboxClient.filesListFolderGetLatestCursor.mockRejectedValue(new Error('Network error'));
      mockFs.readdir.mockResolvedValue([]);

      await engine.syncAll();

      expect(handler).toHaveBeenCalled();
    });

    it('should set status to error on repeated failures', async () => {
      mockDropboxClient.filesListFolder.mockRejectedValue(new Error('Network error'));
      mockDropboxClient.filesListFolderGetLatestCursor.mockRejectedValue(new Error('Network error'));
      mockFs.readdir.mockResolvedValue([]);

      await engine.syncAll();

      expect(engine.getStatus()).toBe('error');
    });

    it('should handle auth token expiration', async () => {
      const handler = vi.fn();
      engine.on('authError', handler);

      const authError = new Error('expired_access_token');
      (authError as any).status = 401;
      mockDropboxClient.filesUpload.mockRejectedValue(authError);

      const localPath = '/mock/userData/projects/default/posts/2026/01/test.md';
      mockFs.readFile.mockResolvedValue(Buffer.from('content'));

      await expect(engine.uploadFile(localPath)).rejects.toThrow();
      expect(handler).toHaveBeenCalled();
    });
  });

  // ============================================
  // Pending Conflicts
  // ============================================

  describe('Pending Conflicts Management', () => {
    it('should track pending conflicts', () => {
      const conflict: DropboxConflict = {
        id: 'conflict-1',
        localPath: '/local/test.md',
        remotePath: '/remote/test.md',
        localModified: new Date(),
        remoteModified: new Date(),
        localHash: 'a',
        remoteHash: 'b',
      };

      engine.addPendingConflict(conflict);
      expect(engine.getPendingConflicts()).toHaveLength(1);
      expect(engine.getPendingConflicts()[0].id).toBe('conflict-1');
    });

    it('should remove resolved conflicts', () => {
      const conflict: DropboxConflict = {
        id: 'conflict-1',
        localPath: '/local/test.md',
        remotePath: '/remote/test.md',
        localModified: new Date(),
        remoteModified: new Date(),
        localHash: 'a',
        remoteHash: 'b',
      };

      engine.addPendingConflict(conflict);
      engine.removePendingConflict('conflict-1');
      expect(engine.getPendingConflicts()).toHaveLength(0);
    });

    it('should clear all pending conflicts', () => {
      engine.addPendingConflict({
        id: 'c1', localPath: '/a', remotePath: '/b',
        localModified: new Date(), remoteModified: new Date(),
        localHash: 'a', remoteHash: 'b',
      });
      engine.addPendingConflict({
        id: 'c2', localPath: '/c', remotePath: '/d',
        localModified: new Date(), remoteModified: new Date(),
        localHash: 'c', remoteHash: 'd',
      });

      engine.clearPendingConflicts();
      expect(engine.getPendingConflicts()).toHaveLength(0);
    });
  });

  // ============================================
  // Sync State Persistence
  // ============================================

  describe('Sync State', () => {
    it('should store and retrieve the last cursor', () => {
      engine.setCursor('my-cursor-123');
      expect(engine.getCursor()).toBe('my-cursor-123');
    });

    it('should store and retrieve the last sync timestamp', () => {
      const now = new Date();
      engine.setLastSyncTime(now);
      expect(engine.getLastSyncTime()).toEqual(now);
    });

    it('should return null for cursor when never set', () => {
      expect(engine.getCursor()).toBeNull();
    });

    it('should return null for last sync time when never synced', () => {
      expect(engine.getLastSyncTime()).toBeNull();
    });
  });
});
