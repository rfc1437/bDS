/**
 * Test utilities and mock factories
 * Following TDD best practices with reusable test data generators
 */

import { vi } from 'vitest';
import type { PostData } from '../../src/main/engine/PostEngine';
import type { MediaData } from '../../src/main/engine/MediaEngine';
import type { Task, TaskProgress } from '../../src/main/engine/TaskManager';

// ============================================
// Post Mock Factory
// ============================================

let postIdCounter = 1;

export function createMockPost(overrides?: Partial<PostData>): PostData {
  const id = `post-${postIdCounter++}`;
  const now = new Date();
  
  return {
    id,
    projectId: 'default',
    title: `Test Post ${id}`,
    slug: `test-post-${id}`,
    excerpt: 'This is a test excerpt',
    content: '# Test Content\n\nThis is test content.',
    status: 'draft',
    author: 'Test Author',
    createdAt: now,
    updatedAt: now,
    publishedAt: undefined,
    tags: ['test', 'mock'],
    categories: ['testing'],
    ...overrides,
  };
}

export function createMockPublishedPost(overrides?: Partial<PostData>): PostData {
  const now = new Date();
  return createMockPost({
    status: 'published',
    publishedAt: now,
    ...overrides,
  });
}

// ============================================
// Media Mock Factory
// ============================================

let mediaIdCounter = 1;

export function createMockMedia(overrides?: Partial<MediaData>): MediaData {
  const id = `media-${mediaIdCounter++}`;
  const now = new Date();
  
  return {
    id,
    filename: `${id}.jpg`,
    originalName: `original-${id}.jpg`,
    mimeType: 'image/jpeg',
    size: 1024 * 100, // 100KB
    width: 800,
    height: 600,
    alt: 'Test image',
    caption: 'A test image caption',
    createdAt: now,
    updatedAt: now,
    tags: ['test', 'image'],
    ...overrides,
  };
}

export function createMockPdfMedia(overrides?: Partial<MediaData>): MediaData {
  return createMockMedia({
    filename: 'document.pdf',
    originalName: 'document.pdf',
    mimeType: 'application/pdf',
    width: undefined,
    height: undefined,
    ...overrides,
  });
}

// ============================================
// Task Mock Factory
// ============================================

let taskIdCounter = 1;

export function createMockTask<T = void>(
  executor?: (onProgress: (progress: number, message: string) => void) => Promise<T>,
  overrides?: Partial<Task<T>>
): Task<T> {
  const id = `task-${taskIdCounter++}`;
  
  return {
    id,
    name: `Test Task ${id}`,
    execute: executor || (async (onProgress) => {
      onProgress(50, 'Processing...');
      onProgress(100, 'Done');
      return undefined as T;
    }),
    ...overrides,
  };
}

export function createMockSlowTask(durationMs: number): Task<void> {
  return createMockTask(async (onProgress) => {
    const steps = 10;
    const stepDuration = durationMs / steps;
    
    for (let i = 1; i <= steps; i++) {
      await new Promise(resolve => setTimeout(resolve, stepDuration));
      onProgress(i * 10, `Step ${i}/${steps}`);
    }
  });
}

export function createMockFailingTask(errorMessage: string = 'Task failed'): Task<void> {
  return createMockTask(async () => {
    throw new Error(errorMessage);
  });
}

export function createMockTaskProgress(overrides?: Partial<TaskProgress>): TaskProgress {
  return {
    taskId: `task-${taskIdCounter++}`,
    status: 'pending',
    progress: 0,
    message: 'Waiting...',
    startTime: new Date(),
    ...overrides,
  };
}

// ============================================
// Database Mock Utilities
// ============================================

