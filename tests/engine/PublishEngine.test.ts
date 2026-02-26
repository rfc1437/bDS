/**
 * PublishEngine Unit Tests
 *
 * Tests the site upload engine that publishes generated site content
 * via SCP or rsync to a remote server. Each directory (html, thumbnails,
 * media) is uploaded as an independent operation with per-file progress.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import path from 'path';
import { PublishEngine, type PublishCredentials, type DirectoryUploadResult } from '../../src/main/engine/PublishEngine';

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
        noContextEngine.uploadHtml(defaultCredentials, vi.fn()),
      ).rejects.toThrow('No project context');
    });
  });

  describe('credential validation', () => {
    it('should throw if sshHost is empty', async () => {
      await expect(
        engine.uploadHtml({ ...defaultCredentials, sshHost: '' }, vi.fn()),
      ).rejects.toThrow('SSH host is required');
    });

    it('should throw if sshUser is empty', async () => {
      await expect(
        engine.uploadHtml({ ...defaultCredentials, sshUser: '' }, vi.fn()),
      ).rejects.toThrow('SSH user is required');
    });

    it('should throw if sshRemotePath is empty', async () => {
      await expect(
        engine.uploadHtml({ ...defaultCredentials, sshRemotePath: '' }, vi.fn()),
      ).rejects.toThrow('Remote path is required');
    });
  });

  describe('directory validation', () => {
    it('should throw if html directory does not exist', async () => {
      mockAccess.mockImplementation(async (p: string) => {
        if ((p as string).endsWith('html')) throw new Error('ENOENT');
      });

      await expect(
        engine.uploadHtml(defaultCredentials, vi.fn()),
      ).rejects.toThrow('Generated site not found');
    });
  });

  // ── SCP mode: uploadHtml ──────────────────────────────────────────────

  describe('SCP mode – uploadHtml', () => {
    it('should upload html files to remote root', async () => {
      mockReaddir.mockImplementation(async (dir: string, opts?: any) => {
        if (dir === path.join(dataDir, 'html') && opts?.withFileTypes) {
          return [{ name: 'index.html', isDirectory: () => false, isFile: () => true }];
        }
        return [];
      });

      const onProgress = vi.fn();
      const result = await engine.uploadHtml(defaultCredentials, onProgress);

      expect(result.filesUploaded).toBe(1);
      expect(mockUploadFile).toHaveBeenCalledTimes(1);
      expect(onProgress).toHaveBeenCalled();
    });

    it('should recurse into subdirectories', async () => {
      mockReaddir.mockImplementation(async (dir: string, opts?: any) => {
        if (dir === path.join(dataDir, 'html') && opts?.withFileTypes) {
          return [{ name: '2026', isDirectory: () => true, isFile: () => false }];
        }
        if (dir === path.join(dataDir, 'html', '2026') && opts?.withFileTypes) {
          return [{ name: 'post.html', isDirectory: () => false, isFile: () => true }];
        }
        return [];
      });

      const result = await engine.uploadHtml(defaultCredentials, vi.fn());

      expect(mockMkdir).toHaveBeenCalled();
      expect(result.filesUploaded).toBe(1);
    });

    it('should skip files that are not newer than remote', async () => {
      const remoteTime = Date.now() / 1000;
      const localTimeOlder = (remoteTime - 100) * 1000;

      mockReaddir.mockImplementation(async (dir: string, opts?: any) => {
        if (dir === path.join(dataDir, 'html') && opts?.withFileTypes) {
          return [{ name: 'old.html', isDirectory: () => false, isFile: () => true }];
        }
        return [];
      });
      mockFsStat.mockResolvedValue({ isDirectory: () => false, isFile: () => true, mtimeMs: localTimeOlder });
      mockStat.mockResolvedValue({ mtime: remoteTime });

      const result = await engine.uploadHtml(defaultCredentials, vi.fn());

      expect(mockUploadFile).not.toHaveBeenCalled();
      expect(result.filesSkipped).toBe(1);
    });

    it('should upload files that are newer than remote', async () => {
      const remoteTime = Date.now() / 1000 - 100;
      const localTimeNewer = Date.now();

      mockReaddir.mockImplementation(async (dir: string, opts?: any) => {
        if (dir === path.join(dataDir, 'html') && opts?.withFileTypes) {
          return [{ name: 'new.html', isDirectory: () => false, isFile: () => true }];
        }
        return [];
      });
      mockFsStat.mockResolvedValue({ isDirectory: () => false, isFile: () => true, mtimeMs: localTimeNewer });
      mockStat.mockResolvedValue({ mtime: remoteTime });

      const result = await engine.uploadHtml(defaultCredentials, vi.fn());

      expect(mockUploadFile).toHaveBeenCalled();
      expect(result.filesUploaded).toBe(1);
    });

    it('should report per-file progress with filename in message', async () => {
      mockReaddir.mockImplementation(async (dir: string, opts?: any) => {
        if (dir === path.join(dataDir, 'html') && opts?.withFileTypes) {
          return [
            { name: 'a.html', isDirectory: () => false, isFile: () => true },
            { name: 'b.html', isDirectory: () => false, isFile: () => true },
            { name: 'c.html', isDirectory: () => false, isFile: () => true },
          ];
        }
        return [];
      });

      const onProgress = vi.fn();
      await engine.uploadHtml(defaultCredentials, onProgress);

      // progress reported per file, including final 100
      const progressValues = onProgress.mock.calls.map(([p]: [number]) => p);
      expect(progressValues.length).toBeGreaterThanOrEqual(3);
      expect(progressValues[progressValues.length - 1]).toBe(100);
      // intermediate progress should be between 0 and 100 exclusive
      expect(progressValues.some(v => v > 0 && v < 100)).toBe(true);
      // should include filenames in messages
      const messages = onProgress.mock.calls.map(([, m]: [number, string]) => m);
      expect(messages.some(m => m.includes('a.html'))).toBe(true);
    });

    it('should return a DirectoryUploadResult', async () => {
      mockReaddir.mockResolvedValue([]);
      const result = await engine.uploadHtml(defaultCredentials, vi.fn());

      expect(result).toHaveProperty('filesUploaded');
      expect(result).toHaveProperty('filesSkipped');
      expect(typeof result.filesUploaded).toBe('number');
      expect(typeof result.filesSkipped).toBe('number');
    });
  });

  // ── SCP mode: uploadThumbnails ────────────────────────────────────────

  describe('SCP mode – uploadThumbnails', () => {
    it('should upload to remote thumbnails/ subdirectory', async () => {
      mockReaddir.mockImplementation(async (dir: string, opts?: any) => {
        if (dir === path.join(dataDir, 'thumbnails') && opts?.withFileTypes) {
          return [{ name: 'thumb1.jpg', isDirectory: () => false, isFile: () => true }];
        }
        return [];
      });

      const result = await engine.uploadThumbnails(defaultCredentials, vi.fn());
      expect(result.filesUploaded).toBe(1);
    });

    it('should return zero counts if thumbnails dir does not exist', async () => {
      mockAccess.mockImplementation(async (p: string) => {
        if ((p as string).includes('thumbnails')) throw new Error('ENOENT');
      });

      const result = await engine.uploadThumbnails(defaultCredentials, vi.fn());
      expect(result.filesUploaded).toBe(0);
      expect(result.filesSkipped).toBe(0);
    });
  });

  // ── SCP mode: uploadMedia ────────────────────────────────────────────

  describe('SCP mode – uploadMedia', () => {
    it('should upload to remote media/ subdirectory, excluding .meta sidecars', async () => {
      mockReaddir.mockImplementation(async (dir: string, opts?: any) => {
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

      const result = await engine.uploadMedia(defaultCredentials, vi.fn());

      // Only photo.jpg and document.pdf should be uploaded
      expect(result.filesUploaded).toBe(2);
      expect(mockUploadFile).toHaveBeenCalledTimes(2);
    });

    it('should return zero counts if media dir does not exist', async () => {
      mockAccess.mockImplementation(async (p: string) => {
        if ((p as string).includes('media')) throw new Error('ENOENT');
      });

      const result = await engine.uploadMedia(defaultCredentials, vi.fn());
      expect(result.filesUploaded).toBe(0);
      expect(result.filesSkipped).toBe(0);
    });
  });

  // ── rsync mode ────────────────────────────────────────────────────────

  describe('rsync mode – uploadHtml', () => {
    const rsyncCredentials: PublishCredentials = { ...defaultCredentials, sshMode: 'rsync' };

    it('should call rsync for html directory', async () => {
      await engine.uploadHtml(rsyncCredentials, vi.fn());
      expect(mockRsync).toHaveBeenCalledTimes(1);
    });

    it('should use --update and --times flags for incremental transfer', async () => {
      await engine.uploadHtml(rsyncCredentials, vi.fn());

      const [options] = mockRsync.mock.calls[0];
      expect(options.args).toContain('--update');
      expect(options.times).toBe(true);
      expect(options.recursive).toBe(true);
    });
  });

  describe('rsync mode – uploadMedia', () => {
    const rsyncCredentials: PublishCredentials = { ...defaultCredentials, sshMode: 'rsync' };

    it('should exclude .meta files when syncing media', async () => {
      await engine.uploadMedia(rsyncCredentials, vi.fn());

      const [options] = mockRsync.mock.calls[0];
      expect(options.exclude).toContain('*.meta');
    });
  });

  // ── per-file progress across methods ──────────────────────────────────

  describe('per-file progress', () => {
    it('uploadHtml progress reaches 100 on completion', async () => {
      mockReaddir.mockResolvedValue([]);
      const onProgress = vi.fn();
      await engine.uploadHtml(defaultCredentials, onProgress);

      const last = onProgress.mock.calls[onProgress.mock.calls.length - 1];
      expect(last[0]).toBe(100);
    });

    it('uploadThumbnails progress reaches 100 on completion', async () => {
      mockReaddir.mockResolvedValue([]);
      const onProgress = vi.fn();
      await engine.uploadThumbnails(defaultCredentials, onProgress);

      const last = onProgress.mock.calls[onProgress.mock.calls.length - 1];
      expect(last[0]).toBe(100);
    });

    it('uploadMedia progress reaches 100 on completion', async () => {
      mockReaddir.mockResolvedValue([]);
      const onProgress = vi.fn();
      await engine.uploadMedia(defaultCredentials, onProgress);

      const last = onProgress.mock.calls[onProgress.mock.calls.length - 1];
      expect(last[0]).toBe(100);
    });
  });
});
