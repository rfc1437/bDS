import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { invokeMainProcessPythonApi, ENGINE_MAP } from '../../src/main/engine/mainProcessPythonApiInvoker';

// ── Mock engines ───────────────────────────────────────────────────

const mockPostEngine: Record<string, ReturnType<typeof vi.fn>> = {
  getPost: vi.fn().mockResolvedValue({ id: 'p1', title: 'Test' }),
  createPost: vi.fn().mockResolvedValue({ id: 'p2' }),
  getAllPosts: vi.fn().mockResolvedValue({ items: [], hasMore: false, total: 0 }),
  searchPosts: vi.fn().mockResolvedValue([]),
  getPostsByStatus: vi.fn().mockResolvedValue([]),
  updatePost: vi.fn().mockResolvedValue(null),
  deletePost: vi.fn().mockResolvedValue(true),
  publishPost: vi.fn().mockResolvedValue(null),
  discardChanges: vi.fn().mockResolvedValue(null),
  hasPublishedVersion: vi.fn().mockResolvedValue(false),
  rebuildDatabaseFromFiles: vi.fn().mockResolvedValue(undefined),
  reindexText: vi.fn().mockResolvedValue(undefined),
  getPostsFiltered: vi.fn().mockResolvedValue([]),
  getAvailableTags: vi.fn().mockResolvedValue([]),
  getAvailableCategories: vi.fn().mockResolvedValue([]),
  getPostsByYearMonth: vi.fn().mockResolvedValue([]),
  getDashboardStats: vi.fn().mockResolvedValue({}),
  getTagsWithCounts: vi.fn().mockResolvedValue([]),
  getCategoriesWithCounts: vi.fn().mockResolvedValue([]),
  getLinksTo: vi.fn().mockResolvedValue([]),
  getLinkedBy: vi.fn().mockResolvedValue([]),
  rebuildAllPostLinks: vi.fn().mockResolvedValue(undefined),
  isSlugAvailable: vi.fn().mockResolvedValue(true),
  generateUniqueSlug: vi.fn().mockResolvedValue('slug-1'),
};

const mockScriptEngine: Record<string, ReturnType<typeof vi.fn>> = {
  createScript: vi.fn().mockResolvedValue({ id: 's1' }),
  updateScript: vi.fn().mockResolvedValue(null),
  deleteScript: vi.fn().mockResolvedValue(true),
  getScript: vi.fn().mockResolvedValue(null),
  getAllScripts: vi.fn().mockResolvedValue([]),
  rebuildDatabaseFromFiles: vi.fn().mockResolvedValue(undefined),
};

const mockTagEngine: Record<string, ReturnType<typeof vi.fn>> = {
  getAllTags: vi.fn().mockResolvedValue([]),
  getTagsWithCounts: vi.fn().mockResolvedValue([]),
  getTag: vi.fn().mockResolvedValue(null),
  getTagByName: vi.fn().mockResolvedValue(null),
  createTag: vi.fn().mockResolvedValue({ id: 't1' }),
  updateTag: vi.fn().mockResolvedValue(null),
  deleteTag: vi.fn().mockResolvedValue({ deleted: true }),
  mergeTags: vi.fn().mockResolvedValue({ merged: 0 }),
  renameTag: vi.fn().mockResolvedValue({ renamed: true }),
  getPostsWithTag: vi.fn().mockResolvedValue([]),
  syncTagsFromPosts: vi.fn().mockResolvedValue({ created: 0, deleted: 0 }),
};

