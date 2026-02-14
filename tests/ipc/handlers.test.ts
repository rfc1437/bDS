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
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => Promise<any>) => {
      registeredHandlers.set(channel, handler);
    }),
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
  },
  shell: {
    openPath: vi.fn(),
    showItemInFolder: vi.fn(),
  },
}));

// Create mock engines with EventEmitter-like `on` method
const mockPostEngine = {
  on: vi.fn(),
  setProjectContext: vi.fn(),
  setSearchLanguage: vi.fn(),
  createPost: vi.fn(),
  updatePost: vi.fn(),
  deletePost: vi.fn(),
  getPost: vi.fn(),
  getAllPosts: vi.fn(),
  getPostsByStatus: vi.fn(),
  publishPost: vi.fn(),
  discardChanges: vi.fn(),
  hasPublishedVersion: vi.fn(),
  isSlugAvailable: vi.fn(),
  generateUniqueSlug: vi.fn(),
  rebuildDatabaseFromFiles: vi.fn(),
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
  syncOnStartup: vi.fn(),
  getTags: vi.fn(),
  getCategories: vi.fn(),
  addTag: vi.fn(),
  removeTag: vi.fn(),
  addCategory: vi.fn(),
  removeCategory: vi.fn(),
  getProjectMetadata: vi.fn(),
  setProjectMetadata: vi.fn(),
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

const mockPostMediaEngine = {
  on: vi.fn(),
  setProjectContext: vi.fn(),
  linkMediaToPost: vi.fn(),
  unlinkMediaFromPost: vi.fn(),
  getLinkedMediaForPost: vi.fn(),
  getLinkedPostsForMedia: vi.fn(),
  reorderMediaForPost: vi.fn(),
  isMediaLinkedToPost: vi.fn(),
  rebuildFromSidecars: vi.fn(),
};

const mockTaskManager = {
  getAllTasks: vi.fn(),
  cancelTask: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
};

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

vi.mock('../../src/main/engine/PostMediaEngine', () => ({
  getPostMediaEngine: vi.fn(() => mockPostMediaEngine),
}));

vi.mock('../../src/main/engine/TaskManager', () => ({
  taskManager: mockTaskManager,
  TaskProgress: {},
}));

vi.mock('../../src/main/database', () => ({
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

describe('IPC Handlers', () => {
  beforeEach(async () => {
    // Clear all mocks
    vi.clearAllMocks();
    registeredHandlers.clear();
    resetMockCounters();
    
    // Import and register handlers fresh for each test
    const { registerIpcHandlers } = await import('../../src/main/ipc/handlers');
    registerIpcHandlers();
  });

  afterEach(() => {
    vi.resetModules();
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
      it('should return bds-media protocol URL', async () => {
        const result = await invokeHandler('media:getUrl', 'media-123');

        expect(result).toBe('bds-media://media-123');
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

    describe('meta:getProjectMetadata', () => {
      it('should return project metadata', async () => {
        const metadata = { name: 'Test Blog', description: 'A test blog', mainLanguage: 'de' };
        mockMetaEngine.getProjectMetadata.mockResolvedValue(metadata);

        const result = await invokeHandler('meta:getProjectMetadata');

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
