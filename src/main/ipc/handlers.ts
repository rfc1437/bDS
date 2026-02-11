import { ipcMain, dialog, shell } from 'electron';
import { eq } from 'drizzle-orm';
import { getPostEngine, PostData, PostFilter, PaginationOptions } from '../engine/PostEngine';
import { getMediaEngine, MediaData } from '../engine/MediaEngine';
import { getSyncEngine, SyncConfig, SyncDirection } from '../engine/SyncEngine';
import { getDropboxSyncEngine, DropboxSyncConfig, ConflictResolution } from '../engine/DropboxSyncEngine';
import { getProjectEngine, ProjectData } from '../engine/ProjectEngine';
import { getMetaEngine } from '../engine/MetaEngine';
import { getTagEngine } from '../engine/TagEngine';
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

  ipcMain.handle('projects:deleteWithData', async (_, id: string) => {
    const engine = getProjectEngine();
    return engine.deleteProjectWithData(id);
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
    const projectEngine = getProjectEngine();
    const project = await projectEngine.getActiveProject();
    
    // Ensure all engines have the correct project context
    if (project) {
      const postEngine = getPostEngine();
      const mediaEngine = getMediaEngine();
      const metaEngine = getMetaEngine();
      const tagEngine = getTagEngine();
      postEngine.setProjectContext(project.id);
      mediaEngine.setProjectContext(project.id);
      metaEngine.setProjectContext(project.id);
      tagEngine.setProjectContext(project.id);
      
      // Sync meta on startup
      await metaEngine.syncOnStartup();
    }
    
    return project;
  });

  ipcMain.handle('projects:setActive', async (_, id: string) => {
    const projectEngine = getProjectEngine();
    const project = await projectEngine.setActiveProject(id);
    
    // Update all engines to use the new project context
    if (project) {
      const postEngine = getPostEngine();
      const mediaEngine = getMediaEngine();
      const metaEngine = getMetaEngine();
      const tagEngine = getTagEngine();
      postEngine.setProjectContext(project.id);
      mediaEngine.setProjectContext(project.id);
      metaEngine.setProjectContext(project.id);
      tagEngine.setProjectContext(project.id);
      
      // Sync meta on project switch
      await metaEngine.syncOnStartup();
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

  ipcMain.handle('posts:getAll', async (_, options?: PaginationOptions) => {
    const engine = getPostEngine();
    return engine.getAllPosts(options);
  });

  ipcMain.handle('posts:getByStatus', async (_, status: 'draft' | 'published' | 'archived') => {
    const engine = getPostEngine();
    return engine.getPostsByStatus(status);
  });

  ipcMain.handle('posts:publish', async (_, id: string) => {
    const engine = getPostEngine();
    return engine.publishPost(id);
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
    // Ensure project context is current before rebuilding
    const projectEngine = getProjectEngine();
    const project = await projectEngine.getActiveProject();
    const engine = getPostEngine();
    if (project) {
      engine.setProjectContext(project.id);
    }
    // Fire and forget - don't await, let it run in background
    engine.rebuildDatabaseFromFiles().catch(err => {
      console.error('Post rebuild failed:', err);
    });
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

  ipcMain.handle('posts:getTagsWithCounts', async () => {
    const engine = getPostEngine();
    return engine.getTagsWithCounts();
  });

  ipcMain.handle('posts:getCategoriesWithCounts', async () => {
    const engine = getPostEngine();
    return engine.getCategoriesWithCounts();
  });

  ipcMain.handle('posts:getDashboardStats', async () => {
    const engine = getPostEngine();
    return engine.getDashboardStats();
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

  ipcMain.handle('posts:reindexText', async () => {
    const projectEngine = getProjectEngine();
    const project = await projectEngine.getActiveProject();
    const engine = getPostEngine();
    if (project) {
      engine.setProjectContext(project.id);
    }
    // Fire and forget - let it run as a background task
    engine.reindexText().catch(err => {
      console.error('Text reindex failed:', err);
    });
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

  ipcMain.handle('media:getUrl', async (_, id: string) => {
    // Returns the bds-media:// protocol URL for a media item
    return `bds-media://${id}`;
  });

  ipcMain.handle('media:getFilePath', async (_, id: string) => {
    // Returns the actual file path for a media item (for debugging/advanced use)
    const db = getDatabase().getLocal();
    const mediaItem = await db.select().from(media).where(eq(media.id, id)).get();
    return mediaItem?.filePath ?? null;
  });

  ipcMain.handle('media:getAll', async () => {
    const engine = getMediaEngine();
    return engine.getAllMedia();
  });

  ipcMain.handle('media:rebuildFromFiles', async () => {
    // Ensure project context is current before rebuilding
    const projectEngine = getProjectEngine();
    const project = await projectEngine.getActiveProject();
    const engine = getMediaEngine();
    if (project) {
      engine.setProjectContext(project.id);
    }
    // Fire and forget - don't await, let it run in background
    engine.rebuildDatabaseFromFiles().catch(err => {
      console.error('Media rebuild failed:', err);
    });
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

  ipcMain.handle('media:regenerateMissingThumbnails', async () => {
    const projectEngine = getProjectEngine();
    const project = await projectEngine.getActiveProject();
    const engine = getMediaEngine();
    if (project) {
      engine.setProjectContext(project.id);
    }
    return engine.regenerateMissingThumbnails();
  });

  // ============ Sync Handlers ============

  ipcMain.handle('sync:configure', async (_, config: SyncConfig) => {
    const engine = getSyncEngine();
    return engine.configure(config);
  });

  ipcMain.handle('sync:start', async (_, direction: SyncDirection = 'bidirectional') => {
    const engine = getSyncEngine();
    return engine.fullSync(direction);
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

  // ============ Dropbox Sync Handlers ============

  ipcMain.handle('dropbox:configure', async (_, config: Partial<DropboxSyncConfig>) => {
    const engine = getDropboxSyncEngine();

    // Inject local project paths so the engine knows where files live
    const projectEngine = getProjectEngine();
    const activeProject = await projectEngine.getActiveProject();
    const projectId = activeProject?.id || 'default';
    const paths = projectEngine.getProjectPaths(projectId);

    const fullConfig: DropboxSyncConfig = {
      accessToken: config.accessToken,
      appKey: config.appKey || '',
      appSecret: config.appSecret,
      refreshToken: config.refreshToken,
      syncEnabled: config.syncEnabled ?? true,
      syncInterval: config.syncInterval ?? 60,
      localPostsDir: paths.posts,
      localMediaDir: paths.media,
      remoteBasePath: config.remoteBasePath ?? (config as any).remotePath ?? '',
    };

    return engine.configure(fullConfig);
  });

  ipcMain.handle('dropbox:isConfigured', async () => {
    const engine = getDropboxSyncEngine();
    return engine.isConfigured();
  });

  ipcMain.handle('dropbox:getStatus', async () => {
    const engine = getDropboxSyncEngine();
    return engine.getStatus();
  });

  ipcMain.handle('dropbox:syncAll', async () => {
    const engine = getDropboxSyncEngine();
    return engine.syncAll();
  });

  ipcMain.handle('dropbox:startWatching', async () => {
    const engine = getDropboxSyncEngine();
    engine.startWatching();
  });

  ipcMain.handle('dropbox:stopWatching', async () => {
    const engine = getDropboxSyncEngine();
    engine.stopWatching();
  });

  ipcMain.handle('dropbox:startPolling', async () => {
    const engine = getDropboxSyncEngine();
    engine.startPolling();
  });

  ipcMain.handle('dropbox:stopPolling', async () => {
    const engine = getDropboxSyncEngine();
    engine.stopPolling();
  });

  ipcMain.handle('dropbox:getConflicts', async () => {
    const engine = getDropboxSyncEngine();
    return engine.getPendingConflicts();
  });

  ipcMain.handle('dropbox:resolveConflict', async (_, conflictId: string, resolution: ConflictResolution) => {
    const engine = getDropboxSyncEngine();
    const conflicts = engine.getPendingConflicts();
    const conflict = conflicts.find(c => c.id === conflictId);
    if (!conflict) {
      throw new Error(`Conflict ${conflictId} not found`);
    }
    return engine.resolveConflict(conflict, resolution);
  });

  ipcMain.handle('dropbox:getLastSyncTime', async () => {
    const engine = getDropboxSyncEngine();
    return engine.getLastSyncTime();
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
    // Get paths for the active project
    const projectEngine = getProjectEngine();
    const activeProject = await projectEngine.getActiveProject();
    const projectId = activeProject?.id || 'default';
    const paths = projectEngine.getProjectPaths(projectId);
    return {
      database: getDatabase().getDataPaths().database,
      posts: paths.posts,
      media: paths.media,
    };
  });

  ipcMain.handle('app:openFolder', async (_, folderPath: string) => {
    return shell.openPath(folderPath);
  });

  ipcMain.handle('app:showItemInFolder', async (_, itemPath: string) => {
    return shell.showItemInFolder(itemPath);
  });

  // ============ Meta Handlers ============

  ipcMain.handle('meta:getTags', async () => {
    const engine = getMetaEngine();
    return engine.getTags();
  });

  ipcMain.handle('meta:getCategories', async () => {
    const engine = getMetaEngine();
    return engine.getCategories();
  });

  ipcMain.handle('meta:addTag', async (_, tag: string) => {
    const engine = getMetaEngine();
    await engine.addTag(tag);
    return engine.getTags();
  });

  ipcMain.handle('meta:removeTag', async (_, tag: string) => {
    const engine = getMetaEngine();
    await engine.removeTag(tag);
    return engine.getTags();
  });

  ipcMain.handle('meta:addCategory', async (_, category: string) => {
    const engine = getMetaEngine();
    await engine.addCategory(category);
    return engine.getCategories();
  });

  ipcMain.handle('meta:removeCategory', async (_, category: string) => {
    const engine = getMetaEngine();
    await engine.removeCategory(category);
    return engine.getCategories();
  });

  ipcMain.handle('meta:syncOnStartup', async () => {
    const engine = getMetaEngine();
    await engine.syncOnStartup();
    return {
      tags: await engine.getTags(),
      categories: await engine.getCategories(),
      projectMetadata: await engine.getProjectMetadata(),
    };
  });

  ipcMain.handle('meta:getProjectMetadata', async () => {
    const engine = getMetaEngine();
    return engine.getProjectMetadata();
  });

  ipcMain.handle('meta:setProjectMetadata', async (_, metadata: { name: string; description?: string }) => {
    const engine = getMetaEngine();
    await engine.setProjectMetadata(metadata);
    return engine.getProjectMetadata();
  });

  ipcMain.handle('meta:updateProjectMetadata', async (_, updates: { name?: string; description?: string }) => {
    const engine = getMetaEngine();
    await engine.updateProjectMetadata(updates);
    return engine.getProjectMetadata();
  });

  // ============ Tag Management Handlers ============

  ipcMain.handle('tags:getAll', async () => {
    const engine = getTagEngine();
    return engine.getAllTags();
  });

  ipcMain.handle('tags:getWithCounts', async () => {
    const engine = getTagEngine();
    return engine.getTagsWithCounts();
  });

  ipcMain.handle('tags:get', async (_, id: string) => {
    const engine = getTagEngine();
    return engine.getTag(id);
  });

  ipcMain.handle('tags:getByName', async (_, name: string) => {
    const engine = getTagEngine();
    return engine.getTagByName(name);
  });

  ipcMain.handle('tags:create', async (_, data: { name: string; color?: string }) => {
    const engine = getTagEngine();
    return engine.createTag(data);
  });

  ipcMain.handle('tags:update', async (_, id: string, data: { name?: string; color?: string | null }) => {
    const engine = getTagEngine();
    return engine.updateTag(id, data);
  });

  ipcMain.handle('tags:delete', async (_, id: string) => {
    const engine = getTagEngine();
    return engine.deleteTag(id);
  });

  ipcMain.handle('tags:merge', async (_, sourceTagIds: string[], targetTagId: string) => {
    const engine = getTagEngine();
    return engine.mergeTags(sourceTagIds, targetTagId);
  });

  ipcMain.handle('tags:rename', async (_, id: string, newName: string) => {
    const engine = getTagEngine();
    return engine.renameTag(id, newName);
  });

  ipcMain.handle('tags:getPostsWithTag', async (_, tagId: string) => {
    const engine = getTagEngine();
    return engine.getPostsWithTag(tagId);
  });

  ipcMain.handle('tags:syncFromPosts', async () => {
    const engine = getTagEngine();
    return engine.syncTagsFromPosts();
  });

  // ============ Event Forwarding ============
  
  // Forward engine events to renderer
  const postEngine = getPostEngine();
  const mediaEngine = getMediaEngine();
  const syncEngine = getSyncEngine();
  const projectEngine = getProjectEngine();
  const metaEngine = getMetaEngine();
  const tagEngine = getTagEngine();

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
  postEngine.on('rebuildStarted', forwardEvent('posts:rebuildStarted'));
  postEngine.on('databaseRebuilt', forwardEvent('posts:databaseRebuilt'));

  mediaEngine.on('mediaImported', forwardEvent('media:imported'));
  mediaEngine.on('mediaUpdated', forwardEvent('media:updated'));
  mediaEngine.on('mediaDeleted', forwardEvent('media:deleted'));
  mediaEngine.on('rebuildStarted', forwardEvent('media:rebuildStarted'));
  mediaEngine.on('databaseRebuilt', forwardEvent('media:databaseRebuilt'));

  metaEngine.on('tagsChanged', forwardEvent('meta:tagsChanged'));
  metaEngine.on('categoriesChanged', forwardEvent('meta:categoriesChanged'));
  metaEngine.on('projectMetadataChanged', forwardEvent('meta:projectMetadataChanged'));

  tagEngine.on('tagCreated', forwardEvent('tag:created'));
  tagEngine.on('tagUpdated', forwardEvent('tag:updated'));
  tagEngine.on('tagDeleted', forwardEvent('tag:deleted'));
  tagEngine.on('tagRenamed', forwardEvent('tag:renamed'));
  tagEngine.on('tagsMerged', forwardEvent('tags:merged'));
  tagEngine.on('tagsSynced', forwardEvent('tags:synced'));

  syncEngine.on('syncStarted', forwardEvent('sync:started'));
  syncEngine.on('syncCompleted', forwardEvent('sync:completed'));
  syncEngine.on('syncFailed', forwardEvent('sync:failed'));

  const dropboxEngine = getDropboxSyncEngine();
  dropboxEngine.on('configured', forwardEvent('dropbox:configured'));
  dropboxEngine.on('syncStarted', forwardEvent('dropbox:syncStarted'));
  dropboxEngine.on('syncCompleted', forwardEvent('dropbox:syncCompleted'));
  dropboxEngine.on('syncFailed', forwardEvent('dropbox:syncFailed'));
  dropboxEngine.on('fileUploaded', forwardEvent('dropbox:fileUploaded'));
  dropboxEngine.on('fileDownloaded', forwardEvent('dropbox:fileDownloaded'));
  dropboxEngine.on('fileDeleted', forwardEvent('dropbox:fileDeleted'));
  dropboxEngine.on('conflictDetected', forwardEvent('dropbox:conflictDetected'));
  dropboxEngine.on('conflictResolved', forwardEvent('dropbox:conflictResolved'));
  dropboxEngine.on('watchStarted', forwardEvent('dropbox:watchStarted'));
  dropboxEngine.on('watchStopped', forwardEvent('dropbox:watchStopped'));
  dropboxEngine.on('authError', forwardEvent('dropbox:authError'));

  taskManager.on('taskCreated', forwardEvent('task:created'));
  taskManager.on('taskStarted', forwardEvent('task:started'));
  taskManager.on('taskProgress', forwardEvent('task:progress'));
  taskManager.on('taskCompleted', forwardEvent('task:completed'));
  taskManager.on('taskFailed', forwardEvent('task:failed'));
}
