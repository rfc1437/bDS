import { ipcMain, dialog, shell } from 'electron';
import { eq } from 'drizzle-orm';
import { getPostEngine, PostData, PostFilter } from '../engine/PostEngine';
import { getMediaEngine, MediaData } from '../engine/MediaEngine';
import { getSyncEngine, SyncConfig, SyncDirection } from '../engine/SyncEngine';
import { getProjectEngine, ProjectData } from '../engine/ProjectEngine';
import { taskManager, TaskProgress } from '../engine/TaskManager';
import { getDatabase } from '../database';
import { media } from '../database/schema';

export function registerIpcHandlers(): void {
  // ============ Project Handlers ============

  ipcMain.handle('projects:create', async (_, data: { name: string; description?: string; slug?: string }) => {
    const engine = getProjectEngine();
    return engine.createProject(data);
  });

  ipcMain.handle('projects:update', async (_, id: string, data: Partial<ProjectData>) => {
    const engine = getProjectEngine();
    return engine.updateProject(id, data);
  });

  ipcMain.handle('projects:delete', async (_, id: string) => {
    const engine = getProjectEngine();
    return engine.deleteProject(id);
  });

  ipcMain.handle('projects:get', async (_, id: string) => {
    const engine = getProjectEngine();
    return engine.getProject(id);
  });

  ipcMain.handle('projects:getAll', async () => {
    const engine = getProjectEngine();
    return engine.getAllProjects();
  });

  ipcMain.handle('projects:getActive', async () => {
    const engine = getProjectEngine();
    return engine.getActiveProject();
  });

  ipcMain.handle('projects:setActive', async (_, id: string) => {
    const projectEngine = getProjectEngine();
    const project = await projectEngine.setActiveProject(id);
    
    // Update post and media engines to use the new project context
    if (project) {
      const postEngine = getPostEngine();
      const mediaEngine = getMediaEngine();
      postEngine.setProjectContext(project.id);
      mediaEngine.setProjectContext(project.id);
    }
    
    return project;
  });

  // ============ Post Handlers ============
  
  ipcMain.handle('posts:create', async (_, data: Partial<PostData>) => {
    const engine = getPostEngine();
    return engine.createPost(data);
  });

  ipcMain.handle('posts:isSlugAvailable', async (_, slug: string, excludePostId?: string) => {
    const engine = getPostEngine();
    return engine.isSlugAvailable(slug, excludePostId);
  });

  ipcMain.handle('posts:generateUniqueSlug', async (_, title: string, excludePostId?: string) => {
    const engine = getPostEngine();
    return engine.generateUniqueSlug(title, excludePostId);
  });

  ipcMain.handle('posts:update', async (_, id: string, data: Partial<PostData>) => {
    const engine = getPostEngine();
    return engine.updatePost(id, data);
  });

  ipcMain.handle('posts:delete', async (_, id: string) => {
    const engine = getPostEngine();
    return engine.deletePost(id);
  });

  ipcMain.handle('posts:get', async (_, id: string) => {
    const engine = getPostEngine();
    return engine.getPost(id);
  });

  ipcMain.handle('posts:getAll', async () => {
    const engine = getPostEngine();
    return engine.getAllPosts();
  });

  ipcMain.handle('posts:getByStatus', async (_, status: 'draft' | 'published' | 'archived') => {
    const engine = getPostEngine();
    return engine.getPostsByStatus(status);
  });

  ipcMain.handle('posts:publish', async (_, id: string) => {
    const engine = getPostEngine();
    return engine.publishPost(id);
  });

  ipcMain.handle('posts:unpublish', async (_, id: string) => {
    const engine = getPostEngine();
    return engine.unpublishPost(id);
  });

  ipcMain.handle('posts:discard', async (_, id: string) => {
    const engine = getPostEngine();
    return engine.discardChanges(id);
  });

  ipcMain.handle('posts:hasPublishedVersion', async (_, id: string) => {
    const engine = getPostEngine();
    return engine.hasPublishedVersion(id);
  });

  ipcMain.handle('posts:rebuildFromFiles', async () => {
    const engine = getPostEngine();
    return engine.rebuildDatabaseFromFiles();
  });

  ipcMain.handle('posts:search', async (_, query: string) => {
    const engine = getPostEngine();
    return engine.searchPosts(query);
  });

  ipcMain.handle('posts:filter', async (_, filter: PostFilter) => {
    const engine = getPostEngine();
    return engine.getPostsFiltered(filter);
  });

  ipcMain.handle('posts:getTags', async () => {
    const engine = getPostEngine();
    return engine.getAvailableTags();
  });

  ipcMain.handle('posts:getCategories', async () => {
    const engine = getPostEngine();
    return engine.getAvailableCategories();
  });

  ipcMain.handle('posts:getByYearMonth', async () => {
    const engine = getPostEngine();
    return engine.getPostsByYearMonth();
  });

  ipcMain.handle('posts:getLinksTo', async (_, id: string) => {
    const engine = getPostEngine();
    return engine.getLinksTo(id);
  });

  ipcMain.handle('posts:getLinkedBy', async (_, id: string) => {
    const engine = getPostEngine();
    return engine.getLinkedBy(id);
  });

  ipcMain.handle('posts:rebuildLinks', async () => {
    const engine = getPostEngine();
    return engine.rebuildAllPostLinks();
  });

  // ============ Media Handlers ============

  ipcMain.handle('media:import', async (_, sourcePath: string, metadata?: Partial<MediaData>) => {
    const engine = getMediaEngine();
    return engine.importMedia(sourcePath, metadata);
  });

  ipcMain.handle('media:importDialog', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import Media',
      filters: [
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile', 'multiSelections'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return [];
    }

    const engine = getMediaEngine();
    const imported: MediaData[] = [];

    for (const filePath of result.filePaths) {
      try {
        const media = await engine.importMedia(filePath);
        imported.push(media);
      } catch (error) {
        console.error(`Failed to import ${filePath}:`, error);
      }
    }

    return imported;
  });

  ipcMain.handle('media:update', async (_, id: string, data: Partial<MediaData>) => {
    const engine = getMediaEngine();
    return engine.updateMedia(id, data);
  });

  ipcMain.handle('media:delete', async (_, id: string) => {
    const engine = getMediaEngine();
    return engine.deleteMedia(id);
  });

  ipcMain.handle('media:get', async (_, id: string) => {
    const engine = getMediaEngine();
    return engine.getMedia(id);
  });

  ipcMain.handle('media:getAll', async () => {
    const engine = getMediaEngine();
    return engine.getAllMedia();
  });

  ipcMain.handle('media:rebuildFromFiles', async () => {
    const engine = getMediaEngine();
    return engine.rebuildDatabaseFromFiles();
  });

  ipcMain.handle('media:getThumbnail', async (_, id: string, size?: 'small' | 'medium' | 'large') => {
    const engine = getMediaEngine();
    return engine.getThumbnailDataUrl(id, size || 'small');
  });

  ipcMain.handle('media:regenerateThumbnails', async (_, id: string) => {
    const engine = getMediaEngine();
    const mediaItem = await engine.getMedia(id);
    if (mediaItem && mediaItem.mimeType.startsWith('image/')) {
      const db = getDatabase().getLocal();
      const dbMedia = await db.select().from(media).where(eq(media.id, id)).get();
      if (dbMedia) {
        return engine.generateThumbnails(id, dbMedia.filePath);
      }
    }
    return null;
  });

  // ============ Sync Handlers ============

  ipcMain.handle('sync:configure', async (_, config: SyncConfig) => {
    const engine = getSyncEngine();
    return engine.configure(config);
  });

  ipcMain.handle('sync:start', async (_, direction: SyncDirection = 'bidirectional') => {
    const engine = getSyncEngine();
    return engine.sync(direction);
  });

  ipcMain.handle('sync:getStatus', async () => {
    const engine = getSyncEngine();
    return engine.getSyncStatus();
  });

  ipcMain.handle('sync:isConfigured', async () => {
    const engine = getSyncEngine();
    return engine.isConfigured();
  });

  ipcMain.handle('sync:getPendingCount', async () => {
    const engine = getSyncEngine();
    return engine.getPendingChangesCount();
  });

  ipcMain.handle('sync:getLog', async (_, limit?: number) => {
    const engine = getSyncEngine();
    return engine.getSyncLog(limit);
  });

  ipcMain.handle('sync:stopAutoSync', async () => {
    const engine = getSyncEngine();
    return engine.stopAutoSync();
  });

  // ============ Task Handlers ============

  ipcMain.handle('tasks:getAll', async () => {
    return taskManager.getAllTasks();
  });

  ipcMain.handle('tasks:getRunning', async () => {
    return taskManager.getRunningTasks();
  });

  ipcMain.handle('tasks:cancel', async (_, taskId: string) => {
    return taskManager.cancelTask(taskId);
  });

  ipcMain.handle('tasks:clearCompleted', async () => {
    return taskManager.clearCompletedTasks();
  });

  // ============ App Handlers ============

  ipcMain.handle('app:getDataPaths', async () => {
    return getDatabase().getDataPaths();
  });

  ipcMain.handle('app:openFolder', async (_, folderPath: string) => {
    return shell.openPath(folderPath);
  });

  ipcMain.handle('app:showItemInFolder', async (_, itemPath: string) => {
    return shell.showItemInFolder(itemPath);
  });

  // ============ Event Forwarding ============
  
  // Forward engine events to renderer
  const postEngine = getPostEngine();
  const mediaEngine = getMediaEngine();
  const syncEngine = getSyncEngine();
  const projectEngine = getProjectEngine();

  const forwardEvent = (eventName: string) => {
    return (...args: unknown[]) => {
      // Will be sent to renderer via webContents when window is available
      ipcMain.emit('forward-to-renderer', eventName, ...args);
    };
  };

  projectEngine.on('projectCreated', forwardEvent('project:created'));
  projectEngine.on('projectUpdated', forwardEvent('project:updated'));
  projectEngine.on('projectDeleted', forwardEvent('project:deleted'));
  projectEngine.on('activeProjectChanged', forwardEvent('project:activeChanged'));

  postEngine.on('postCreated', forwardEvent('post:created'));
  postEngine.on('postUpdated', forwardEvent('post:updated'));
  postEngine.on('postDeleted', forwardEvent('post:deleted'));
  postEngine.on('databaseRebuilt', forwardEvent('posts:databaseRebuilt'));

  mediaEngine.on('mediaImported', forwardEvent('media:imported'));
  mediaEngine.on('mediaUpdated', forwardEvent('media:updated'));
  mediaEngine.on('mediaDeleted', forwardEvent('media:deleted'));
  mediaEngine.on('databaseRebuilt', forwardEvent('media:databaseRebuilt'));

  syncEngine.on('syncStarted', forwardEvent('sync:started'));
  syncEngine.on('syncCompleted', forwardEvent('sync:completed'));
  syncEngine.on('syncFailed', forwardEvent('sync:failed'));

  taskManager.on('taskCreated', forwardEvent('task:created'));
  taskManager.on('taskStarted', forwardEvent('task:started'));
  taskManager.on('taskProgress', forwardEvent('task:progress'));
  taskManager.on('taskCompleted', forwardEvent('task:completed'));
  taskManager.on('taskFailed', forwardEvent('task:failed'));
}