const mockMediaEngine: Record<string, ReturnType<typeof vi.fn>> = {
  importMedia: vi.fn().mockResolvedValue({ id: 'm1' }),
  updateMedia: vi.fn().mockResolvedValue(null),
  replaceMediaFile: vi.fn().mockResolvedValue(null),
  deleteMedia: vi.fn().mockResolvedValue(true),
  getMedia: vi.fn().mockResolvedValue(null),
  getRelativePath: vi.fn().mockResolvedValue(null),
  getAllMedia: vi.fn().mockResolvedValue([]),
  rebuildDatabaseFromFiles: vi.fn().mockResolvedValue(undefined),
  reindexText: vi.fn().mockResolvedValue(undefined),
  getThumbnailDataUrl: vi.fn().mockResolvedValue(null),
  generateThumbnails: vi.fn().mockResolvedValue(null),
  regenerateMissingThumbnails: vi.fn().mockResolvedValue({ processed: 0, generated: 0, failed: 0 }),
  getMediaFiltered: vi.fn().mockResolvedValue([]),
  searchMedia: vi.fn().mockResolvedValue([]),
  getMediaByYearMonth: vi.fn().mockResolvedValue([]),
  getAvailableTags: vi.fn().mockResolvedValue([]),
  getTagsWithCounts: vi.fn().mockResolvedValue([]),
};

const mockMetaEngine: Record<string, ReturnType<typeof vi.fn>> = {
  getTags: vi.fn().mockResolvedValue([]),
  getCategories: vi.fn().mockResolvedValue([]),
  addTag: vi.fn().mockResolvedValue([]),
  removeTag: vi.fn().mockResolvedValue([]),
  addCategory: vi.fn().mockResolvedValue([]),
  removeCategory: vi.fn().mockResolvedValue([]),
  syncOnStartup: vi.fn().mockResolvedValue({ tags: [], categories: [], projectMetadata: null }),
  getProjectMetadata: vi.fn().mockResolvedValue(null),
  setProjectMetadata: vi.fn().mockResolvedValue(null),
  updateProjectMetadata: vi.fn().mockResolvedValue(null),
};

const mockProjectEngine: Record<string, ReturnType<typeof vi.fn>> = {
  createProject: vi.fn().mockResolvedValue({ id: 'prj1' }),
  updateProject: vi.fn().mockResolvedValue(null),
  deleteProject: vi.fn().mockResolvedValue(true),
  deleteProjectWithData: vi.fn().mockResolvedValue(true),
  getProject: vi.fn().mockResolvedValue(null),
  getAllProjects: vi.fn().mockResolvedValue([]),
  getActiveProject: vi.fn().mockResolvedValue(null),
  setActiveProject: vi.fn().mockResolvedValue(null),
};

const mockTaskManager: Record<string, ReturnType<typeof vi.fn>> = {
  getAllTasks: vi.fn().mockResolvedValue([]),
  getRunningTasks: vi.fn().mockResolvedValue([]),
  cancelTask: vi.fn().mockResolvedValue(true),
  clearCompletedTasks: vi.fn().mockResolvedValue(undefined),
};

const mockGitApiAdapter: Record<string, ReturnType<typeof vi.fn>> = {
  checkAvailability: vi.fn().mockResolvedValue({ gitFound: true }),
  getRepoState: vi.fn().mockResolvedValue({ isRepo: true }),
  getStatus: vi.fn().mockResolvedValue({ files: [], counts: {} }),
  getHistory: vi.fn().mockResolvedValue([]),
  getRemoteState: vi.fn().mockResolvedValue({ hasUpstream: false }),
  fetch: vi.fn().mockResolvedValue({ success: true }),
  pull: vi.fn().mockResolvedValue({ success: true }),
  push: vi.fn().mockResolvedValue({ success: true }),
  commitAll: vi.fn().mockResolvedValue({ success: true }),
};

const mockPublishApiAdapter: Record<string, ReturnType<typeof vi.fn>> = {
  uploadSite: vi.fn().mockResolvedValue({ htmlFilesUploaded: 0, thumbnailFilesUploaded: 0, mediaFilesUploaded: 0, filesSkipped: 0 }),
};

const mockAppApiAdapter: Record<string, ReturnType<typeof vi.fn>> = {
  getDataPaths: vi.fn().mockResolvedValue({ database: '/db', posts: '/posts', media: '/media' }),
  getSystemLanguage: vi.fn().mockResolvedValue('en-US'),
  getDefaultProjectPath: vi.fn().mockResolvedValue('/path'),
  readProjectMetadata: vi.fn().mockResolvedValue(null),
};

