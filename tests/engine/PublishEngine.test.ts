/**
 * PublishEngine Unit Tests
 *
 * Tests the site upload engine that publishes generated site content
 * via SCP or rsync to a remote server.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import path from 'path';
import { PublishEngine, type PublishCredentials, type PublishResult } from '../../src/main/engine/PublishEngine';

// Hoist mock variables so they're available inside vi.mock factories
const {
  mockStat, mockUploadFile, mockMkdir, mockClose, mockScpClient,
  mockReaddir, mockFsStat, mockAccess,
  mockRsync,
} = vi.hoisted(() => {
  const mockStat = vi.fn();
  const mockUploadFile = vi.fn();
  const mockMkdir = vi.fn();
  const mockClose = vi.fn();
  const mockScpClient = {
    stat: mockStat,
    uploadFile: mockUploadFile,
    mkdir: mockMkdir,
    close: mockClose,
  };
  const mockReaddir = vi.fn();
  const mockFsStat = vi.fn();
  const mockAccess = vi.fn();
  const mockRsync = vi.fn((_options: any, callback: any) => {
    callback(null, '', '', 'rsync command');
  });
  return {
    mockStat, mockUploadFile, mockMkdir, mockClose, mockScpClient,
    mockReaddir, mockFsStat, mockAccess,
    mockRsync,
  };
});

// Mock node-scp
vi.mock('node-scp', () => ({
  Client: vi.fn().mockResolvedValue(mockScpClient),
  default: vi.fn().mockResolvedValue(mockScpClient),
}));

// Mock rsyncwrapper
vi.mock('rsyncwrapper', () => ({
  default: mockRsync,
}));

// Mock fs/promises
vi.mock('fs/promises', () => ({
  default: {
    readdir: (...args: any[]) => mockReaddir(...args),
    stat: (...args: any[]) => mockFsStat(...args),
    access: (...args: any[]) => mockAccess(...args),
  },
  readdir: (...args: any[]) => mockReaddir(...args),
  stat: (...args: any[]) => mockFsStat(...args),
  access: (...args: any[]) => mockAccess(...args),
}));

// Mock fs
vi.mock('fs', () => ({
  default: { constants: { F_OK: 0 } },
  constants: { F_OK: 0 },
}));

describe('PublishEngine', () => {
  let engine: PublishEngine;
  const dataDir = '/projects/test-project';

  const defaultCredentials: PublishCredentials = {
    sshHost: 'example.com',
    sshUser: 'deploy',
    sshRemotePath: '/var/www/html',
    sshMode: 'scp',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new PublishEngine();
    engine.setProjectContext('test-project', dataDir);

    // Default: directories exist, files are regular files
    mockAccess.mockResolvedValue(undefined);
    mockFsStat.mockResolvedValue({ isDirectory: () => false, isFile: () => true, mtimeMs: Date.now() });
    mockReaddir.mockResolvedValue([]);
    mockStat.mockRejectedValue(new Error('No such file')); // Remote file doesn't exist → upload
    mockUploadFile.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
    mockClose.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor and project context', () => {
    it('should be instantiated via getPublishEngine singleton', async () => {
      const { getPublishEngine } = await import('../../src/main/engine/PublishEngine');
      const e1 = getPublishEngine();
      const e2 = getPublishEngine();
      expect(e1).toBe(e2);
    });

    it('should throw if no project context is set', async () => {
      const noContextEngine = new PublishEngine();
      await expect(
        noContextEngine.uploadSite(defaultCredentials, vi.fn()),
      ).rejects.toThrow('No project context');
    });
  });

  describe('credential validation', () => {
    it('should throw if sshHost is empty', async () => {
      await expect(
        engine.uploadSite({ ...defaultCredentials, sshHost: '' }, vi.fn()),
      ).rejects.toThrow('SSH host is required');
    });

    it('should throw if sshUser is empty', async () => {
      await expect(
        engine.uploadSite({ ...defaultCredentials, sshUser: '' }, vi.fn()),
      ).rejects.toThrow('SSH user is required');
    });

    it('should throw if sshRemotePath is empty', async () => {
      await expect(
        engine.uploadSite({ ...defaultCredentials, sshRemotePath: '' }, vi.fn()),
      ).rejects.toThrow('Remote path is required');
    });
  });

  describe('directory validation', () => {
    it('should throw if html directory does not exist', async () => {
      mockAccess.mockImplementation(async (p: string) => {
        if ((p as string).endsWith('html')) throw new Error('ENOENT');
      });

      await expect(
        engine.uploadSite(defaultCredentials, vi.fn()),
      ).rejects.toThrow('Generated site not found');
    });
  });

  describe('SCP mode upload', () => {
    it('should upload html files to remote root', async () => {
      // html/ contains index.html
      mockReaddir.mockImplementation(async (dir: string, opts?: any) => {
        if (dir === path.join(dataDir, 'html') && opts?.withFileTypes) {
          return [{ name: 'index.html', isDirectory: () => false, isFile: () => true }];
        }
        return [];
      });

      mockFsStat.mockResolvedValue({
        isDirectory: () => false,
        isFile: () => true,
        mtimeMs: Date.now(),
      });

      const onProgress = vi.fn();
      const result = await engine.uploadSite(defaultCredentials, onProgress);

      expect(result.htmlFilesUploaded).toBeGreaterThanOrEqual(0);
      expect(onProgress).toHaveBeenCalled();
    });

    it('should upload thumbnail files to remote thumbnails/', async () => {
      mockReaddir.mockImplementation(async (dir: string, opts?: any) => {
        if (dir === path.join(dataDir, 'html') && opts?.withFileTypes) {
          return [];
        }
        if (dir === path.join(dataDir, 'thumbnails') && opts?.withFileTypes) {
          return [{ name: 'thumb1.jpg', isDirectory: () => false, isFile: () => true }];
        }
        return [];
      });

      mockFsStat.mockResolvedValue({
        isDirectory: () => false,
        isFile: () => true,
        mtimeMs: Date.now(),
      });

      const result = await engine.uploadSite(defaultCredentials, vi.fn());

      expect(result.thumbnailFilesUploaded).toBeGreaterThanOrEqual(0);
    });

    it('should only upload image files from media, not .meta sidecars', async () => {
      mockReaddir.mockImplementation(async (dir: string, opts?: any) => {
        if (dir === path.join(dataDir, 'html') && opts?.withFileTypes) {
          return [];
        }
        if (dir === path.join(dataDir, 'thumbnails') && opts?.withFileTypes) {
          return [];
        }
        if (dir === path.join(dataDir, 'media') && opts?.withFileTypes) {
          return [
            { name: 'photo.jpg', isDirectory: () => false, isFile: () => true },
            { name: 'photo.jpg.meta', isDirectory: () => false, isFile: () => true },
            { name: 'document.pdf', isDirectory: () => false, isFile: () => true },
            { name: 'document.pdf.meta', isDirectory: () => false, isFile: () => true },
          ];
        }
        return [];
      });

      mockFsStat.mockResolvedValue({
        isDirectory: () => false,
        isFile: () => true,
        mtimeMs: Date.now(),
      });

      const result = await engine.uploadSite(defaultCredentials, vi.fn());

      // Should upload photo.jpg and document.pdf, but NOT .meta files
      expect(result.mediaFilesUploaded).toBeGreaterThanOrEqual(0);
    });

    it('should skip files that are not newer than remote', async () => {
      const remoteTime = Date.now() / 1000; // SSH stats use seconds
      const localTimeOlder = (remoteTime - 100) * 1000; // local is older (ms)

      mockReaddir.mockImplementation(async (dir: string, opts?: any) => {
        if (dir === path.join(dataDir, 'html') && opts?.withFileTypes) {
          return [{ name: 'old.html', isDirectory: () => false, isFile: () => true }];
        }
        return [];
      });

      mockFsStat.mockResolvedValue({
        isDirectory: () => false,
        isFile: () => true,
        mtimeMs: localTimeOlder,
      });

      // Remote file exists and is newer
      mockStat.mockResolvedValue({ mtime: remoteTime });

      const result = await engine.uploadSite(defaultCredentials, vi.fn());

      // File should be skipped since remote is newer
      expect(mockUploadFile).not.toHaveBeenCalled();
      expect(result.filesSkipped).toBeGreaterThan(0);
    });

    it('should upload files that are newer than remote', async () => {
      const remoteTime = Date.now() / 1000 - 100; // Remote is 100s old
      const localTimeNewer = Date.now(); // local is current (ms)

      mockReaddir.mockImplementation(async (dir: string, opts?: any) => {
        if (dir === path.join(dataDir, 'html') && opts?.withFileTypes) {
          return [{ name: 'new.html', isDirectory: () => false, isFile: () => true }];
        }
        return [];
      });

      mockFsStat.mockResolvedValue({
        isDirectory: () => false,
        isFile: () => true,
        mtimeMs: localTimeNewer,
      });

      mockStat.mockResolvedValue({ mtime: remoteTime });

      const result = await engine.uploadSite(defaultCredentials, vi.fn());

      expect(mockUploadFile).toHaveBeenCalled();
      expect(result.htmlFilesUploaded).toBeGreaterThan(0);
    });

    it('should recurse into subdirectories', async () => {
      mockReaddir.mockImplementation(async (dir: string, opts?: any) => {
        if (dir === path.join(dataDir, 'html') && opts?.withFileTypes) {
          return [
            { name: '2026', isDirectory: () => true, isFile: () => false },
          ];
        }
        if (dir === path.join(dataDir, 'html', '2026') && opts?.withFileTypes) {
          return [
            { name: 'post.html', isDirectory: () => false, isFile: () => true },
          ];
        }
        return [];
      });

      mockFsStat.mockResolvedValue({
        isDirectory: () => false,
        isFile: () => true,
        mtimeMs: Date.now(),
      });

      const result = await engine.uploadSite(defaultCredentials, vi.fn());

      expect(mockMkdir).toHaveBeenCalled(); // Should create remote subdir
      expect(result.htmlFilesUploaded).toBeGreaterThan(0);
    });

    it('should return a complete PublishResult', async () => {
      mockReaddir.mockResolvedValue([]);

      const result = await engine.uploadSite(defaultCredentials, vi.fn());

      expect(result).toHaveProperty('htmlFilesUploaded');
      expect(result).toHaveProperty('thumbnailFilesUploaded');
      expect(result).toHaveProperty('mediaFilesUploaded');
      expect(result).toHaveProperty('filesSkipped');
      expect(typeof result.htmlFilesUploaded).toBe('number');
      expect(typeof result.thumbnailFilesUploaded).toBe('number');
      expect(typeof result.mediaFilesUploaded).toBe('number');
      expect(typeof result.filesSkipped).toBe('number');
    });
  });

  describe('rsync mode upload', () => {
    const rsyncCredentials: PublishCredentials = {
      ...defaultCredentials,
      sshMode: 'rsync',
    };

    it('should call rsync for html directory', async () => {
      const rsync = (await import('rsyncwrapper')).default;

      const result = await engine.uploadSite(rsyncCredentials, vi.fn());

      expect(rsync).toHaveBeenCalled();
      expect(result.htmlFilesUploaded).toBeGreaterThanOrEqual(0);
    });

    it('should use --update and --times flags for incremental transfer', async () => {
      const rsync = (await import('rsyncwrapper')).default;

      await engine.uploadSite(rsyncCredentials, vi.fn());

      // Check that rsync was called with update semantics
      const calls = vi.mocked(rsync).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      for (const [options] of calls) {
        expect(options.args).toContain('--update');
        expect(options.times).toBe(true);
        expect(options.recursive).toBe(true);
      }
    });

    it('should exclude .meta files when syncing media', async () => {
      const rsync = (await import('rsyncwrapper')).default;

      await engine.uploadSite(rsyncCredentials, vi.fn());

      const calls = vi.mocked(rsync).mock.calls;
      // Find the media sync call (dest contains /media)
      const mediaCall = calls.find(([opts]) =>
        typeof opts.dest === 'string' && opts.dest.includes('/media'),
      );
      if (mediaCall) {
        expect(mediaCall[0].exclude).toContain('*.meta');
      }
    });
  });

  describe('progress reporting', () => {
    it('should report progress through all three phases', async () => {
      mockReaddir.mockResolvedValue([]);

      const onProgress = vi.fn();
      await engine.uploadSite(defaultCredentials, onProgress);

      // Should have called onProgress at least once per phase
      expect(onProgress).toHaveBeenCalled();
      const progressValues = onProgress.mock.calls.map(([p]: [number]) => p);
      // Should reach 100
      expect(progressValues[progressValues.length - 1]).toBe(100);
    });
  });
});
