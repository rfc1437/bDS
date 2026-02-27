/**
 * IPC Handlers Unit Tests
 *
 * Tests that IPC handlers correctly pass data between engines and the UI.
 * We verify that:
 * 1. Handlers call the correct engine methods
 * 2. Arguments are passed through correctly
 * 3. Results are returned correctly to the UI
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createMockPost, createMockMedia, createMockProject, resetMockCounters } from '../utils/factories';

// Capture registered handlers
const registeredHandlers = new Map<string, (...args: any[]) => Promise<any>>();

// Mock ipcMain to capture handler registrations
vi.mock('electron', () => ({
  app: {
    quit: vi.fn(),
  },
  BrowserWindow: {
    fromWebContents: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => Promise<any>) => {
      registeredHandlers.set(channel, handler);
    }),
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
    showMessageBox: vi.fn(),
  },
  shell: {
    openPath: vi.fn(),
    openExternal: vi.fn(),
    showItemInFolder: vi.fn(),
  },
}));

// Create mock engines with EventEmitter-like `on` method
const mockPostEngine = {
  on: vi.fn(),
  setProjectContext: vi.fn(),
  setSearchLanguage: vi.fn(),
  reconcilePublishedPostsFromGitChanges: vi.fn(),
  createPost: vi.fn(),
  updatePost: vi.fn(),
  deletePost: vi.fn(),
  getPost: vi.fn(),
  getAllPosts: vi.fn(),
  getPostsByStatus: vi.fn(),
  publishPost: vi.fn(),
  discardChanges: vi.fn(),
  hasPublishedVersion: vi.fn(),
  getPublishedVersion: vi.fn(),
  isSlugAvailable: vi.fn(),
  generateUniqueSlug: vi.fn(),
  rebuildDatabaseFromFiles: vi.fn(),
  reindexText: vi.fn(),
  searchPosts: vi.fn(),
  getPostsFiltered: vi.fn(),
  getAvailableTags: vi.fn(),
  getAvailableCategories: vi.fn(),
  getPostsByYearMonth: vi.fn(),
  getLinksTo: vi.fn(),
  getLinkedBy: vi.fn(),
  rebuildLinks: vi.fn(),
};

const mockMediaEngine = {
  on: vi.fn(),
  setProjectContext: vi.fn(),
  setSearchLanguage: vi.fn(),
  importMedia: vi.fn(),
  updateMedia: vi.fn(),
  deleteMedia: vi.fn(),
  getMedia: vi.fn(),
  getAllMedia: vi.fn(),
  getMediaFiltered: vi.fn(),
  searchMedia: vi.fn(),
  getMediaByYearMonth: vi.fn(),
  getAvailableTags: vi.fn(),
  getTagsWithCounts: vi.fn(),
  rebuildDatabaseFromFiles: vi.fn(),
  reindexText: vi.fn(),
  getThumbnailDataUrl: vi.fn(),
  regenerateMissingThumbnails: vi.fn(),
  getRelativePath: vi.fn(),
};

const mockProjectEngine = {
  on: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  deleteProjectWithData: vi.fn(),
  getProject: vi.fn(),
  getAllProjects: vi.fn(),
  getActiveProject: vi.fn(),
  setActiveProject: vi.fn(),
  getDataDir: vi.fn(),
  getInternalBaseDir: vi.fn(),
  getDefaultProjectBaseDir: vi.fn(),
  getProjectPaths: vi.fn(),
};

const mockMetaEngine = {
  on: vi.fn(),
  setProjectContext: vi.fn(),
  isInitialized: vi.fn(),
  syncOnStartup: vi.fn(),
  getTags: vi.fn(),
  getCategories: vi.fn(),
  addTag: vi.fn(),
  removeTag: vi.fn(),
  addCategory: vi.fn(),
  removeCategory: vi.fn(),
  getProjectMetadata: vi.fn(),
  setProjectMetadata: vi.fn(),
  updateProjectMetadata: vi.fn(),
};

const mockTagEngine = {
  on: vi.fn(),
  setProjectContext: vi.fn(),
  getAllTags: vi.fn(),
  getTag: vi.fn(),
  createTag: vi.fn(),
  updateTag: vi.fn(),
  deleteTag: vi.fn(),
  mergeTags: vi.fn(),
  renameTag: vi.fn(),
  syncTagsFromPosts: vi.fn(),
  getOrphanedTags: vi.fn(),
  cleanupOrphanedTags: vi.fn(),
  searchTags: vi.fn(),
};

const mockMenuEngine = {
  setProjectContext: vi.fn(),
  getMenu: vi.fn(),
  saveMenu: vi.fn(),
};

const mockPostMediaEngine = {
  on: vi.fn(),
  setProjectContext: vi.fn(),
  linkMediaToPost: vi.fn(),
  unlinkMediaFromPost: vi.fn(),
  linkManyToPost: vi.fn(),
  unlinkManyFromPost: vi.fn(),
  getLinkedMediaForPost: vi.fn(),
  getLinkedPostsForMedia: vi.fn(),
  reorderMediaForPost: vi.fn(),
  isMediaLinkedToPost: vi.fn(),
  rebuildFromSidecars: vi.fn(),
};

const mockScriptEngine = {
  on: vi.fn(),
  setProjectContext: vi.fn(),
  createScript: vi.fn(),
  updateScript: vi.fn(),
  deleteScript: vi.fn(),
  getScript: vi.fn(),
  getAllScripts: vi.fn(),
  rebuildDatabaseFromFiles: vi.fn(),
  reconcileScriptsFromGitChanges: vi.fn(),
};

const mockTemplateEngine = {
  on: vi.fn(),
  createTemplate: vi.fn(),
  updateTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
  getTemplate: vi.fn(),
  getAllTemplates: vi.fn(),
  getEnabledTemplatesByKind: vi.fn(),
  getTemplateBySlug: vi.fn(),
  validateTemplate: vi.fn(),
  rebuildDatabaseFromFiles: vi.fn(),
  reconcileTemplatesFromGitChanges: vi.fn(),
  setProjectContext: vi.fn(),
  getTemplatesDirectory: vi.fn().mockReturnValue('/tmp/templates'),
};

const mockGitEngine = {
  checkAvailability: vi.fn(),
  getHeadCommit: vi.fn(),
  getChangedPostFilesBetween: vi.fn(),
  getChangedScriptFilesBetween: vi.fn(),
  getChangedTemplateFilesBetween: vi.fn(),
  getRepoState: vi.fn(),
  getStatus: vi.fn(),
  getDiff: vi.fn(),
  getDiffContent: vi.fn(),
  getHistory: vi.fn(),
  getRemoteState: vi.fn(),
  fetch: vi.fn(),
  pull: vi.fn(),
  push: vi.fn(),
  commitAll: vi.fn(),
  initializeRepo: vi.fn(),
  ensureGitignore: vi.fn(),
  pruneLfsCache: vi.fn(),
};

const mockTaskManager = {
  getAllTasks: vi.fn(),
  cancelTask: vi.fn(),
  runTask: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
};

const mockGeneratedFileHashStore = new Map<string, string>();

const mockDatabase = {
  getLocal: vi.fn(() => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          get: vi.fn(),
        })),
      })),
    })),
  })),
  getLocalClient: vi.fn(() => ({
    execute: vi.fn(async ({ sql, args }: { sql: string; args?: any[] }) => {
      if (sql.includes('CREATE TABLE IF NOT EXISTS generated_file_hashes')) {
        return { rows: [] };
      }

      if (sql.startsWith('SELECT content_hash FROM generated_file_hashes')) {
        const key = `${String(args?.[0] ?? '')}:${String(args?.[1] ?? '')}`;
        return {
          rows: mockGeneratedFileHashStore.has(key)
            ? [{ content_hash: mockGeneratedFileHashStore.get(key) as string }]
            : [],
        };
      }

      if (sql.includes('INSERT INTO generated_file_hashes')) {
        const key = `${String(args?.[0] ?? '')}:${String(args?.[1] ?? '')}`;
        const value = String(args?.[2] ?? '');
        mockGeneratedFileHashStore.set(key, value);
        return { rowsAffected: 1 };
      }

      return { rows: [] };
    }),
  })),
  getDataPaths: vi.fn(() => ({
    database: '/mock/data/bds.db',
    posts: '/mock/data/posts',
    media: '/mock/data/media',
  })),
};

// Mock engine modules
vi.mock('../../src/main/engine/PostEngine', () => ({
  getPostEngine: vi.fn(() => mockPostEngine),
  PostData: {},
  PostFilter: {},
  PaginationOptions: {},
}));

vi.mock('../../src/main/engine/MediaEngine', () => ({
  getMediaEngine: vi.fn(() => mockMediaEngine),
  MediaData: {},
}));

vi.mock('../../src/main/engine/ProjectEngine', () => ({
  getProjectEngine: vi.fn(() => mockProjectEngine),
  ProjectData: {},
}));

vi.mock('../../src/main/engine/MetaEngine', () => ({
  getMetaEngine: vi.fn(() => mockMetaEngine),
}));

vi.mock('../../src/main/engine/TagEngine', () => ({
  getTagEngine: vi.fn(() => mockTagEngine),
}));

vi.mock('../../src/main/engine/MenuEngine', () => ({
  getMenuEngine: vi.fn(() => mockMenuEngine),
}));

vi.mock('../../src/main/engine/PostMediaEngine', () => ({
  getPostMediaEngine: vi.fn(() => mockPostMediaEngine),
}));

vi.mock('../../src/main/engine/ScriptEngine', () => ({
  getScriptEngine: vi.fn(() => mockScriptEngine),
}));

vi.mock('../../src/main/engine/TemplateEngine', () => ({
  getTemplateEngine: vi.fn(() => mockTemplateEngine),
}));

vi.mock('../../src/main/engine/GitEngine', () => ({
  getGitEngine: vi.fn(() => mockGitEngine),
}));

vi.mock('../../src/main/engine/TaskManager', () => ({
  taskManager: mockTaskManager,
  TaskProgress: {},
}));

vi.mock('../../src/main/database', () => ({
  getDatabase: vi.fn(() => mockDatabase),
}));

vi.mock('../../src/main/database/connection', () => ({
  getDatabase: vi.fn(() => mockDatabase),
}));

vi.mock('../../src/main/engine/stemmer', () => ({
  isoToStemmerLanguage: vi.fn((iso: string) => iso === 'en' ? 'english' : 'german'),
}));

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  unlink: vi.fn(),
}));

// Helper to invoke a registered handler
async function invokeHandler(channel: string, ...args: any[]): Promise<any> {
  const handler = registeredHandlers.get(channel);
  if (!handler) {
    throw new Error(`No handler registered for channel: ${channel}`);
  }
  // First argument is the IpcMainInvokeEvent, which we mock as empty object
  return handler({}, ...args);
}

async function invokeHandlerWithEvent(event: any, channel: string, ...args: any[]): Promise<any> {
  const handler = registeredHandlers.get(channel);
  if (!handler) {
    throw new Error(`No handler registered for channel: ${channel}`);
  }
  return handler(event, ...args);
}

describe('IPC Handlers', () => {
  beforeEach(async () => {
    // Clear all mocks
    vi.clearAllMocks();
    registeredHandlers.clear();
    mockGeneratedFileHashStore.clear();
    resetMockCounters();
    
    // Import and register handlers fresh for each test
    const { registerIpcHandlers } = await import('../../src/main/ipc/handlers');
    registerIpcHandlers();
  });

  afterEach(() => {
    vi.resetModules();
  });

  // ============ Git Handlers ============
  describe('Git Handlers', () => {
    describe('git:checkAvailability', () => {
      it('should return availability from GitEngine', async () => {
        mockGitEngine.checkAvailability.mockResolvedValue({ gitFound: true, version: '2.49.0' });

        const result = await invokeHandler('git:checkAvailability');

        expect(mockGitEngine.checkAvailability).toHaveBeenCalled();
        expect(result).toEqual({ gitFound: true, version: '2.49.0' });
      });
    });

    describe('git:getRepoState', () => {
      it('should pass project path to GitEngine.getRepoState', async () => {
        mockGitEngine.getRepoState.mockResolvedValue({
          isRepo: true,
          rootPath: '/repo',
          currentBranch: 'main',
          hasRemote: true,
        });

        const result = await invokeHandler('git:getRepoState', '/repo');

        expect(mockGitEngine.getRepoState).toHaveBeenCalledWith('/repo');
        expect(result).toEqual({
          isRepo: true,
          rootPath: '/repo',
          currentBranch: 'main',
          hasRemote: true,
        });
      });
    });

    describe('git:status', () => {
      it('should pass project path to GitEngine.getStatus', async () => {
        mockGitEngine.getStatus.mockResolvedValue({
          files: [{ path: 'file.md', status: 'modified' }],
          counts: {
            untracked: 0,
            modified: 1,
            deleted: 0,
            renamed: 0,
            staged: 0,
            total: 1,
          },
        });

        const result = await invokeHandler('git:status', '/repo');

        expect(mockGitEngine.getStatus).toHaveBeenCalledWith('/repo');
        expect(result.counts.total).toBe(1);
      });
    });

    describe('git:diff', () => {
      it('should pass project path and file path to GitEngine.getDiff', async () => {
        mockGitEngine.getDiff.mockResolvedValue({
          filePath: 'posts/first.md',
          patch: 'diff --git a/posts/first.md b/posts/first.md',
        });

        const result = await invokeHandler('git:diff', '/repo', 'posts/first.md');

        expect(mockGitEngine.getDiff).toHaveBeenCalledWith('/repo', 'posts/first.md');
        expect(result).toEqual({
          filePath: 'posts/first.md',
          patch: 'diff --git a/posts/first.md b/posts/first.md',
        });
      });
    });

    describe('git:history', () => {
      it('should pass project path and limit to GitEngine.getHistory', async () => {
        mockGitEngine.getHistory.mockResolvedValue([
          {
            hash: 'abc123',
            shortHash: 'abc123',
            date: '2026-02-16T10:00:00.000Z',
            subject: 'feat: add git sidebar',
            author: 'Dev One',
          },
        ]);

        const result = await invokeHandler('git:history', '/repo', 20);

        expect(mockGitEngine.getHistory).toHaveBeenCalledWith('/repo', 20);
        expect(result).toHaveLength(1);
      });
    });

    describe('git:remoteState', () => {
      it('should pass project path to GitEngine.getRemoteState', async () => {
        mockGitEngine.getRemoteState.mockResolvedValue({
          localBranch: 'main',
          upstreamBranch: 'origin/main',
          hasUpstream: true,
          ahead: 2,
          behind: 1,
        });

        const result = await invokeHandler('git:remoteState', '/repo');

        expect(mockGitEngine.getRemoteState).toHaveBeenCalledWith('/repo');
        expect(result).toEqual({
          localBranch: 'main',
          upstreamBranch: 'origin/main',
          hasUpstream: true,
          ahead: 2,
          behind: 1,
        });
      });
    });

    describe('git:diffContent', () => {
      it('should pass project path and file path to GitEngine.getDiffContent', async () => {
        mockGitEngine.getDiffContent.mockResolvedValue({
          filePath: 'posts/first.md',
          original: '# old content',
          modified: '# new content',
        });

        const result = await invokeHandler('git:diffContent', '/repo', 'posts/first.md');

        expect(mockGitEngine.getDiffContent).toHaveBeenCalledWith('/repo', 'posts/first.md');
        expect(result).toEqual({
          filePath: 'posts/first.md',
          original: '# old content',
          modified: '# new content',
        });
      });
    });

    describe('git:init', () => {
      it('should pass project path to GitEngine.initializeRepo', async () => {
        mockGitEngine.initializeRepo.mockResolvedValue({ success: true });

        const result = await invokeHandler('git:init', '/repo');

        expect(mockGitEngine.initializeRepo).toHaveBeenCalledWith('/repo', undefined, expect.any(Function));
        expect(result).toEqual({ success: true });
      });

      it('should pass optional remote url to GitEngine.initializeRepo', async () => {
        mockGitEngine.initializeRepo.mockResolvedValue({ success: true });

        await invokeHandler('git:init', '/repo', 'https://github.com/example/repo.git');

        expect(mockGitEngine.initializeRepo).toHaveBeenCalledWith('/repo', 'https://github.com/example/repo.git', expect.any(Function));
      });

      it('should forward init progress updates to renderer via event sender', async () => {
        mockGitEngine.initializeRepo.mockImplementation(async (_projectPath: string, _remoteUrl: string | undefined, onProgress: (payload: unknown) => void) => {
          onProgress({ phase: 'initializing-repo', progress: 20, message: 'Initializing repository...' });
          onProgress({ phase: 'completed', progress: 100, message: 'Repository initialized.' });
          return { success: true };
        });

        const send = vi.fn();
        const event = { sender: { send } };

        const result = await invokeHandlerWithEvent(event, 'git:init', '/repo');

        expect(result).toEqual({ success: true });
        expect(send).toHaveBeenCalledWith('git:initProgress', {
          phase: 'initializing-repo',
          progress: 20,
          message: 'Initializing repository...',
        });
        expect(send).toHaveBeenCalledWith('git:initProgress', {
          phase: 'completed',
          progress: 100,
          message: 'Repository initialized.',
        });
      });
    });

    describe('git:ensureGitignore', () => {
      it('should pass project path to GitEngine.ensureGitignore', async () => {
        mockGitEngine.ensureGitignore.mockResolvedValue({
          updated: true,
          created: false,
          addedEntries: ['Thumbs.db'],
        });

        const result = await invokeHandler('git:ensureGitignore', '/repo');

        expect(mockGitEngine.ensureGitignore).toHaveBeenCalledWith('/repo');
        expect(result).toEqual({
          updated: true,
          created: false,
          addedEntries: ['Thumbs.db'],
        });
      });
    });

    describe('git:pruneLfs', () => {
      it('should pass project path and options to GitEngine.pruneLfsCache', async () => {
        mockGitEngine.pruneLfsCache.mockResolvedValue({
          success: true,
          dryRun: true,
          verifyRemote: true,
          output: 'would prune',
        });

        const result = await invokeHandler('git:pruneLfs', '/repo', { dryRun: true, verifyRemote: true });

        expect(mockGitEngine.pruneLfsCache).toHaveBeenCalledWith('/repo', { dryRun: true, verifyRemote: true });
        expect(result.success).toBe(true);
      });
    });

    describe('git:fetch', () => {
      it('should pass project path to GitEngine.fetch', async () => {
        mockGitEngine.fetch.mockResolvedValue({ success: true });

        const result = await invokeHandler('git:fetch', '/repo');

        expect(mockGitEngine.fetch).toHaveBeenCalledWith('/repo');
        expect(result).toEqual({ success: true });
      });
    });

    describe('git:pull', () => {
      it('should reconcile published posts from pulled post file changes when pull succeeds', async () => {
        mockGitEngine.getHeadCommit
          .mockResolvedValueOnce('before-head')
          .mockResolvedValueOnce('after-head');
        mockGitEngine.pull.mockResolvedValue({ success: true });
        mockGitEngine.getChangedPostFilesBetween.mockResolvedValue([
          { status: 'modified', path: 'posts/2026/02/existing.md' },
          { status: 'added', path: 'posts/2026/02/new-post.md' },
        ]);
        mockGitEngine.getChangedScriptFilesBetween.mockResolvedValue([
          { status: 'modified', path: 'scripts/transform.py' },
        ]);
        mockGitEngine.getChangedTemplateFilesBetween.mockResolvedValue([]);
        mockPostEngine.reconcilePublishedPostsFromGitChanges.mockResolvedValue({
          created: 1,
          updated: 1,
          deleted: 0,
          processedFiles: 2,
        });
        mockScriptEngine.reconcileScriptsFromGitChanges.mockResolvedValue({
          created: 0,
          updated: 1,
          deleted: 0,
          processedFiles: 1,
        });

        const result = await invokeHandler('git:pull', '/repo');

        expect(mockGitEngine.getHeadCommit).toHaveBeenNthCalledWith(1, '/repo');
        expect(mockGitEngine.pull).toHaveBeenCalledWith('/repo');
        expect(mockGitEngine.getHeadCommit).toHaveBeenNthCalledWith(2, '/repo');
        expect(mockGitEngine.getChangedPostFilesBetween).toHaveBeenCalledWith('/repo', 'before-head', 'after-head');
        expect(mockGitEngine.getChangedScriptFilesBetween).toHaveBeenCalledWith('/repo', 'before-head', 'after-head');
        expect(mockPostEngine.reconcilePublishedPostsFromGitChanges).toHaveBeenCalledWith('/repo', [
          { status: 'modified', path: 'posts/2026/02/existing.md' },
          { status: 'added', path: 'posts/2026/02/new-post.md' },
        ]);
        expect(mockScriptEngine.reconcileScriptsFromGitChanges).toHaveBeenCalledWith('/repo', [
          { status: 'modified', path: 'scripts/transform.py' },
        ]);
        expect(result).toEqual({ success: true });
      });

      it('should skip reconciliation when pull fails', async () => {
        mockGitEngine.getHeadCommit.mockResolvedValue('before-head');
        mockGitEngine.pull.mockResolvedValue({ success: false, code: 'conflict' });

        const result = await invokeHandler('git:pull', '/repo');

        expect(mockGitEngine.pull).toHaveBeenCalledWith('/repo');
        expect(mockGitEngine.getChangedPostFilesBetween).not.toHaveBeenCalled();
        expect(mockGitEngine.getChangedScriptFilesBetween).not.toHaveBeenCalled();
        expect(mockPostEngine.reconcilePublishedPostsFromGitChanges).not.toHaveBeenCalled();
        expect(mockScriptEngine.reconcileScriptsFromGitChanges).not.toHaveBeenCalled();
        expect(result).toEqual({ success: false, code: 'conflict' });
      });

      it('should skip reconciliation when pull does not change HEAD', async () => {
        mockGitEngine.getHeadCommit
          .mockResolvedValueOnce('same-head')
          .mockResolvedValueOnce('same-head');
        mockGitEngine.pull.mockResolvedValue({ success: true });

        const result = await invokeHandler('git:pull', '/repo');

        expect(mockGitEngine.pull).toHaveBeenCalledWith('/repo');
        expect(mockGitEngine.getChangedPostFilesBetween).not.toHaveBeenCalled();
        expect(mockGitEngine.getChangedScriptFilesBetween).not.toHaveBeenCalled();
        expect(mockPostEngine.reconcilePublishedPostsFromGitChanges).not.toHaveBeenCalled();
        expect(mockScriptEngine.reconcileScriptsFromGitChanges).not.toHaveBeenCalled();
        expect(result).toEqual({ success: true });
      });
    });

    describe('git:push', () => {
      it('should pass project path to GitEngine.push', async () => {
        mockGitEngine.push.mockResolvedValue({ success: true });

        const result = await invokeHandler('git:push', '/repo');

        expect(mockGitEngine.push).toHaveBeenCalledWith('/repo');
        expect(result).toEqual({ success: true });
      });
    });

    describe('git:commitAll', () => {
      it('should pass project path and message to GitEngine.commitAll', async () => {
        mockGitEngine.commitAll.mockResolvedValue({ success: true });

        const result = await invokeHandler('git:commitAll', '/repo', 'feat: commit');

        expect(mockGitEngine.commitAll).toHaveBeenCalledWith('/repo', 'feat: commit');
        expect(result).toEqual({ success: true });
      });
    });
  });

  // ============ Project Handlers ============
  describe('Project Handlers', () => {
    describe('projects:create', () => {
      it('should pass data to ProjectEngine.createProject and return result', async () => {
        const mockProject = createMockProject({ name: 'New Blog' });
        mockProjectEngine.createProject.mockResolvedValue(mockProject);

        const result = await invokeHandler('projects:create', {
          name: 'New Blog',
          description: 'A test blog',
        });

        expect(mockProjectEngine.createProject).toHaveBeenCalledWith({
          name: 'New Blog',
          description: 'A test blog',
        });
        expect(result).toEqual(mockProject);
      });
    });

    describe('projects:update', () => {
      it('should pass id and data to ProjectEngine.updateProject', async () => {
        const mockProject = createMockProject({ name: 'Updated Blog' });
        mockProjectEngine.updateProject.mockResolvedValue(mockProject);

        const result = await invokeHandler('projects:update', 'proj-1', { name: 'Updated Blog' });

        expect(mockProjectEngine.updateProject).toHaveBeenCalledWith('proj-1', { name: 'Updated Blog' });
        expect(result).toEqual(mockProject);
      });
    });

    describe('projects:delete', () => {
      it('should pass id to ProjectEngine.deleteProject', async () => {
        mockProjectEngine.deleteProject.mockResolvedValue(undefined);

        await invokeHandler('projects:delete', 'proj-1');

        expect(mockProjectEngine.deleteProject).toHaveBeenCalledWith('proj-1');
      });
    });

    describe('projects:getAll', () => {
      it('should return all projects from ProjectEngine', async () => {
        const mockProjects = [
          createMockProject({ name: 'Blog 1' }),
          createMockProject({ name: 'Blog 2' }),
        ];
        mockProjectEngine.getAllProjects.mockResolvedValue(mockProjects);

        const result = await invokeHandler('projects:getAll');

        expect(mockProjectEngine.getAllProjects).toHaveBeenCalled();
        expect(result).toEqual(mockProjects);
      });
    });

    describe('projects:getActive', () => {
      it('should return active project and set engine contexts', async () => {
        const mockProject = createMockProject({ id: 'active-proj', dataPath: '/custom/path' });
        mockProjectEngine.getActiveProject.mockResolvedValue(mockProject);
        mockProjectEngine.getDataDir.mockReturnValue('/custom/path');
        mockMetaEngine.getProjectMetadata.mockResolvedValue({ mainLanguage: 'en' });

        const result = await invokeHandler('projects:getActive');

        expect(mockProjectEngine.getActiveProject).toHaveBeenCalled();
        expect(mockPostEngine.setProjectContext).toHaveBeenCalledWith('active-proj', '/custom/path');
        expect(mockMediaEngine.setProjectContext).toHaveBeenCalledWith('active-proj', '/custom/path', '/custom/path');
        expect(mockMetaEngine.setProjectContext).toHaveBeenCalledWith('active-proj', '/custom/path');
        expect(mockMetaEngine.syncOnStartup).toHaveBeenCalled();
        expect(result).toEqual(mockProject);
      });

      it('should return null when no active project', async () => {
        mockProjectEngine.getActiveProject.mockResolvedValue(null);

        const result = await invokeHandler('projects:getActive');

        expect(result).toBeNull();
        expect(mockPostEngine.setProjectContext).not.toHaveBeenCalled();
      });

      it('should set search language from project metadata', async () => {
        const mockProject = createMockProject({ id: 'proj-1' });
        mockProjectEngine.getActiveProject.mockResolvedValue(mockProject);
        mockProjectEngine.getDataDir.mockReturnValue('/data');
        mockMetaEngine.getProjectMetadata.mockResolvedValue({ mainLanguage: 'de' });

        await invokeHandler('projects:getActive');

        expect(mockPostEngine.setSearchLanguage).toHaveBeenCalledWith('german');
        expect(mockMediaEngine.setSearchLanguage).toHaveBeenCalledWith('german');
      });
    });

    describe('projects:setActive', () => {
      it('should set active project and update all engine contexts', async () => {
        const mockProject = createMockProject({ id: 'new-active', dataPath: '/new/path' });
        mockProjectEngine.setActiveProject.mockResolvedValue(mockProject);
        mockProjectEngine.getDataDir.mockReturnValue('/new/path');
        mockMetaEngine.getProjectMetadata.mockResolvedValue(null);

        const result = await invokeHandler('projects:setActive', 'new-active');

        expect(mockProjectEngine.setActiveProject).toHaveBeenCalledWith('new-active');
        expect(mockPostEngine.setProjectContext).toHaveBeenCalledWith('new-active', '/new/path');
        expect(mockMediaEngine.setProjectContext).toHaveBeenCalledWith('new-active', '/new/path', '/new/path');
        expect(mockPostMediaEngine.setProjectContext).toHaveBeenCalledWith('new-active');
        expect(result).toEqual(mockProject);
      });
    });
  });

  // ============ Post Handlers ============
  describe('Post Handlers', () => {
    describe('posts:create', () => {
      it('should pass data to PostEngine.createPost and return the created post', async () => {
        const inputData = { title: 'My New Post', content: '# Hello' };
        const mockPost = createMockPost({ ...inputData, id: 'post-123' });
        mockPostEngine.createPost.mockResolvedValue(mockPost);

        const result = await invokeHandler('posts:create', inputData);

        expect(mockPostEngine.createPost).toHaveBeenCalledWith(inputData);
        expect(result).toEqual(mockPost);
        expect(result.title).toBe('My New Post');
      });
    });

    describe('posts:update', () => {
      it('should pass id and data to PostEngine.updatePost', async () => {
        const updateData = { title: 'Updated Title' };
        const mockPost = createMockPost({ id: 'post-1', title: 'Updated Title' });
        mockPostEngine.updatePost.mockResolvedValue(mockPost);

        const result = await invokeHandler('posts:update', 'post-1', updateData);

        expect(mockPostEngine.updatePost).toHaveBeenCalledWith('post-1', updateData);
        expect(result.title).toBe('Updated Title');
      });
    });

    describe('posts:delete', () => {
      it('should pass id to PostEngine.deletePost', async () => {
        mockPostEngine.deletePost.mockResolvedValue(undefined);

        await invokeHandler('posts:delete', 'post-to-delete');

        expect(mockPostEngine.deletePost).toHaveBeenCalledWith('post-to-delete');
      });
    });

    describe('posts:get', () => {
      it('should return post from PostEngine.getPost', async () => {
        const mockPost = createMockPost({ id: 'post-1', title: 'Fetched Post' });
        mockPostEngine.getPost.mockResolvedValue(mockPost);

        const result = await invokeHandler('posts:get', 'post-1');

        expect(mockPostEngine.getPost).toHaveBeenCalledWith('post-1');
        expect(result).toEqual(mockPost);
      });

      it('should return null for non-existent post', async () => {
        mockPostEngine.getPost.mockResolvedValue(null);

        const result = await invokeHandler('posts:get', 'non-existent');

        expect(result).toBeNull();
      });
    });

    describe('posts:getPreviewUrl', () => {
      it('should return canonical preview URL for an existing post', async () => {
        mockPostEngine.getPost.mockResolvedValue(createMockPost({
          id: 'post-1',
          slug: 'my-post',
          createdAt: new Date('2026-02-16T12:00:00.000Z'),
        }));

        const result = await invokeHandler('posts:getPreviewUrl', 'post-1');

        expect(mockPostEngine.getPost).toHaveBeenCalledWith('post-1');
        expect(result).toBe('http://127.0.0.1:4123/2026/02/16/my-post');
      });

      it('should return null when post does not exist', async () => {
        mockPostEngine.getPost.mockResolvedValue(null);

        const result = await invokeHandler('posts:getPreviewUrl', 'missing-post');

        expect(result).toBeNull();
      });

      it('should return draft preview URL when draft option is enabled', async () => {
        mockPostEngine.getPost.mockResolvedValue(createMockPost({
          id: 'post-1',
          slug: 'my-post',
          createdAt: new Date('2026-02-16T12:00:00.000Z'),
        }));

        const result = await invokeHandler('posts:getPreviewUrl', 'post-1', { draft: true });

        expect(mockPostEngine.getPost).toHaveBeenCalledWith('post-1');
        expect(result).toBe('http://127.0.0.1:4123/2026/02/16/my-post?draft=true&postId=post-1');
      });
    });

    describe('posts:getAll', () => {
      it('should return paginated posts from PostEngine', async () => {
        const mockPosts = [
          createMockPost({ title: 'Post 1' }),
          createMockPost({ title: 'Post 2' }),
        ];
        const paginatedResult = { items: mockPosts, hasMore: false, total: 2 };
        mockPostEngine.getAllPosts.mockResolvedValue(paginatedResult);

        const result = await invokeHandler('posts:getAll', { limit: 10, offset: 0 });

        expect(mockPostEngine.getAllPosts).toHaveBeenCalledWith({ limit: 10, offset: 0 });
        expect(result.items).toHaveLength(2);
        expect(result.total).toBe(2);
      });

      it('should work without pagination options', async () => {
        mockPostEngine.getAllPosts.mockResolvedValue({ items: [], hasMore: false, total: 0 });

        await invokeHandler('posts:getAll');

        expect(mockPostEngine.getAllPosts).toHaveBeenCalledWith(undefined);
      });
    });

    describe('posts:getByStatus', () => {
      it('should filter posts by status', async () => {
        const draftPosts = [createMockPost({ status: 'draft' })];
        mockPostEngine.getPostsByStatus.mockResolvedValue(draftPosts);

        const result = await invokeHandler('posts:getByStatus', 'draft');

        expect(mockPostEngine.getPostsByStatus).toHaveBeenCalledWith('draft');
        expect(result).toEqual(draftPosts);
      });
    });

    describe('posts:publish', () => {
      it('should publish a post and return updated post', async () => {
        const publishedPost = createMockPost({ id: 'post-1', status: 'published' });
        mockPostEngine.publishPost.mockResolvedValue(publishedPost);

        const result = await invokeHandler('posts:publish', 'post-1');

        expect(mockPostEngine.publishPost).toHaveBeenCalledWith('post-1');
        expect(result.status).toBe('published');
      });
    });

    describe('posts:isSlugAvailable', () => {
      it('should check slug availability', async () => {
        mockPostEngine.isSlugAvailable.mockResolvedValue(true);

        const result = await invokeHandler('posts:isSlugAvailable', 'my-slug');

        expect(mockPostEngine.isSlugAvailable).toHaveBeenCalledWith('my-slug', undefined);
        expect(result).toBe(true);
      });

      it('should exclude a post when checking slug', async () => {
        mockPostEngine.isSlugAvailable.mockResolvedValue(true);

        await invokeHandler('posts:isSlugAvailable', 'my-slug', 'exclude-post-id');

        expect(mockPostEngine.isSlugAvailable).toHaveBeenCalledWith('my-slug', 'exclude-post-id');
      });
    });

    describe('posts:generateUniqueSlug', () => {
      it('should generate unique slug from title', async () => {
        mockPostEngine.generateUniqueSlug.mockResolvedValue('my-awesome-post');

        const result = await invokeHandler('posts:generateUniqueSlug', 'My Awesome Post');

        expect(mockPostEngine.generateUniqueSlug).toHaveBeenCalledWith('My Awesome Post', undefined);
        expect(result).toBe('my-awesome-post');
      });
    });

    describe('posts:search', () => {
      it('should search posts and return results', async () => {
        const searchResults = [
          { post: createMockPost({ title: 'Test Post' }), score: 0.9, highlights: ['test'] },
        ];
        mockPostEngine.searchPosts.mockResolvedValue(searchResults);

        const result = await invokeHandler('posts:search', 'test query');

        expect(mockPostEngine.searchPosts).toHaveBeenCalledWith('test query');
        expect(result).toEqual(searchResults);
      });
    });

    describe('posts:filter', () => {
      it('should filter posts by criteria', async () => {
        const filteredPosts = [createMockPost({ tags: ['javascript'] })];
        mockPostEngine.getPostsFiltered.mockResolvedValue(filteredPosts);

        const filter = { tags: ['javascript'], status: 'published' };
        const result = await invokeHandler('posts:filter', filter);

        expect(mockPostEngine.getPostsFiltered).toHaveBeenCalledWith(filter);
        expect(result).toEqual(filteredPosts);
      });
    });

    describe('posts:getLinksTo', () => {
      it('should return posts linking to a given post', async () => {
        const linkingPosts = [createMockPost({ title: 'Linking Post' })];
        mockPostEngine.getLinksTo.mockResolvedValue(linkingPosts);

        const result = await invokeHandler('posts:getLinksTo', 'target-post-id');

        expect(mockPostEngine.getLinksTo).toHaveBeenCalledWith('target-post-id');
        expect(result).toEqual(linkingPosts);
      });
    });

    describe('posts:getLinkedBy', () => {
      it('should return posts linked by a given post', async () => {
        const linkedPosts = [createMockPost({ title: 'Linked Post' })];
        mockPostEngine.getLinkedBy.mockResolvedValue(linkedPosts);

        const result = await invokeHandler('posts:getLinkedBy', 'source-post-id');

        expect(mockPostEngine.getLinkedBy).toHaveBeenCalledWith('source-post-id');
        expect(result).toEqual(linkedPosts);
      });
    });

    describe('posts:rebuildFromFiles', () => {
      it('should propagate rebuild errors to the caller', async () => {
        const rebuildError = new Error('rebuild failed');
        mockPostEngine.rebuildDatabaseFromFiles.mockRejectedValue(rebuildError);
        mockProjectEngine.getActiveProject.mockResolvedValue(null);

        await expect(invokeHandler('posts:rebuildFromFiles')).rejects.toThrow('rebuild failed');
        expect(mockPostEngine.rebuildDatabaseFromFiles).toHaveBeenCalled();
      });
    });

    describe('posts:reindexText', () => {
      it('should propagate reindex errors to the caller', async () => {
        const reindexError = new Error('post reindex failed');
        mockPostEngine.reindexText.mockRejectedValue(reindexError);
        mockProjectEngine.getActiveProject.mockResolvedValue(null);

        await expect(invokeHandler('posts:reindexText')).rejects.toThrow('post reindex failed');
        expect(mockPostEngine.reindexText).toHaveBeenCalled();
      });
    });
  });

  // ============ Media Handlers ============
  describe('Media Handlers', () => {
    describe('media:import', () => {
      it('should import media from source path', async () => {
        const mockMedia = createMockMedia({ filename: 'photo.jpg' });
        mockMediaEngine.importMedia.mockResolvedValue(mockMedia);

        const result = await invokeHandler('media:import', '/path/to/photo.jpg', { alt: 'A photo' });

        expect(mockMediaEngine.importMedia).toHaveBeenCalledWith('/path/to/photo.jpg', { alt: 'A photo' });
        expect(result).toEqual(mockMedia);
      });
    });

    describe('media:update', () => {
      it('should update media metadata', async () => {
        const updatedMedia = createMockMedia({ id: 'media-1', alt: 'Updated alt' });
        mockMediaEngine.updateMedia.mockResolvedValue(updatedMedia);

        const result = await invokeHandler('media:update', 'media-1', { alt: 'Updated alt' });

        expect(mockMediaEngine.updateMedia).toHaveBeenCalledWith('media-1', { alt: 'Updated alt' });
        expect(result.alt).toBe('Updated alt');
      });
    });

    describe('media:delete', () => {
      it('should delete media by id', async () => {
        mockMediaEngine.deleteMedia.mockResolvedValue(undefined);

        await invokeHandler('media:delete', 'media-to-delete');

        expect(mockMediaEngine.deleteMedia).toHaveBeenCalledWith('media-to-delete');
      });
    });

    describe('media:get', () => {
      it('should return media by id', async () => {
        const mockMedia = createMockMedia({ id: 'media-1' });
        mockMediaEngine.getMedia.mockResolvedValue(mockMedia);

        const result = await invokeHandler('media:get', 'media-1');

        expect(mockMediaEngine.getMedia).toHaveBeenCalledWith('media-1');
        expect(result).toEqual(mockMedia);
      });
    });

    describe('media:getAll', () => {
      it('should return all media items', async () => {
        const mockMediaList = [
          createMockMedia({ filename: 'img1.jpg' }),
          createMockMedia({ filename: 'img2.png' }),
        ];
        mockMediaEngine.getAllMedia.mockResolvedValue(mockMediaList);

        const result = await invokeHandler('media:getAll');

        expect(mockMediaEngine.getAllMedia).toHaveBeenCalled();
        expect(result).toHaveLength(2);
      });
    });

    describe('media:getUrl', () => {
      it('should return absolute media path', async () => {
        mockMediaEngine.getRelativePath.mockResolvedValue('media/2025/01/media-123.jpg');

        const result = await invokeHandler('media:getUrl', 'media-123');

        expect(mockMediaEngine.getRelativePath).toHaveBeenCalledWith('media-123');
        expect(result).toBe('/media/2025/01/media-123.jpg');
      });

      it('should fall back to /media/{id} when relative path is not found', async () => {
        mockMediaEngine.getRelativePath.mockResolvedValue(null);

        const result = await invokeHandler('media:getUrl', 'media-unknown');

        expect(result).toBe('/media/media-unknown');
      });
    });

    describe('media:filter', () => {
      it('should filter media by criteria', async () => {
        const filteredMedia = [createMockMedia({ mimeType: 'image/jpeg' })];
        mockMediaEngine.getMediaFiltered.mockResolvedValue(filteredMedia);

        const filter = { mimeTypes: ['image/jpeg'] };
        const result = await invokeHandler('media:filter', filter);

        expect(mockMediaEngine.getMediaFiltered).toHaveBeenCalledWith(filter);
        expect(result).toEqual(filteredMedia);
      });
    });

    describe('media:search', () => {
      it('should search media by query', async () => {
        const searchResults = [createMockMedia({ alt: 'sunset photo' })];
        mockMediaEngine.searchMedia.mockResolvedValue(searchResults);

        const result = await invokeHandler('media:search', 'sunset');

        expect(mockMediaEngine.searchMedia).toHaveBeenCalledWith('sunset');
        expect(result).toEqual(searchResults);
      });
    });

    describe('media:getByYearMonth', () => {
      it('should return media grouped by year/month', async () => {
        const groupedMedia = {
          '2024': { '01': [createMockMedia()], '02': [createMockMedia()] },
        };
        mockMediaEngine.getMediaByYearMonth.mockResolvedValue(groupedMedia);

        const result = await invokeHandler('media:getByYearMonth');

        expect(mockMediaEngine.getMediaByYearMonth).toHaveBeenCalled();
        expect(result).toEqual(groupedMedia);
      });
    });

    describe('media:getTags', () => {
      it('should return available media tags', async () => {
        const tags = ['landscape', 'portrait', 'macro'];
        mockMediaEngine.getAvailableTags.mockResolvedValue(tags);

        const result = await invokeHandler('media:getTags');

        expect(mockMediaEngine.getAvailableTags).toHaveBeenCalled();
        expect(result).toEqual(tags);
      });
    });

    describe('media:getTagsWithCounts', () => {
      it('should return tags with usage counts', async () => {
        const tagsWithCounts = [
          { tag: 'landscape', count: 10 },
          { tag: 'portrait', count: 5 },
        ];
        mockMediaEngine.getTagsWithCounts.mockResolvedValue(tagsWithCounts);

        const result = await invokeHandler('media:getTagsWithCounts');

        expect(mockMediaEngine.getTagsWithCounts).toHaveBeenCalled();
        expect(result).toEqual(tagsWithCounts);
      });
    });

    describe('media:getThumbnail', () => {
      it('should return thumbnail data URL for media', async () => {
        const thumbnailDataUrl = 'data:image/jpeg;base64,/9j/4AAQ...';
        mockMediaEngine.getThumbnailDataUrl.mockResolvedValue(thumbnailDataUrl);

        const result = await invokeHandler('media:getThumbnail', 'media-1', 'small');

        expect(mockMediaEngine.getThumbnailDataUrl).toHaveBeenCalledWith('media-1', 'small');
        expect(result).toEqual(thumbnailDataUrl);
      });
    });

    describe('media:rebuildFromFiles', () => {
      it('should propagate rebuild errors to the caller', async () => {
        const rebuildError = new Error('media rebuild failed');
        mockMediaEngine.rebuildDatabaseFromFiles.mockRejectedValue(rebuildError);
        mockProjectEngine.getActiveProject.mockResolvedValue(null);

        await expect(invokeHandler('media:rebuildFromFiles')).rejects.toThrow('media rebuild failed');
        expect(mockMediaEngine.rebuildDatabaseFromFiles).toHaveBeenCalled();
      });
    });

    describe('media:reindexText', () => {
      it('should propagate reindex errors to the caller', async () => {
        const reindexError = new Error('media reindex failed');
        mockMediaEngine.reindexText.mockRejectedValue(reindexError);

        await expect(invokeHandler('media:reindexText')).rejects.toThrow('media reindex failed');
        expect(mockMediaEngine.reindexText).toHaveBeenCalled();
      });
    });
  });

  // ============ Meta Handlers ============
  describe('Meta Handlers', () => {
    describe('meta:getTags', () => {
      it('should return all tags from MetaEngine', async () => {
        const tags = ['javascript', 'typescript', 'react'];
        mockMetaEngine.getTags.mockResolvedValue(tags);

        const result = await invokeHandler('meta:getTags');

        expect(mockMetaEngine.getTags).toHaveBeenCalled();
        expect(result).toEqual(tags);
      });
    });

    describe('meta:getCategories', () => {
      it('should return all categories from MetaEngine', async () => {
        const categories = ['Tutorial', 'News', 'Opinion'];
        mockMetaEngine.getCategories.mockResolvedValue(categories);

        const result = await invokeHandler('meta:getCategories');

        expect(mockMetaEngine.getCategories).toHaveBeenCalled();
        expect(result).toEqual(categories);
      });
    });

    describe('meta:addTag', () => {
      it('should add tag and return updated tags list', async () => {
        const updatedTags = ['existing', 'new-tag'];
        mockMetaEngine.addTag.mockResolvedValue(undefined);
        mockMetaEngine.getTags.mockResolvedValue(updatedTags);

        const result = await invokeHandler('meta:addTag', 'new-tag');

        expect(mockMetaEngine.addTag).toHaveBeenCalledWith('new-tag');
        expect(mockMetaEngine.getTags).toHaveBeenCalled();
        expect(result).toEqual(updatedTags);
      });
    });

    describe('meta:removeTag', () => {
      it('should remove tag and return updated tags list', async () => {
        const remainingTags = ['remaining'];
        mockMetaEngine.removeTag.mockResolvedValue(undefined);
        mockMetaEngine.getTags.mockResolvedValue(remainingTags);

        const result = await invokeHandler('meta:removeTag', 'to-remove');

        expect(mockMetaEngine.removeTag).toHaveBeenCalledWith('to-remove');
        expect(result).toEqual(remainingTags);
      });
    });

    describe('meta:addCategory', () => {
      it('should add category and return updated categories list', async () => {
        const updatedCategories = ['Existing', 'New Category'];
        mockMetaEngine.addCategory.mockResolvedValue(undefined);
        mockMetaEngine.getCategories.mockResolvedValue(updatedCategories);

        const result = await invokeHandler('meta:addCategory', 'New Category');

        expect(mockMetaEngine.addCategory).toHaveBeenCalledWith('New Category');
        expect(result).toEqual(updatedCategories);
      });
    });

    describe('meta:removeCategory', () => {
      it('should remove category and return updated categories list', async () => {
        const remainingCategories = ['Remaining'];
        mockMetaEngine.removeCategory.mockResolvedValue(undefined);
        mockMetaEngine.getCategories.mockResolvedValue(remainingCategories);

        const result = await invokeHandler('meta:removeCategory', 'To Remove');

        expect(mockMetaEngine.removeCategory).toHaveBeenCalledWith('To Remove');
        expect(result).toEqual(remainingCategories);
      });
    });

    describe('meta:syncOnStartup', () => {
      it('should sync metadata and return tags, categories, and project metadata', async () => {
        const tags = ['tag1', 'tag2'];
        const categories = ['Cat1', 'Cat2'];
        const metadata = { name: 'My Blog', mainLanguage: 'en' };
        
        mockMetaEngine.syncOnStartup.mockResolvedValue(undefined);
        mockMetaEngine.getTags.mockResolvedValue(tags);
        mockMetaEngine.getCategories.mockResolvedValue(categories);
        mockMetaEngine.getProjectMetadata.mockResolvedValue(metadata);

        const result = await invokeHandler('meta:syncOnStartup');

        expect(mockMetaEngine.syncOnStartup).toHaveBeenCalled();
        expect(result).toEqual({ tags, categories, projectMetadata: metadata });
      });
    });

    describe('meta:getCategories', () => {
      it('should set context and sync before returning categories when uninitialized', async () => {
        const activeProject = createMockProject({ id: 'project-cats', dataPath: '/cats/data' });
        mockProjectEngine.getActiveProject.mockResolvedValue(activeProject);
        mockProjectEngine.getDataDir.mockReturnValue('/resolved/cats-data');
        mockMetaEngine.isInitialized.mockReturnValue(false);
        mockMetaEngine.syncOnStartup.mockResolvedValue(undefined);
        mockMetaEngine.getCategories.mockResolvedValue(['article', 'news', 'travel']);

        const result = await invokeHandler('meta:getCategories');

        expect(mockMetaEngine.setProjectContext).toHaveBeenCalledWith('project-cats', '/resolved/cats-data');
        expect(mockMetaEngine.syncOnStartup).toHaveBeenCalled();
        expect(result).toEqual(['article', 'news', 'travel']);
      });
    });

    describe('meta:getProjectMetadata', () => {
      it('should return project metadata', async () => {
        const metadata = { name: 'Test Blog', description: 'A test blog', mainLanguage: 'de' };
        mockMetaEngine.isInitialized.mockReturnValue(true);
        mockMetaEngine.getProjectMetadata.mockResolvedValue(metadata);

        const result = await invokeHandler('meta:getProjectMetadata');

        expect(mockMetaEngine.getProjectMetadata).toHaveBeenCalled();
        expect(result).toEqual(metadata);
      });

      it('should set meta engine context from active project before reading metadata', async () => {
        const activeProject = createMockProject({ id: 'project-ctx', dataPath: '/ctx/data' });
        const metadata = { name: 'Ctx Blog' };
        mockProjectEngine.getActiveProject.mockResolvedValue(activeProject);
        mockProjectEngine.getDataDir.mockReturnValue('/resolved/ctx-data');
        mockMetaEngine.isInitialized.mockReturnValue(true);
        mockMetaEngine.getProjectMetadata.mockResolvedValue(metadata);

        const result = await invokeHandler('meta:getProjectMetadata');

        expect(mockMetaEngine.setProjectContext).toHaveBeenCalledWith('project-ctx', '/resolved/ctx-data');
        expect(result).toEqual(metadata);
      });

      it('should sync metadata before reading when engine is not initialized', async () => {
        const metadata = { name: 'Test Blog', mainLanguage: 'de', defaultAuthor: 'Max' };
        mockMetaEngine.isInitialized.mockReturnValue(false);
        mockMetaEngine.syncOnStartup.mockResolvedValue(undefined);
        mockMetaEngine.getProjectMetadata.mockResolvedValue(metadata);

        const result = await invokeHandler('meta:getProjectMetadata');

        expect(mockMetaEngine.syncOnStartup).toHaveBeenCalled();
        expect(mockMetaEngine.getProjectMetadata).toHaveBeenCalled();
        expect(result).toEqual(metadata);
      });
    });

    describe('meta:setProjectMetadata', () => {
      it('should set project metadata and return updated metadata', async () => {
        const newMetadata = { name: 'Updated Blog', description: 'Updated description' };
        mockMetaEngine.setProjectMetadata.mockResolvedValue(undefined);
        mockMetaEngine.getProjectMetadata.mockResolvedValue(newMetadata);

        const result = await invokeHandler('meta:setProjectMetadata', newMetadata);

        expect(mockMetaEngine.setProjectMetadata).toHaveBeenCalledWith(newMetadata);
        expect(result).toEqual(newMetadata);
      });
    });

    describe('meta:updateProjectMetadata', () => {
      it('should set meta engine context from active project before updating metadata', async () => {
        const activeProject = createMockProject({ id: 'project-update', dataPath: '/update/data' });
        mockProjectEngine.getActiveProject.mockResolvedValue(activeProject);
        mockProjectEngine.getDataDir.mockReturnValue('/resolved/update-data');
        mockMetaEngine.updateProjectMetadata.mockResolvedValue(undefined);
        const updatedMetadata = { name: 'Updated' };
        mockMetaEngine.getProjectMetadata.mockResolvedValue(updatedMetadata);

        const updates = { defaultAuthor: 'Author Name' };
        const result = await invokeHandler('meta:updateProjectMetadata', updates);

        expect(mockMetaEngine.setProjectContext).toHaveBeenCalledWith('project-update', '/resolved/update-data');
        expect(mockMetaEngine.updateProjectMetadata).toHaveBeenCalledWith(updates);
        expect(result).toEqual(updatedMetadata);
      });
    });
  });

  // ============ Menu Handlers ============
  describe('Menu Handlers', () => {
    describe('menu:get', () => {
      it('loads menu for active project context', async () => {
        const activeProject = createMockProject({ id: 'project-42', dataPath: '/custom/data' });
        const menuDocument = {
          items: [
            { id: 'home', title: 'Home', kind: 'page', pageSlug: 'home', children: [] },
          ],
        };

        mockProjectEngine.getActiveProject.mockResolvedValue(activeProject);
        mockProjectEngine.getDataDir.mockReturnValue('/resolved/project-data');
        mockMenuEngine.getMenu.mockResolvedValue(menuDocument);

        const result = await invokeHandler('menu:get');

        expect(mockMenuEngine.setProjectContext).toHaveBeenCalledWith('project-42', '/resolved/project-data');
        expect(mockMenuEngine.getMenu).toHaveBeenCalled();
        expect(result).toEqual(menuDocument);
      });
    });

    describe('menu:save', () => {
      it('saves menu for active project context', async () => {
        const activeProject = createMockProject({ id: 'project-24', dataPath: '/custom/data' });
        const menuDocument = {
          items: [
            { id: 'docs', title: 'Docs', kind: 'submenu', children: [] },
          ],
        };

        mockProjectEngine.getActiveProject.mockResolvedValue(activeProject);
        mockProjectEngine.getDataDir.mockReturnValue('/resolved/project-data');
        mockMenuEngine.saveMenu.mockResolvedValue(menuDocument);

        const result = await invokeHandler('menu:save', menuDocument);

        expect(mockMenuEngine.setProjectContext).toHaveBeenCalledWith('project-24', '/resolved/project-data');
        expect(mockMenuEngine.saveMenu).toHaveBeenCalledWith(menuDocument);
        expect(result).toEqual(menuDocument);
      });
    });
  });

  // ============ Task Handlers ============
  describe('Task Handlers', () => {
    describe('tasks:getAll', () => {
      it('should return all tasks from TaskManager', async () => {
        const tasks = [
          { id: 'task-1', name: 'Import Media', progress: 50, status: 'running' },
          { id: 'task-2', name: 'Sync', progress: 100, status: 'completed' },
        ];
        mockTaskManager.getAllTasks.mockReturnValue(tasks);

        const result = await invokeHandler('tasks:getAll');

        expect(mockTaskManager.getAllTasks).toHaveBeenCalled();
        expect(result).toEqual(tasks);
      });
    });

    describe('tasks:cancel', () => {
      it('should cancel a task by id', async () => {
        mockTaskManager.cancelTask.mockReturnValue(true);

        const result = await invokeHandler('tasks:cancel', 'task-to-cancel');

        expect(mockTaskManager.cancelTask).toHaveBeenCalledWith('task-to-cancel');
        expect(result).toBe(true);
      });
    });
  });

  // ============ Post-Media Handlers ============
  describe('Post-Media Handlers', () => {
    describe('postMedia:link', () => {
      it('should link media to post', async () => {
        mockPostMediaEngine.linkMediaToPost.mockResolvedValue(undefined);

        await invokeHandler('postMedia:link', 'post-1', 'media-1');

        expect(mockPostMediaEngine.linkMediaToPost).toHaveBeenCalledWith('post-1', 'media-1');
      });
    });

    describe('postMedia:unlink', () => {
      it('should unlink media from post', async () => {
        mockPostMediaEngine.unlinkMediaFromPost.mockResolvedValue(undefined);

        await invokeHandler('postMedia:unlink', 'post-1', 'media-1');

        expect(mockPostMediaEngine.unlinkMediaFromPost).toHaveBeenCalledWith('post-1', 'media-1');
      });
    });

    describe('postMedia:linkMany', () => {
      it('should batch link multiple media to post', async () => {
        const batchResult = { linked: ['media-1', 'media-2'], skipped: [] };
        mockPostMediaEngine.linkManyToPost.mockResolvedValue(batchResult);
        const mediaIds = ['media-1', 'media-2'];

        const result = await invokeHandler('postMedia:linkMany', 'post-1', mediaIds);

        expect(mockPostMediaEngine.linkManyToPost).toHaveBeenCalledWith('post-1', mediaIds);
        expect(result).toEqual(batchResult);
      });
    });

    describe('postMedia:unlinkMany', () => {
      it('should batch unlink multiple media from post', async () => {
        const batchResult = { unlinked: ['media-1', 'media-2'] };
        mockPostMediaEngine.unlinkManyFromPost.mockResolvedValue(batchResult);
        const mediaIds = ['media-1', 'media-2'];

        const result = await invokeHandler('postMedia:unlinkMany', 'post-1', mediaIds);

        expect(mockPostMediaEngine.unlinkManyFromPost).toHaveBeenCalledWith('post-1', mediaIds);
        expect(result).toEqual(batchResult);
      });
    });

    describe('postMedia:getForPost', () => {
      it('should return media linked to a post', async () => {
        const linkedMedia = [createMockMedia(), createMockMedia()];
        mockPostMediaEngine.getLinkedMediaForPost.mockResolvedValue(linkedMedia);

        const result = await invokeHandler('postMedia:getForPost', 'post-1');

        expect(mockPostMediaEngine.getLinkedMediaForPost).toHaveBeenCalledWith('post-1');
        expect(result).toEqual(linkedMedia);
      });
    });

    describe('postMedia:getForMedia', () => {
      it('should return posts linked to a media item', async () => {
        const linkedPosts = [createMockPost(), createMockPost()];
        mockPostMediaEngine.getLinkedPostsForMedia.mockResolvedValue(linkedPosts);

        const result = await invokeHandler('postMedia:getForMedia', 'media-1');

        expect(mockPostMediaEngine.getLinkedPostsForMedia).toHaveBeenCalledWith('media-1');
        expect(result).toEqual(linkedPosts);
      });
    });

    describe('postMedia:reorder', () => {
      it('should reorder media for a post', async () => {
        mockPostMediaEngine.reorderMediaForPost.mockResolvedValue(undefined);
        const newOrder = ['media-2', 'media-1', 'media-3'];

        await invokeHandler('postMedia:reorder', 'post-1', newOrder);

        expect(mockPostMediaEngine.reorderMediaForPost).toHaveBeenCalledWith('post-1', newOrder);
      });
    });

    describe('postMedia:isLinked', () => {
      it('should check if media is linked to post', async () => {
        mockPostMediaEngine.isMediaLinkedToPost.mockResolvedValue(true);

        const result = await invokeHandler('postMedia:isLinked', 'post-1', 'media-1');

        expect(mockPostMediaEngine.isMediaLinkedToPost).toHaveBeenCalledWith('post-1', 'media-1');
        expect(result).toBe(true);
      });
    });
  });

  // ============ App Handlers ============
  describe('App Handlers', () => {
    describe('app:getDataPaths', () => {
      it('should return data paths from database and project', async () => {
        const mockProject = createMockProject({ id: 'active-proj' });
        mockProjectEngine.getActiveProject.mockResolvedValue(mockProject);
        mockProjectEngine.getProjectPaths.mockReturnValue({
          posts: '/mock/data/posts',
          media: '/mock/data/media',
        });

        const result = await invokeHandler('app:getDataPaths');

        expect(mockProjectEngine.getActiveProject).toHaveBeenCalled();
        expect(mockProjectEngine.getProjectPaths).toHaveBeenCalledWith('active-proj', undefined);
        expect(result).toEqual({
          database: '/mock/data/bds.db',
          posts: '/mock/data/posts',
          media: '/mock/data/media',
        });
      });
    });

    describe('app:getDefaultProjectPath', () => {
      it('should return default project base directory', async () => {
        mockProjectEngine.getDefaultProjectBaseDir.mockReturnValue('/Users/test/bds/project-1');

        const result = await invokeHandler('app:getDefaultProjectPath', 'project-1');

        expect(mockProjectEngine.getDefaultProjectBaseDir).toHaveBeenCalledWith('project-1');
        expect(result).toBe('/Users/test/bds/project-1');
      });
    });

    describe('app:getTitleBarMetrics', () => {
      it('should return dynamic macOS title bar left inset from native window button position', async () => {
        const { BrowserWindow } = await import('electron');
        const sender = {};
        const event = { sender };

        vi.mocked(BrowserWindow.fromWebContents).mockReturnValue({
          getWindowButtonPosition: vi.fn(() => ({ x: 14, y: 14 })),
        } as unknown as ReturnType<typeof BrowserWindow.fromWebContents>);

        const result = await invokeHandlerWithEvent(event, 'app:getTitleBarMetrics');

        expect(BrowserWindow.fromWebContents).toHaveBeenCalledWith(sender);
        expect(result).toEqual({
          macosLeftInset: 78,
        });
      });
    });

    describe('app:triggerMenuAction', () => {
      it('should forward custom titlebar action to renderer menu channel', async () => {
        const send = vi.fn();
        const event = { sender: { send } };

        await invokeHandlerWithEvent(event, 'app:triggerMenuAction', 'newPost');

        expect(send).toHaveBeenCalledWith('menu:newPost');
      });

      it('should execute default edit actions on webContents sender', async () => {
        const undo = vi.fn();
        const send = vi.fn();
        const event = { sender: { undo, send } };

        await invokeHandlerWithEvent(event, 'app:triggerMenuAction', 'undo');

        expect(undo).toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
      });

      it('should open detached devtools on sender when action is toggleDevTools and devtools are closed', async () => {
        const openDevTools = vi.fn();
        const isDevToolsOpened = vi.fn(() => false);
        const send = vi.fn();
        const event = { sender: { openDevTools, isDevToolsOpened, send } };

        await invokeHandlerWithEvent(event, 'app:triggerMenuAction', 'toggleDevTools');

        expect(openDevTools).toHaveBeenCalledWith({ mode: 'detach' });
        expect(send).not.toHaveBeenCalled();
      });

      it('should close devtools on sender when action is toggleDevTools and devtools are open', async () => {
        const closeDevTools = vi.fn();
        const isDevToolsOpened = vi.fn(() => true);
        const send = vi.fn();
        const event = { sender: { closeDevTools, isDevToolsOpened, send } };

        await invokeHandlerWithEvent(event, 'app:triggerMenuAction', 'toggleDevTools');

        expect(closeDevTools).toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
      });

      it('should quit the application when action is quit', async () => {
        const { app } = await import('electron');
        const send = vi.fn();
        const event = { sender: { send } };

        await invokeHandlerWithEvent(event, 'app:triggerMenuAction', 'quit');

        expect(app.quit).toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
      });

      it('should open repository URL when action is viewOnGitHub', async () => {
        const { shell } = await import('electron');
        const send = vi.fn();
        const event = { sender: { send } };

        await invokeHandlerWithEvent(event, 'app:triggerMenuAction', 'viewOnGitHub');

        expect(shell.openExternal).toHaveBeenCalledWith('https://github.com/rfc1437/bDS');
        expect(send).not.toHaveBeenCalled();
      });

      it('should open preview root URL when action is openInBrowser', async () => {
        const { shell } = await import('electron');
        const send = vi.fn();
        const event = { sender: { send } };

        await invokeHandlerWithEvent(event, 'app:triggerMenuAction', 'openInBrowser');

        expect(shell.openExternal).toHaveBeenCalledWith('http://localhost:4123/');
        expect(send).not.toHaveBeenCalled();
      });

      it('should open the data folder when action is openDataFolder', async () => {
        const { shell } = await import('electron');
        const send = vi.fn();
        const event = { sender: { send } };

        await invokeHandlerWithEvent(event, 'app:triggerMenuAction', 'openDataFolder');

        expect(shell.openPath).toHaveBeenCalledWith('/mock/data');
        expect(send).not.toHaveBeenCalled();
      });

      it('should forward previewPost to renderer menu channel', async () => {
        const send = vi.fn();
        const event = { sender: { send } };

        await invokeHandlerWithEvent(event, 'app:triggerMenuAction', 'previewPost');

        expect(send).toHaveBeenCalledWith('menu:previewPost');
      });

      it('should reload sender when action is reload', async () => {
        const reload = vi.fn();
        const send = vi.fn();
        const event = { sender: { reload, send } };

        await invokeHandlerWithEvent(event, 'app:triggerMenuAction', 'reload');

        expect(reload).toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
      });

      it('should force reload sender when action is forceReload', async () => {
        const reloadIgnoringCache = vi.fn();
        const send = vi.fn();
        const event = { sender: { reloadIgnoringCache, send } };

        await invokeHandlerWithEvent(event, 'app:triggerMenuAction', 'forceReload');

        expect(reloadIgnoringCache).toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
      });

      it('should reset zoom level when action is resetZoom', async () => {
        const setZoomLevel = vi.fn();
        const send = vi.fn();
        const event = { sender: { setZoomLevel, send } };

        await invokeHandlerWithEvent(event, 'app:triggerMenuAction', 'resetZoom');

        expect(setZoomLevel).toHaveBeenCalledWith(0);
        expect(send).not.toHaveBeenCalled();
      });

      it('should zoom in when action is zoomIn', async () => {
        const getZoomLevel = vi.fn(() => 0);
        const setZoomLevel = vi.fn();
        const send = vi.fn();
        const event = { sender: { getZoomLevel, setZoomLevel, send } };

        await invokeHandlerWithEvent(event, 'app:triggerMenuAction', 'zoomIn');

        expect(setZoomLevel).toHaveBeenCalledWith(0.5);
        expect(send).not.toHaveBeenCalled();
      });

      it('should zoom out when action is zoomOut', async () => {
        const getZoomLevel = vi.fn(() => 0.5);
        const setZoomLevel = vi.fn();
        const send = vi.fn();
        const event = { sender: { getZoomLevel, setZoomLevel, send } };

        await invokeHandlerWithEvent(event, 'app:triggerMenuAction', 'zoomOut');

        expect(setZoomLevel).toHaveBeenCalledWith(0);
        expect(send).not.toHaveBeenCalled();
      });

      it('should toggle fullscreen on owner window when action is toggleFullScreen', async () => {
        const { BrowserWindow } = await import('electron');
        const sender = { send: vi.fn() };
        const ownerWindow = {
          isFullScreen: vi.fn(() => false),
          setFullScreen: vi.fn(),
        };

        vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(ownerWindow as unknown as ReturnType<typeof BrowserWindow.fromWebContents>);

        await invokeHandlerWithEvent({ sender }, 'app:triggerMenuAction', 'toggleFullScreen');

        expect(BrowserWindow.fromWebContents).toHaveBeenCalledWith(sender);
        expect(ownerWindow.setFullScreen).toHaveBeenCalledWith(true);
      });
    });
  });

  // ============ Blog Handlers ============
  describe('Blog Handlers', () => {
    describe('blog:generateSitemap', () => {
      it('should start section tasks without waiting for core completion', async () => {
        const mockProject = createMockProject({
          id: 'test-project',
          dataPath: '/mock/data',
        });
        mockProjectEngine.getActiveProject.mockResolvedValue(mockProject);
        mockProjectEngine.getDataDir.mockReturnValue('/mock/data/dir');
        mockMetaEngine.getProjectMetadata.mockResolvedValue({
          name: 'Test Project',
          publicUrl: 'https://blog.example.com',
        });

        let resolveCoreTask: ((value: any) => void) | null = null;
        const startedTaskNames: string[] = [];
        const completedResult = {
          path: '/mock/data/dir/html/sitemap.xml',
          urlCount: 1,
          postCount: 0,
          feedPostCount: 0,
          tagCount: 0,
          categoryCount: 0,
          archiveCount: 0,
          pagesGenerated: 1,
          feeds: {
            rssPath: '/mock/data/dir/html/rss.xml',
            atomPath: '/mock/data/dir/html/atom.xml',
          },
          changed: {
            sitemap: true,
            rss: true,
            atom: true,
          },
        };

        mockTaskManager.runTask.mockImplementation((task: any) => {
          startedTaskNames.push(task.name);
          if (task.name === 'Render Site Core') {
            return new Promise((resolve) => {
              resolveCoreTask = resolve;
            });
          }
          return Promise.resolve(completedResult);
        });

        const generationPromise = invokeHandler('blog:generateSitemap');

        for (let index = 0; index < 20 && startedTaskNames.length === 0; index += 1) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }

        expect(startedTaskNames).toContain('Render Site Core');
        expect(startedTaskNames).toContain('Render Single Posts');
        expect(startedTaskNames).toContain('Render Category Archives');
        expect(startedTaskNames).toContain('Render Tag Archives');
        expect(startedTaskNames).toContain('Render Date Archives');

        expect(resolveCoreTask).toBeTruthy();
        resolveCoreTask?.(completedResult);

        await generationPromise;
      });

      it('should create separate background tasks for single, category, tag, and date rendering', async () => {
        const mockProject = createMockProject({
          id: 'test-project',
          dataPath: '/mock/data',
        });
        mockProjectEngine.getActiveProject.mockResolvedValue(mockProject);
        mockProjectEngine.getDataDir.mockReturnValue('/mock/data/dir');
        mockMetaEngine.getProjectMetadata.mockResolvedValue({
          name: 'Test Project',
          publicUrl: 'https://blog.example.com',
        });

        mockPostEngine.getPostsFiltered.mockImplementation(async (filter: { status?: string }) => {
          if (filter.status === 'published') {
            return [
              {
                id: 'post-1',
                projectId: 'test-project',
                title: 'Test Post',
                slug: 'test-post',
                excerpt: '',
                content: '# Test',
                status: 'published',
                createdAt: new Date('2024-01-15T10:00:00Z'),
                updatedAt: new Date('2024-01-20T15:00:00Z'),
                publishedAt: new Date('2024-01-15T10:00:00Z'),
                tags: ['tag1'],
                categories: ['category1'],
              },
            ];
          }
          if (filter.status === 'draft') {
            return [];
          }
          return [];
        });
        mockPostEngine.getPublishedVersion.mockResolvedValue(null);

        const { writeFile, mkdir } = await import('fs/promises');
        vi.mocked(mkdir).mockResolvedValue(undefined);
        vi.mocked(writeFile).mockResolvedValue(undefined);

        mockTaskManager.runTask.mockImplementation(async (task: any) => {
          return task.execute(vi.fn());
        });

        await invokeHandler('blog:generateSitemap');

        const names = mockTaskManager.runTask.mock.calls.map((call: any[]) => call[0]?.name);
        expect(names).toContain('Render Site Core');
        expect(names).toContain('Render Single Posts');
        expect(names).toContain('Render Category Archives');
        expect(names).toContain('Render Tag Archives');
        expect(names).toContain('Render Date Archives');
      });

      it('should call taskManager.runTask with sitemap generation task', async () => {
        const mockProject = createMockProject({ 
          id: 'test-project',
          dataPath: '/mock/data'
        });
        mockProjectEngine.getActiveProject.mockResolvedValue(mockProject);
        mockProjectEngine.getDataDir.mockReturnValue('/mock/data/dir');
        mockMetaEngine.getProjectMetadata.mockResolvedValue({
          name: 'Test Project',
          publicUrl: 'https://blog.example.com',
        });

        // Mock post engine to return published posts and drafts
        const mockPublishedPosts = [
          {
            id: 'post-1',
            projectId: 'test-project',
            slug: 'test-post',
            status: 'published',
            createdAt: new Date('2024-01-15T10:00:00Z'),
            updatedAt: new Date('2024-01-20T15:00:00Z'),
            tags: ['tag1', 'tag2'],
            categories: ['category1'],
          },
          {
            id: 'post-2',
            projectId: 'test-project',
            slug: 'another-post',
            status: 'published',
            createdAt: new Date('2024-02-10T12:00:00Z'),
            updatedAt: new Date('2024-02-12T09:00:00Z'),
            tags: ['tag2', 'tag3'],
            categories: ['category2'],
          },
        ];

        const mockDraftPosts = [
          {
            id: 'post-3',
            projectId: 'test-project',
            slug: 'draft-post',
            status: 'draft',
            createdAt: new Date('2024-03-01T08:00:00Z'),
            updatedAt: new Date('2024-03-01T08:00:00Z'),
            tags: [],
            categories: [],
          },
        ];

        mockPostEngine.getPostsFiltered.mockImplementation(async (filter: { status?: string }) => {
          if (filter.status === 'published') {
            return mockPublishedPosts;
          }
          if (filter.status === 'draft') {
            return mockDraftPosts;
          }
          return [];
        });
        mockPostEngine.getPublishedVersion.mockResolvedValue(null);

        // Mock fs.writeFile
        const { writeFile, mkdir } = await import('fs/promises');
        vi.mocked(mkdir).mockResolvedValue(undefined);
        vi.mocked(writeFile).mockResolvedValue(undefined);

        // Mock taskManager.runTask to execute the task immediately
        mockTaskManager.runTask.mockImplementation(async (task: any) => {
          const onProgress = vi.fn();
          return await task.execute(onProgress);
        });

        const result = await invokeHandler('blog:generateSitemap');

        // Verify taskManager.runTask was called for core task orchestration
        expect(mockTaskManager.runTask).toHaveBeenCalledWith(
          expect.objectContaining({
            id: expect.stringMatching(/^site-render-core-\d+$/),
            name: 'Render Site Core',
            execute: expect.any(Function),
          })
        );

        // Verify result contains expected data
        expect(result).toEqual(
          expect.objectContaining({
            path: expect.stringContaining('sitemap.xml'),
            postCount: 2, // Only published posts, not drafts
            tagCount: 3, // tag1, tag2, tag3
            categoryCount: 2, // category1, category2
          })
        );

        // Verify fs operations
        expect(mkdir).toHaveBeenCalledWith('/mock/data/dir/html', { recursive: true });
        expect(writeFile).toHaveBeenCalledWith(
          expect.stringContaining('sitemap.xml'),
          expect.stringContaining('<?xml version="1.0" encoding="UTF-8"?>'),
          'utf-8'
        );
      });

      it('should generate rss and atom feeds with newest maxPostsPerPage published snapshots', async () => {
        const mockProject = createMockProject({
          id: 'test-project',
          dataPath: '/mock/data',
        });
        mockProjectEngine.getActiveProject.mockResolvedValue(mockProject);
        mockProjectEngine.getDataDir.mockReturnValue('/mock/data/dir');
        mockMetaEngine.getProjectMetadata.mockResolvedValue({
          name: 'Test Project',
          description: 'Test Description',
          publicUrl: 'https://blog.example.com',
          maxPostsPerPage: 1,
        });

        mockPostEngine.getPostsFiltered.mockImplementation(async (filter: { status?: string }) => {
          if (filter.status === 'published') {
            return [
              {
                id: 'post-new',
                projectId: 'test-project',
                title: 'Newest <Post>',
                slug: 'newest-post',
                excerpt: '',
                content: '',
                status: 'published',
                createdAt: new Date('2024-03-05T10:00:00Z'),
                updatedAt: new Date('2024-03-05T11:00:00Z'),
                publishedAt: new Date('2024-03-05T10:00:00Z'),
                tags: ['tag-one'],
                categories: ['category-one'],
              },
              {
                id: 'post-old',
                projectId: 'test-project',
                title: 'Old Post',
                slug: 'old-post',
                excerpt: '',
                content: '',
                status: 'published',
                createdAt: new Date('2024-02-01T10:00:00Z'),
                updatedAt: new Date('2024-02-01T11:00:00Z'),
                publishedAt: new Date('2024-02-01T10:00:00Z'),
                tags: ['tag-two'],
                categories: ['category-two'],
              },
            ];
          }
          if (filter.status === 'draft') {
            return [];
          }
          return [];
        });
        mockPostEngine.getPublishedVersion.mockImplementation(async (id: string) => {
          if (id !== 'post-new') return null;
          return {
            id: 'post-new',
            projectId: 'test-project',
            title: 'Newest <Post>',
            slug: 'newest-post',
            excerpt: undefined,
            content: 'First paragraph with <tag> & symbol.\n\nSecond paragraph.',
            status: 'published',
            author: 'Author A',
            createdAt: new Date('2024-03-05T10:00:00Z'),
            updatedAt: new Date('2024-03-05T11:00:00Z'),
            publishedAt: new Date('2024-03-05T10:00:00Z'),
            tags: ['tag-one'],
            categories: ['category-one'],
          };
        });

        const { writeFile, mkdir } = await import('fs/promises');
        vi.mocked(mkdir).mockResolvedValue(undefined);
        vi.mocked(writeFile).mockResolvedValue(undefined);

        mockTaskManager.runTask.mockImplementation(async (task: any) => {
          const onProgress = vi.fn();
          return await task.execute(onProgress);
        });

        await invokeHandler('blog:generateSitemap');

        const writtenFiles = vi.mocked(writeFile).mock.calls.map(([filePath, body]) => ({
          filePath: filePath as string,
          body: body as string,
        }));
        const rss = writtenFiles.find((entry) => entry.filePath.endsWith('/rss.xml'))?.body;
        const atom = writtenFiles.find((entry) => entry.filePath.endsWith('/atom.xml'))?.body;

        expect(rss).toBeTruthy();
        expect(atom).toBeTruthy();
        expect(rss).toContain('newest-post');
        expect(rss).not.toContain('old-post');
        expect(atom).toContain('newest-post');
        expect(atom).not.toContain('old-post');
        expect(rss).toContain('Newest &lt;Post&gt;');
        expect(rss).toContain('First paragraph with &lt;tag&gt; &amp; symbol.');
        expect(atom).toContain('<category term="tag-one"');
        expect(atom).toContain('<category term="category-one"');
      });

      it('should skip rewriting sitemap and feeds when content hash is unchanged', async () => {
        const mockProject = createMockProject({
          id: 'test-project',
          dataPath: '/mock/data',
        });
        mockProjectEngine.getActiveProject.mockResolvedValue(mockProject);
        mockProjectEngine.getDataDir.mockReturnValue('/mock/data/dir');
        mockMetaEngine.getProjectMetadata.mockResolvedValue({
          name: 'Test Project',
          publicUrl: 'https://blog.example.com',
          maxPostsPerPage: 5,
        });

        mockPostEngine.getPostsFiltered.mockImplementation(async (filter: { status?: string }) => {
          if (filter.status === 'published') {
            return [
              {
                id: 'post-1',
                projectId: 'test-project',
                title: 'Hash test',
                slug: 'hash-test',
                excerpt: 'Hash excerpt',
                content: '',
                status: 'published',
                createdAt: new Date('2024-01-15T10:00:00Z'),
                updatedAt: new Date('2024-01-20T15:00:00Z'),
                publishedAt: new Date('2024-01-15T10:00:00Z'),
                tags: [],
                categories: [],
              },
            ];
          }
          if (filter.status === 'draft') {
            return [];
          }
          return [];
        });
        mockPostEngine.getPublishedVersion.mockImplementation(async () => ({
          id: 'post-1',
          projectId: 'test-project',
          title: 'Hash test',
          slug: 'hash-test',
          excerpt: 'Hash excerpt',
          content: 'Hash content',
          status: 'published',
          createdAt: new Date('2024-01-15T10:00:00Z'),
          updatedAt: new Date('2024-01-20T15:00:00Z'),
          publishedAt: new Date('2024-01-15T10:00:00Z'),
          tags: [],
          categories: [],
        }));

        const { writeFile, mkdir } = await import('fs/promises');
        vi.mocked(mkdir).mockResolvedValue(undefined);
        vi.mocked(writeFile).mockResolvedValue(undefined);

        mockTaskManager.runTask.mockImplementation(async (task: any) => {
          const onProgress = vi.fn();
          return await task.execute(onProgress);
        });

        await invokeHandler('blog:generateSitemap');
        vi.mocked(writeFile).mockClear();
        await invokeHandler('blog:generateSitemap');

        // Assets are always copied, but sitemap/feeds/pages should not be rewritten
        const xmlWrites = vi.mocked(writeFile).mock.calls.filter(
          ([filePath]) => typeof filePath === 'string' && (filePath.endsWith('.xml') || filePath.endsWith('index.html')),
        );
        expect(xmlWrites).toHaveLength(0);
      });

      it('should throw error when no active project', async () => {
        mockProjectEngine.getActiveProject.mockResolvedValue(null);

        await expect(invokeHandler('blog:generateSitemap')).rejects.toThrow('No active project');

        expect(mockTaskManager.runTask).not.toHaveBeenCalled();
      });

      it('should filter out draft and archived posts from sitemap', async () => {
        const mockProject = createMockProject({ 
          id: 'test-project',
          dataPath: '/mock/data'
        });
        mockProjectEngine.getActiveProject.mockResolvedValue(mockProject);
        mockProjectEngine.getDataDir.mockReturnValue('/mock/data/dir');
        mockMetaEngine.getProjectMetadata.mockResolvedValue({
          name: 'Test Project',
          publicUrl: 'https://blog.example.com',
        });

        const mockPublishedPosts = [
          {
            id: 'post-1',
            projectId: 'test-project',
            slug: 'published-post',
            status: 'published',
            createdAt: new Date('2024-01-15T10:00:00Z'),
            updatedAt: new Date('2024-01-20T15:00:00Z'),
            tags: [],
            categories: [],
          },
        ];

        const mockDraftPosts = [
          {
            id: 'post-2',
            projectId: 'test-project',
            slug: 'draft-post',
            status: 'draft',
            createdAt: new Date('2024-02-10T12:00:00Z'),
            updatedAt: new Date('2024-02-12T09:00:00Z'),
            tags: [],
            categories: [],
          },
        ];

        const mockArchivedPosts = [
          {
            id: 'post-3',
            projectId: 'test-project',
            slug: 'archived-post',
            status: 'archived',
            createdAt: new Date('2024-03-01T08:00:00Z'),
            updatedAt: new Date('2024-03-01T08:00:00Z'),
            tags: [],
            categories: [],
          },
        ];

        mockPostEngine.getPostsFiltered.mockImplementation(async (filter: { status?: string }) => {
          if (filter.status === 'published') {
            return mockPublishedPosts;
          }
          if (filter.status === 'draft') {
            return mockDraftPosts;
          }
          if (filter.status === 'archived') {
            return mockArchivedPosts;
          }
          return [];
        });
        mockPostEngine.getPublishedVersion.mockResolvedValue(null);

        const { writeFile, mkdir } = await import('fs/promises');
        vi.mocked(mkdir).mockResolvedValue(undefined);
        vi.mocked(writeFile).mockResolvedValue(undefined);

        mockTaskManager.runTask.mockImplementation(async (task: any) => {
          const onProgress = vi.fn();
          return await task.execute(onProgress);
        });

        const result = await invokeHandler('blog:generateSitemap');

        // Verify only published posts are included
        expect(result.postCount).toBe(1);
        
        // Verify the sitemap XML only contains the published post
        const writeFileCall = vi.mocked(writeFile).mock.calls[0];
        const sitemapXml = writeFileCall[1] as string;
        
        expect(sitemapXml).toContain('published-post');
        expect(sitemapXml).not.toContain('draft-post');
        expect(sitemapXml).not.toContain('archived-post');
      });

      it('should include published snapshot for drafts with a former published version', async () => {
        const mockProject = createMockProject({
          id: 'test-project',
          dataPath: '/mock/data',
        });
        mockProjectEngine.getActiveProject.mockResolvedValue(mockProject);
        mockProjectEngine.getDataDir.mockReturnValue('/mock/data/dir');
        mockMetaEngine.getProjectMetadata.mockResolvedValue({
          name: 'Test Project',
          publicUrl: 'https://blog.example.com',
        });

        const publishedPost = {
          id: 'post-published',
          projectId: 'test-project',
          slug: 'published-post',
          status: 'published',
          createdAt: new Date('2024-01-15T10:00:00Z'),
          updatedAt: new Date('2024-01-20T15:00:00Z'),
          tags: [],
          categories: [],
        };

        const neverPublishedDraft = {
          id: 'post-draft-new',
          projectId: 'test-project',
          slug: 'draft-no-published-version',
          status: 'draft',
          createdAt: new Date('2024-02-10T12:00:00Z'),
          updatedAt: new Date('2024-02-12T09:00:00Z'),
          tags: [],
          categories: [],
        };

        const draftWithPublishedVersion = {
          id: 'post-draft-with-published',
          projectId: 'test-project',
          slug: 'draft-current-slug',
          status: 'draft',
          createdAt: new Date('2024-03-01T08:00:00Z'),
          updatedAt: new Date('2024-03-03T08:00:00Z'),
          tags: [],
          categories: [],
        };

        mockPostEngine.getPostsFiltered.mockImplementation(async (filter: { status?: string }) => {
          if (filter.status === 'published') {
            return [publishedPost];
          }
          if (filter.status === 'draft') {
            return [neverPublishedDraft, draftWithPublishedVersion];
          }
          return [];
        });

        mockPostEngine.getPublishedVersion.mockImplementation(async (id: string) => {
          if (id !== 'post-draft-with-published') {
            return null;
          }

          return {
            id,
            projectId: 'test-project',
            slug: 'published-snapshot-slug',
            status: 'published',
            createdAt: new Date('2023-10-05T07:00:00Z'),
            updatedAt: new Date('2023-10-20T09:00:00Z'),
            tags: [],
            categories: [],
          };
        });

        const { writeFile, mkdir } = await import('fs/promises');
        vi.mocked(mkdir).mockResolvedValue(undefined);
        vi.mocked(writeFile).mockResolvedValue(undefined);

        mockTaskManager.runTask.mockImplementation(async (task: any) => {
          const onProgress = vi.fn();
          return await task.execute(onProgress);
        });

        const result = await invokeHandler('blog:generateSitemap');

        expect(mockPostEngine.getPostsFiltered).toHaveBeenCalledWith({ status: 'published' });
        expect(mockPostEngine.getPostsFiltered).toHaveBeenCalledWith({ status: 'draft' });
        expect(mockPostEngine.getPublishedVersion).toHaveBeenCalledWith('post-draft-new');
        expect(mockPostEngine.getPublishedVersion).toHaveBeenCalledWith('post-draft-with-published');

        expect(result.postCount).toBe(2);

        const writeFileCall = vi.mocked(writeFile).mock.calls[0];
        const sitemapXml = writeFileCall[1] as string;

        expect(sitemapXml).toContain('published-post');
        expect(sitemapXml).toContain('published-snapshot-slug');
        expect(sitemapXml).not.toContain('draft-no-published-version');
        expect(sitemapXml).not.toContain('draft-current-slug');
      });

      it('should use canonical path helpers for post URLs', async () => {
        const mockProject = createMockProject({ 
          id: 'test-project',
          dataPath: '/mock/data'
        });
        mockProjectEngine.getActiveProject.mockResolvedValue(mockProject);
        mockProjectEngine.getDataDir.mockReturnValue('/mock/data/dir');
        mockMetaEngine.getProjectMetadata.mockResolvedValue({
          name: 'Test Project',
          publicUrl: 'https://blog.example.com',
        });

        const mockPublishedPosts = [
          {
            id: 'post-1',
            projectId: 'test-project',
            slug: 'my-test-post',
            status: 'published',
            createdAt: new Date('2024-03-25T10:00:00Z'),
            updatedAt: new Date('2024-03-26T15:00:00Z'),
            tags: [],
            categories: [],
          },
        ];
        mockPostEngine.getPostsFiltered.mockImplementation(async (filter: { status?: string }) => {
          if (filter.status === 'published') {
            return mockPublishedPosts;
          }
          if (filter.status === 'draft') {
            return [];
          }
          return [];
        });
        mockPostEngine.getPublishedVersion.mockResolvedValue(null);

        const { writeFile, mkdir } = await import('fs/promises');
        vi.mocked(mkdir).mockResolvedValue(undefined);
        vi.mocked(writeFile).mockResolvedValue(undefined);

        mockTaskManager.runTask.mockImplementation(async (task: any) => {
          const onProgress = vi.fn();
          return await task.execute(onProgress);
        });

        await invokeHandler('blog:generateSitemap');

        const writeFileCall = vi.mocked(writeFile).mock.calls[0];
        const sitemapXml = writeFileCall[1] as string;
        
        // Verify canonical URL format: /YYYY/MM/DD/slug
        expect(sitemapXml).toContain('https://blog.example.com/2024/03/25/my-test-post');
      });

      it('should show setup dialog and abort when project public URL is missing', async () => {
        const mockProject = createMockProject({
          id: 'test-project',
          dataPath: '/mock/data',
        });
        mockProjectEngine.getActiveProject.mockResolvedValue(mockProject);
        mockProjectEngine.getDataDir.mockReturnValue('/mock/data/dir');
        mockMetaEngine.getProjectMetadata.mockResolvedValue({
          name: 'Test Project',
        });

        const { dialog } = await import('electron');

        await expect(invokeHandler('blog:generateSitemap')).rejects.toThrow('Project public URL is not configured');

        expect(dialog.showMessageBox).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'warning',
            title: 'Public URL Required',
          }),
        );
        expect(mockTaskManager.runTask).not.toHaveBeenCalled();
      });

      it('should use project public URL from metadata as sitemap base URL', async () => {
        const mockProject = createMockProject({
          id: 'test-project',
          dataPath: '/mock/data',
        });
        mockProjectEngine.getActiveProject.mockResolvedValue(mockProject);
        mockProjectEngine.getDataDir.mockReturnValue('/mock/data/dir');
        mockMetaEngine.getProjectMetadata.mockResolvedValue({
          name: 'Test Project',
          publicUrl: 'https://blog.example.com/',
        });

        mockPostEngine.getPostsFiltered.mockImplementation(async (filter: { status?: string }) => {
          if (filter.status === 'published') {
            return [
              {
                id: 'post-1',
                projectId: 'test-project',
                slug: 'public-url-test-post',
                status: 'published',
                createdAt: new Date('2024-03-25T10:00:00Z'),
                updatedAt: new Date('2024-03-26T15:00:00Z'),
                tags: [],
                categories: [],
              },
            ];
          }
          if (filter.status === 'draft') {
            return [];
          }
          return [];
        });
        mockPostEngine.getPublishedVersion.mockResolvedValue(null);

        const { writeFile, mkdir } = await import('fs/promises');
        vi.mocked(mkdir).mockResolvedValue(undefined);
        vi.mocked(writeFile).mockResolvedValue(undefined);

        mockTaskManager.runTask.mockImplementation(async (task: any) => {
          const onProgress = vi.fn();
          return await task.execute(onProgress);
        });

        await invokeHandler('blog:generateSitemap');

        const writeFileCall = vi.mocked(writeFile).mock.calls[0];
        const sitemapXml = writeFileCall[1] as string;

        expect(sitemapXml).toContain('https://blog.example.com/2024/03/25/public-url-test-post');
        expect(sitemapXml).not.toContain('http://127.0.0.1:4123/2024/03/25/public-url-test-post');
      });
    });

    describe('blog:validateSite', () => {
      it('should generate sitemap-only validation report against html folder', async () => {
        const mockProject = createMockProject({
          id: 'test-project',
          dataPath: '/mock/data',
        });
        mockProjectEngine.getActiveProject.mockResolvedValue(mockProject);
        mockProjectEngine.getDataDir.mockReturnValue('/mock/data/dir');
        mockMetaEngine.getProjectMetadata.mockResolvedValue({
          name: 'Test Project',
          publicUrl: 'https://blog.example.com',
        });

        mockPostEngine.getPostsFiltered.mockImplementation(async (filter: { status?: string }) => {
          if (filter.status === 'published') {
            return [
              {
                id: 'post-1',
                projectId: 'test-project',
                title: 'Test Post',
                slug: 'test-post',
                excerpt: '',
                content: '# Test',
                status: 'published',
                createdAt: new Date('2024-01-15T10:00:00Z'),
                updatedAt: new Date('2024-01-20T15:00:00Z'),
                publishedAt: new Date('2024-01-15T10:00:00Z'),
                tags: ['tag1'],
                categories: ['category1'],
              },
            ];
          }
          if (filter.status === 'draft') {
            return [];
          }
          return [];
        });
        mockPostEngine.getPublishedVersion.mockResolvedValue(null);

        const { writeFile, mkdir, readdir } = await import('fs/promises');
        vi.mocked(mkdir).mockResolvedValue(undefined);
        vi.mocked(writeFile).mockResolvedValue(undefined);
        vi.mocked(readdir).mockResolvedValue([] as never);

        const result = await invokeHandler('blog:validateSite');

        expect(result).toEqual(expect.objectContaining({
          missingUrlPaths: expect.any(Array),
          extraUrlPaths: expect.any(Array),
        }));
        expect(writeFile).toHaveBeenCalledWith(
          expect.stringContaining('sitemap.xml'),
          expect.stringContaining('<?xml version="1.0" encoding="UTF-8"?>'),
          'utf-8',
        );
      });

      it('should run validation via taskManager.runTask', async () => {
        const mockProject = createMockProject({ id: 'test-project', dataPath: '/mock/data' });
        mockProjectEngine.getActiveProject.mockResolvedValue(mockProject);
        mockProjectEngine.getDataDir.mockReturnValue('/mock/data/dir');
        mockMetaEngine.getProjectMetadata.mockResolvedValue({
          name: 'Test Project',
          publicUrl: 'https://blog.example.com',
        });

        mockPostEngine.getPostsFiltered.mockResolvedValue([]);
        mockPostEngine.getPublishedVersion.mockResolvedValue(null);

        const { mkdir, writeFile, readdir } = await import('fs/promises');
        vi.mocked(mkdir).mockResolvedValue(undefined);
        vi.mocked(writeFile).mockResolvedValue(undefined);
        vi.mocked(readdir).mockResolvedValue([] as never);

        mockTaskManager.runTask.mockImplementation(async (task: any) => {
          return task.execute(vi.fn());
        });

        await invokeHandler('blog:validateSite');

        expect(mockTaskManager.runTask).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'Validate Site',
            execute: expect.any(Function),
          }),
        );
      });
    });

    describe('blog:applyValidation', () => {
      it('should run apply via taskManager.runTask', async () => {
        const mockProject = createMockProject({ id: 'test-project', dataPath: '/mock/data' });
        mockProjectEngine.getActiveProject.mockResolvedValue(mockProject);
        mockProjectEngine.getDataDir.mockReturnValue('/mock/data/dir');
        mockMetaEngine.getProjectMetadata.mockResolvedValue({
          name: 'Test Project',
          publicUrl: 'https://blog.example.com',
        });

        mockPostEngine.getPostsFiltered.mockResolvedValue([]);
        mockPostEngine.getPublishedVersion.mockResolvedValue(null);

        const { mkdir, writeFile, readdir } = await import('fs/promises');
        vi.mocked(mkdir).mockResolvedValue(undefined);
        vi.mocked(writeFile).mockResolvedValue(undefined);
        vi.mocked(readdir).mockResolvedValue([] as never);

        mockTaskManager.runTask.mockImplementation(async (task: any) => {
          return task.execute(vi.fn());
        });

        await invokeHandler('blog:applyValidation', {
          sitemapPath: '/mock/data/dir/html/sitemap.xml',
          sitemapChanged: false,
          missingUrlPaths: ['/category/news'],
          extraUrlPaths: ['/stale'],
          expectedUrlCount: 1,
          existingHtmlUrlCount: 1,
        });

        expect(mockTaskManager.runTask).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'Apply Site Validation',
            execute: expect.any(Function),
          }),
        );
      });
    });
  });

  // ============ Script Handlers ============
  describe('Script Handlers', () => {
    describe('scripts:create', () => {
      it('should call ScriptEngine.createScript with payload', async () => {
        const payload = {
          title: 'Render Hero',
          kind: 'macro',
          content: 'def render(context):\n  return {"html":"<h1>Hi</h1>"}',
        };
        const expected = {
          id: 'script-1',
          projectId: 'default',
          ...payload,
          slug: 'render-hero',
          entrypoint: 'render',
          enabled: true,
          version: 1,
          filePath: '/mock/userData/projects/default/scripts/render-hero.py',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        mockScriptEngine.createScript.mockResolvedValue(expected);

        const result = await invokeHandler('scripts:create', payload);

        expect(mockScriptEngine.createScript).toHaveBeenCalledWith(payload);
        expect(result).toEqual(expected);
      });
    });

    describe('scripts:update', () => {
      it('should call ScriptEngine.updateScript with id and updates', async () => {
        const updates = { title: 'Updated Script', content: 'print("updated")' };
        const expected = {
          id: 'script-1',
          projectId: 'default',
          slug: 'updated-script',
          title: 'Updated Script',
          kind: 'utility',
          entrypoint: 'render',
          enabled: true,
          version: 2,
          filePath: '/mock/userData/projects/default/scripts/updated-script.py',
          content: 'print("updated")',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        mockScriptEngine.updateScript.mockResolvedValue(expected);

        const result = await invokeHandler('scripts:update', 'script-1', updates);

        expect(mockScriptEngine.updateScript).toHaveBeenCalledWith('script-1', updates);
        expect(result).toEqual(expected);
      });
    });

    describe('scripts:delete', () => {
      it('should call ScriptEngine.deleteScript with id', async () => {
        mockScriptEngine.deleteScript.mockResolvedValue(true);

        const result = await invokeHandler('scripts:delete', 'script-1');

        expect(mockScriptEngine.deleteScript).toHaveBeenCalledWith('script-1');
        expect(result).toBe(true);
      });
    });

    describe('scripts:get', () => {
      it('should call ScriptEngine.getScript with id', async () => {
        const expected = {
          id: 'script-1',
          projectId: 'default',
          slug: 'render-hero',
          title: 'Render Hero',
          kind: 'macro',
          entrypoint: 'render',
          enabled: true,
          version: 1,
          filePath: '/mock/userData/projects/default/scripts/render-hero.py',
          content: 'def render(context):\n  return {"html":"<h1>Hi</h1>"}',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        mockScriptEngine.getScript.mockResolvedValue(expected);

        const result = await invokeHandler('scripts:get', 'script-1');

        expect(mockScriptEngine.getScript).toHaveBeenCalledWith('script-1');
        expect(result).toEqual(expected);
      });
    });

    describe('scripts:getAll', () => {
      it('should call ScriptEngine.getAllScripts', async () => {
        const expected = [{ id: 'script-1' }, { id: 'script-2' }];
        mockScriptEngine.getAllScripts.mockResolvedValue(expected);

        const result = await invokeHandler('scripts:getAll');

        expect(mockScriptEngine.getAllScripts).toHaveBeenCalled();
        expect(result).toEqual(expected);
      });
    });

    describe('scripts:rebuildFromFiles', () => {
      it('should set project context and trigger ScriptEngine rebuild', async () => {
        mockProjectEngine.getActiveProject.mockResolvedValue({
          id: 'project-1',
          dataPath: '/external/data',
        });
        mockProjectEngine.getDataDir.mockReturnValue('/resolved/project-data');
        mockScriptEngine.rebuildDatabaseFromFiles.mockResolvedValue(undefined);

        const result = await invokeHandler('scripts:rebuildFromFiles');

        expect(mockScriptEngine.setProjectContext).toHaveBeenCalledWith('project-1', '/resolved/project-data');
        expect(mockScriptEngine.rebuildDatabaseFromFiles).toHaveBeenCalled();
        expect(result).toBe(true);
      });
    });
  });

  // ============ Template Handlers ============
  describe('Template Handlers', () => {
    describe('templates:create', () => {
      it('should call TemplateEngine.createTemplate with payload', async () => {
        const payload = {
          title: 'Custom Post',
          kind: 'post',
          content: '<html>{{ post.title }}</html>',
        };
        const expected = {
          id: 'template-1',
          projectId: 'default',
          ...payload,
          slug: 'custom_post',
          enabled: true,
          version: 1,
          filePath: '/mock/userData/projects/default/templates/custom_post.liquid',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        mockTemplateEngine.createTemplate.mockResolvedValue(expected);

        const result = await invokeHandler('templates:create', payload);

        expect(mockTemplateEngine.createTemplate).toHaveBeenCalledWith(payload);
        expect(result).toEqual(expected);
      });
    });

    describe('templates:update', () => {
      it('should call TemplateEngine.updateTemplate with id and updates', async () => {
        const updates = { title: 'Updated Template', content: '<html>{{ post.content }}</html>' };
        const expected = {
          id: 'template-1',
          projectId: 'default',
          slug: 'updated_template',
          title: 'Updated Template',
          kind: 'post',
          enabled: true,
          version: 2,
          filePath: '/mock/userData/projects/default/templates/updated_template.liquid',
          content: '<html>{{ post.content }}</html>',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        mockTemplateEngine.updateTemplate.mockResolvedValue(expected);

        const result = await invokeHandler('templates:update', 'template-1', updates);

        expect(mockTemplateEngine.updateTemplate).toHaveBeenCalledWith('template-1', updates);
        expect(result).toEqual(expected);
      });
    });

    describe('templates:delete', () => {
      it('should call TemplateEngine.deleteTemplate with id', async () => {
        mockTemplateEngine.deleteTemplate.mockResolvedValue({ deleted: true });

        const result = await invokeHandler('templates:delete', 'template-1');

        expect(mockTemplateEngine.deleteTemplate).toHaveBeenCalledWith('template-1', undefined);
        expect(result).toEqual({ deleted: true });
      });

      it('should forward force option to TemplateEngine.deleteTemplate', async () => {
        mockTemplateEngine.deleteTemplate.mockResolvedValue({ deleted: true });

        const result = await invokeHandler('templates:delete', 'template-1', { force: true });

        expect(mockTemplateEngine.deleteTemplate).toHaveBeenCalledWith('template-1', { force: true });
        expect(result).toEqual({ deleted: true });
      });
    });

    describe('templates:get', () => {
      it('should call TemplateEngine.getTemplate with id', async () => {
        const expected = {
          id: 'template-1',
          projectId: 'default',
          slug: 'custom_post',
          title: 'Custom Post',
          kind: 'post',
          enabled: true,
          version: 1,
          filePath: '/mock/userData/projects/default/templates/custom_post.liquid',
          content: '<html>{{ post.title }}</html>',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        mockTemplateEngine.getTemplate.mockResolvedValue(expected);

        const result = await invokeHandler('templates:get', 'template-1');

        expect(mockTemplateEngine.getTemplate).toHaveBeenCalledWith('template-1');
        expect(result).toEqual(expected);
      });
    });

    describe('templates:getAll', () => {
      it('should call TemplateEngine.getAllTemplates', async () => {
        const expected = [{ id: 'template-1' }, { id: 'template-2' }];
        mockTemplateEngine.getAllTemplates.mockResolvedValue(expected);

        const result = await invokeHandler('templates:getAll');

        expect(mockTemplateEngine.getAllTemplates).toHaveBeenCalled();
        expect(result).toEqual(expected);
      });
    });

    describe('templates:getEnabledByKind', () => {
      it('should call TemplateEngine.getEnabledTemplatesByKind with kind', async () => {
        const expected = [{ id: 'template-1', kind: 'post' }];
        mockTemplateEngine.getEnabledTemplatesByKind.mockResolvedValue(expected);

        const result = await invokeHandler('templates:getEnabledByKind', 'post');

        expect(mockTemplateEngine.getEnabledTemplatesByKind).toHaveBeenCalledWith('post');
        expect(result).toEqual(expected);
      });
    });

    describe('templates:validate', () => {
      it('should call TemplateEngine.validateTemplate with content', async () => {
        const expected = { valid: true, errors: [] };
        mockTemplateEngine.validateTemplate.mockResolvedValue(expected);

        const result = await invokeHandler('templates:validate', '<html>{{ post.title }}</html>');

        expect(mockTemplateEngine.validateTemplate).toHaveBeenCalledWith('<html>{{ post.title }}</html>');
        expect(result).toEqual(expected);
      });
    });

    describe('templates:rebuildFromFiles', () => {
      it('should set project context and trigger TemplateEngine rebuild', async () => {
        mockProjectEngine.getActiveProject.mockResolvedValue({
          id: 'project-1',
          dataPath: '/external/data',
        });
        mockProjectEngine.getDataDir.mockReturnValue('/resolved/project-data');
        mockTemplateEngine.rebuildDatabaseFromFiles.mockResolvedValue(undefined);

        const result = await invokeHandler('templates:rebuildFromFiles');

        expect(mockTemplateEngine.setProjectContext).toHaveBeenCalledWith('project-1', '/resolved/project-data');
        expect(mockTemplateEngine.rebuildDatabaseFromFiles).toHaveBeenCalled();
        expect(result).toBe(true);
      });
    });
  });

  // ============ Error Handling ============
  describe('Error Handling', () => {
    it('should silently handle "Database is closing" errors', async () => {
      const dbClosingError = new Error('Database is closing');
      mockProjectEngine.getAllProjects.mockRejectedValue(dbClosingError);

      const result = await invokeHandler('projects:getAll');

      expect(result).toBeNull();
    });

    it('should re-throw other errors', async () => {
      const otherError = new Error('Something went wrong');
      mockProjectEngine.getAllProjects.mockRejectedValue(otherError);

      await expect(invokeHandler('projects:getAll')).rejects.toThrow('Something went wrong');
    });
  });
});