// ── Override ENGINE_MAP for testing ────────────────────────────────

const originalEngineMap: Record<string, typeof ENGINE_MAP[string]> = {};

describe('invokeMainProcessPythonApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Save originals and inject test engines
    for (const key of Object.keys(ENGINE_MAP)) {
      originalEngineMap[key] = ENGINE_MAP[key];
    }
    ENGINE_MAP.posts = () => mockPostEngine as Record<string, (...args: unknown[]) => unknown>;
    ENGINE_MAP.media = () => mockMediaEngine as Record<string, (...args: unknown[]) => unknown>;
    ENGINE_MAP.projects = () => mockProjectEngine as Record<string, (...args: unknown[]) => unknown>;
    ENGINE_MAP.meta = () => mockMetaEngine as Record<string, (...args: unknown[]) => unknown>;
    ENGINE_MAP.tags = () => mockTagEngine as Record<string, (...args: unknown[]) => unknown>;
    ENGINE_MAP.scripts = () => mockScriptEngine as Record<string, (...args: unknown[]) => unknown>;
    ENGINE_MAP.tasks = () => mockTaskManager as Record<string, (...args: unknown[]) => unknown>;
    ENGINE_MAP.sync = () => mockGitApiAdapter as Record<string, (...args: unknown[]) => unknown>;
    ENGINE_MAP.publish = () => mockPublishApiAdapter as Record<string, (...args: unknown[]) => unknown>;
    ENGINE_MAP.app = () => mockAppApiAdapter as Record<string, (...args: unknown[]) => unknown>;
  });

  afterEach(() => {
    // Restore originals
    for (const [key, value] of Object.entries(originalEngineMap)) {
      ENGINE_MAP[key] = value;
    }
  });

  // ── Method routing ───────────────────────────────────────────────

  describe('method routing', () => {
    it('routes posts.get to PostEngine.getPost', async () => {
      await invokeMainProcessPythonApi('posts.get', { postId: 'p1' });
      expect(mockPostEngine.getPost).toHaveBeenCalledWith('p1');
    });

    it('routes posts.create to PostEngine.createPost', async () => {
      const data = { title: 'New', content: 'body' };
      await invokeMainProcessPythonApi('posts.create', { data });
      expect(mockPostEngine.createPost).toHaveBeenCalledWith(data);
    });

    it('routes posts.search to PostEngine.searchPosts', async () => {
      await invokeMainProcessPythonApi('posts.search', { query: 'hello' });
      expect(mockPostEngine.searchPosts).toHaveBeenCalledWith('hello');
    });

    it('routes scripts.create to ScriptEngine.createScript', async () => {
      const data = { title: 'My Script', kind: 'macro', content: 'print(1)' };
      await invokeMainProcessPythonApi('scripts.create', { data });
      expect(mockScriptEngine.createScript).toHaveBeenCalledWith(data);
    });

    it('routes scripts.delete to ScriptEngine.deleteScript', async () => {
      await invokeMainProcessPythonApi('scripts.delete', { id: 's1' });
      expect(mockScriptEngine.deleteScript).toHaveBeenCalledWith('s1');
    });

    it('routes tags.getAll to TagEngine.getAllTags', async () => {
      await invokeMainProcessPythonApi('tags.getAll', {});
      expect(mockTagEngine.getAllTags).toHaveBeenCalledWith();
    });

    it('routes tasks.cancel to TaskManager.cancelTask', async () => {
      await invokeMainProcessPythonApi('tasks.cancel', { taskId: 't1' });
      expect(mockTaskManager.cancelTask).toHaveBeenCalledWith('t1');
    });

    it('routes meta.getProjectMetadata to MetaEngine.getProjectMetadata', async () => {
      await invokeMainProcessPythonApi('meta.getProjectMetadata', {});
      expect(mockMetaEngine.getProjectMetadata).toHaveBeenCalledWith();
    });

    it('routes media.get to MediaEngine.getMedia', async () => {
      await invokeMainProcessPythonApi('media.get', { id: 'm1' });
      expect(mockMediaEngine.getMedia).toHaveBeenCalledWith('m1');
    });

    it('routes projects.getActive to ProjectEngine.getActiveProject', async () => {
      await invokeMainProcessPythonApi('projects.getActive', {});
      expect(mockProjectEngine.getActiveProject).toHaveBeenCalledWith();
    });

    it('passes optional params as undefined when omitted', async () => {
      await invokeMainProcessPythonApi('posts.getAll', {});
      expect(mockPostEngine.getAllPosts).toHaveBeenCalledWith(undefined);
    });

    it('passes optional params when provided', async () => {
      const opts = { limit: 10, offset: 5 };
      await invokeMainProcessPythonApi('posts.getAll', { options: opts });
      expect(mockPostEngine.getAllPosts).toHaveBeenCalledWith(opts);
    });

    it('returns engine method result', async () => {
      mockPostEngine.getPost.mockResolvedValueOnce({ id: 'p1', title: 'Found' });
      const result = await invokeMainProcessPythonApi('posts.get', { postId: 'p1' });
      expect(result).toEqual({ id: 'p1', title: 'Found' });
    });

    // ── Sync (git) routing ────────────────────────────────────────

    it('routes sync.checkAvailability to GitApiAdapter.checkAvailability', async () => {
      await invokeMainProcessPythonApi('sync.checkAvailability', {});
      expect(mockGitApiAdapter.checkAvailability).toHaveBeenCalledWith();
    });

    it('routes sync.getRepoState to GitApiAdapter.getRepoState', async () => {
      await invokeMainProcessPythonApi('sync.getRepoState', {});
      expect(mockGitApiAdapter.getRepoState).toHaveBeenCalledWith();
    });

    it('routes sync.commitAll to GitApiAdapter.commitAll with message', async () => {
      await invokeMainProcessPythonApi('sync.commitAll', { message: 'update files' });
      expect(mockGitApiAdapter.commitAll).toHaveBeenCalledWith('update files');
    });

    it('routes sync.getHistory with optional limit', async () => {
      await invokeMainProcessPythonApi('sync.getHistory', { limit: 5 });
      expect(mockGitApiAdapter.getHistory).toHaveBeenCalledWith(5);
    });

    // ── Publish routing ────────────────────────────────────────

    it('routes publish.uploadSite to PublishApiAdapter.uploadSite', async () => {
      const creds = { sshHost: 'example.com', sshUser: 'deploy', sshRemotePath: '/var/www', sshMode: 'rsync' };
      await invokeMainProcessPythonApi('publish.uploadSite', { credentials: creds });
      expect(mockPublishApiAdapter.uploadSite).toHaveBeenCalledWith(creds);
    });

    // ── App routing ────────────────────────────────────────

    it('routes app.getDataPaths to AppApiAdapter.getDataPaths', async () => {
      await invokeMainProcessPythonApi('app.getDataPaths', {});
      expect(mockAppApiAdapter.getDataPaths).toHaveBeenCalledWith();
    });

    it('routes app.getDefaultProjectPath to AppApiAdapter', async () => {
      await invokeMainProcessPythonApi('app.getDefaultProjectPath', { projectId: 'p1' });
      expect(mockAppApiAdapter.getDefaultProjectPath).toHaveBeenCalledWith('p1');
    });

    it('routes app.readProjectMetadata to AppApiAdapter', async () => {
      await invokeMainProcessPythonApi('app.readProjectMetadata', { folderPath: '/some/path' });
      expect(mockAppApiAdapter.readProjectMetadata).toHaveBeenCalledWith('/some/path');
    });

    it('routes app.getSystemLanguage to AppApiAdapter', async () => {
      await invokeMainProcessPythonApi('app.getSystemLanguage', {});
      expect(mockAppApiAdapter.getSystemLanguage).toHaveBeenCalledWith();
    });
  });

  // ── Unknown/unsupported methods ──────────────────────────────────

  describe('unknown methods', () => {
    it('rejects completely unknown methods', async () => {
      await expect(invokeMainProcessPythonApi('foo.bar', {})).rejects.toThrow(
        'Unsupported Python API method: foo.bar',
      );
    });

    it('rejects unknown member on known namespace', async () => {
      await expect(invokeMainProcessPythonApi('posts.unknown', {})).rejects.toThrow(
        'Unsupported Python API method: posts.unknown',
      );
    });

    it('rejects when engine method does not exist', async () => {
      ENGINE_MAP.posts = () => ({ noSuchMethod: vi.fn() }) as unknown as Record<string, (...args: unknown[]) => unknown>;
      await expect(invokeMainProcessPythonApi('posts.get', { postId: 'p1' })).rejects.toThrow(
        "engine method 'getPost' not found",
      );
    });
  });

  // ── Blocked/unsafe methods ───────────────────────────────────────

  describe('blocked unsafe methods', () => {
    // Note: media.importDialog and media.replaceFileDialog are NOT in the API contract,
    // so they are rejected at contract lookup before reaching the blocked-methods check.
    // They are listed in unsafeMethods as defense in depth.
    const unsafeMethods = [
      'media.getFilePath',
      'app.openFolder',
      'app.selectFolder',
      'app.showItemInFolder',
      'app.getTitleBarMetrics',
      'app.notifyRendererReady',
      'app.triggerMenuAction',
      'app.getBlogmarkBookmarklet',
      'app.copyToClipboard',
      'app.setPreviewPostTarget',
    ];

    for (const method of unsafeMethods) {
      it(`rejects blocked method: ${method}`, async () => {
        await expect(invokeMainProcessPythonApi(method, {})).rejects.toThrow(
          `Python API method '${method}' is not available in main-process macro context`,
        );
      });
    }
  });

  // ── Parameter validation ─────────────────────────────────────────

  describe('parameter validation', () => {
    it('rejects missing required string param', async () => {
      await expect(invokeMainProcessPythonApi('posts.get', {})).rejects.toThrow(
        'posts.get requires string arg postId',
      );
    });

    it('rejects non-string for required string param', async () => {
      await expect(invokeMainProcessPythonApi('posts.get', { postId: 42 })).rejects.toThrow(
        'posts.get requires string arg postId',
      );
    });

    it('rejects empty string for required string param', async () => {
      await expect(invokeMainProcessPythonApi('posts.get', { postId: '' })).rejects.toThrow(
        'posts.get requires string arg postId',
      );
    });

    it('rejects non-object for required object param', async () => {
      await expect(invokeMainProcessPythonApi('posts.create', { data: 'not-obj' })).rejects.toThrow(
        'posts.create requires object arg data',
      );
    });

    it('rejects array for required object param', async () => {
      await expect(invokeMainProcessPythonApi('posts.create', { data: [1, 2] })).rejects.toThrow(
        'posts.create requires object arg data',
      );
    });

    it('rejects non-array for required array param', async () => {
      await expect(invokeMainProcessPythonApi('tags.merge', { sourceTagIds: 'not-arr', targetTagId: 't1' })).rejects.toThrow(
        'tags.merge requires array arg sourceTagIds',
      );
    });

    it('accepts valid array param', async () => {
      await invokeMainProcessPythonApi('tags.merge', { sourceTagIds: ['a', 'b'], targetTagId: 't1' });
      expect(mockTagEngine.mergeTags).toHaveBeenCalledWith(['a', 'b'], 't1');
    });

    it('allows optional params to be omitted', async () => {
      await invokeMainProcessPythonApi('posts.isSlugAvailable', { slug: 'test' });
      expect(mockPostEngine.isSlugAvailable).toHaveBeenCalledWith('test', undefined);
    });

    it('handles null args gracefully (normalizes to empty record)', async () => {
      await expect(
        invokeMainProcessPythonApi('posts.get', null as unknown as Record<string, unknown>),
      ).rejects.toThrow('posts.get requires string arg postId');
    });
  });
});