export function createMockDatabase() {
  const data = {
    posts: new Map<string, PostData>(),
    media: new Map<string, MediaData>(),
  };

  return {
    data,
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
}

// ============================================
// File System Mock Utilities
// ============================================

export function createMockFileSystem() {
  const files = new Map<string, string | Buffer>();
  const directories = new Set<string>(['/mock', '/mock/userData', '/mock/userData/posts', '/mock/userData/media']);

  return {
    files,
    directories,
    
    readFile: vi.fn(async (path: string) => {
      const content = files.get(path);
      if (content === undefined) {
        const error = new Error(`ENOENT: no such file or directory, open '${path}'`);
        (error as NodeJS.ErrnoException).code = 'ENOENT';
        throw error;
      }
      return content;
    }),
    
    writeFile: vi.fn(async (path: string, content: string | Buffer) => {
      files.set(path, content);
    }),
    
    unlink: vi.fn(async (path: string) => {
      if (!files.has(path)) {
        const error = new Error(`ENOENT: no such file or directory, unlink '${path}'`);
        (error as NodeJS.ErrnoException).code = 'ENOENT';
        throw error;
      }
      files.delete(path);
    }),
    
    mkdir: vi.fn(async (path: string) => {
      directories.add(path);
    }),
    
    readdir: vi.fn(async (path: string) => {
      const entries: string[] = [];
      for (const filePath of files.keys()) {
        if (filePath.startsWith(path + '/')) {
          const relativePath = filePath.slice(path.length + 1);
          const firstSegment = relativePath.split('/')[0];
          if (!entries.includes(firstSegment)) {
            entries.push(firstSegment);
          }
        }
      }
      return entries;
    }),
    
    stat: vi.fn(async (path: string) => {
      if (files.has(path)) {
        const content = files.get(path)!;
        return {
          isFile: () => true,
          isDirectory: () => false,
          size: typeof content === 'string' ? content.length : content.length,
        };
      }
      if (directories.has(path)) {
        return {
          isFile: () => false,
          isDirectory: () => true,
          size: 0,
        };
      }
      const error = new Error(`ENOENT: no such file or directory, stat '${path}'`);
      (error as NodeJS.ErrnoException).code = 'ENOENT';
      throw error;
    }),
    
    copyFile: vi.fn(async (src: string, dest: string) => {
      const content = files.get(src);
      if (content === undefined) {
        const error = new Error(`ENOENT: no such file or directory, copyfile '${src}'`);
        (error as NodeJS.ErrnoException).code = 'ENOENT';
        throw error;
      }
      files.set(dest, content);
    }),
    
    access: vi.fn(async (path: string) => {
      if (!files.has(path) && !directories.has(path)) {
        const error = new Error(`ENOENT: no such file or directory, access '${path}'`);
        (error as NodeJS.ErrnoException).code = 'ENOENT';
        throw error;
      }
    }),
  };
}

// ============================================
// Dropbox Mock Factory
// ============================================

import type { DropboxSyncConfig, DropboxConflict } from '../../src/main/engine/DropboxSyncEngine';

let dropboxConflictIdCounter = 1;

export function createMockDropboxConfig(overrides?: Partial<DropboxSyncConfig>): DropboxSyncConfig {
  return {
    accessToken: 'mock-dropbox-access-token',
    refreshToken: 'mock-dropbox-refresh-token',
    appKey: 'mock-app-key',
    appSecret: 'mock-app-secret',
    syncEnabled: true,
    syncInterval: 60,
    localPostsDir: '/mock/userData/projects/default/posts',
    localMediaDir: '/mock/userData/projects/default/media',
    remoteBasePath: '/bds',
    ...overrides,
  };
}

export function createMockDropboxClient() {
  return {
    filesUpload: vi.fn().mockResolvedValue({
      result: {
        name: 'test.md',
        path_lower: '/bds/posts/2026/01/test.md',
        content_hash: 'mockhash123',
        server_modified: '2026-01-15T10:00:00Z',
        size: 100,
      },
    }),
    filesDownload: vi.fn().mockResolvedValue({
      result: {
        name: 'test.md',
        path_lower: '/bds/posts/2026/01/test.md',
        fileBinary: Buffer.from('downloaded content'),
        content_hash: 'mockhash123',
        server_modified: '2026-01-15T10:00:00Z',
        size: 18,
      },
    }),
    filesDeleteV2: vi.fn().mockResolvedValue({
      result: { metadata: { '.tag': 'file', name: 'test.md' } },
    }),
    filesListFolder: vi.fn().mockResolvedValue({
      result: { entries: [], cursor: 'mock-cursor', has_more: false },
    }),
    filesListFolderContinue: vi.fn().mockResolvedValue({
      result: { entries: [], cursor: 'mock-cursor-next', has_more: false },
    }),
    filesListFolderGetLatestCursor: vi.fn().mockResolvedValue({
      result: { cursor: 'mock-latest-cursor' },
    }),
    filesListFolderLongpoll: vi.fn().mockResolvedValue({
      result: { changes: false, backoff: 0 },
    }),
    filesGetMetadata: vi.fn().mockResolvedValue({
      result: {
        '.tag': 'file',
        name: 'test.md',
        path_lower: '/bds/posts/2026/01/test.md',
        content_hash: 'mockhash123',
        server_modified: '2026-01-15T10:00:00Z',
        size: 100,
      },
    }),
    setRefreshToken: vi.fn(),
    getRefreshToken: vi.fn().mockReturnValue('mock-refresh-token'),
    getAccessToken: vi.fn().mockReturnValue('mock-access-token'),
  };
}

export function createMockDropboxConflict(overrides?: Partial<DropboxConflict>): DropboxConflict {
  const id = `conflict-${dropboxConflictIdCounter++}`;
  return {
    id,
    localPath: '/mock/userData/projects/default/posts/2026/01/test.md',
    remotePath: '/bds/posts/2026/01/test.md',
    localModified: new Date('2026-01-20T15:00:00Z'),
    remoteModified: new Date('2026-01-20T14:00:00Z'),
    localHash: 'localhash123',
    remoteHash: 'remotehash456',
    ...overrides,
  };
}

// ============================================
// Reset Utilities
// ============================================

export function resetMockCounters(): void {
  postIdCounter = 1;
  mediaIdCounter = 1;
  taskIdCounter = 1;
  dropboxConflictIdCounter = 1;
}

// ============================================
// Assertion Helpers
// ============================================

export function expectPostToMatchPartial(
  actual: PostData,
  expected: Partial<PostData>
): void {
  for (const [key, value] of Object.entries(expected)) {
    if (value instanceof Date) {
      expect((actual as Record<string, unknown>)[key]).toBeInstanceOf(Date);
    } else {
      expect((actual as Record<string, unknown>)[key]).toEqual(value);
    }
  }
}

export function expectMediaToMatchPartial(
  actual: MediaData,
  expected: Partial<MediaData>
): void {
  for (const [key, value] of Object.entries(expected)) {
    if (value instanceof Date) {
      expect((actual as Record<string, unknown>)[key]).toBeInstanceOf(Date);
    } else {
      expect((actual as Record<string, unknown>)[key]).toEqual(value);
    }
  }
}
