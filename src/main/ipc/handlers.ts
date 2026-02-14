import { ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import * as fsPromises from 'fs/promises';
import { eq } from 'drizzle-orm';
import { getPostEngine, PostData, PostFilter, PaginationOptions } from '../engine/PostEngine';
import { getMediaEngine, MediaData } from '../engine/MediaEngine';
import { getProjectEngine, ProjectData } from '../engine/ProjectEngine';
import { getMetaEngine } from '../engine/MetaEngine';
import { getTagEngine } from '../engine/TagEngine';
import { getPostMediaEngine } from '../engine/PostMediaEngine';
import { taskManager, TaskProgress } from '../engine/TaskManager';
import { getDatabase } from '../database';
import { media } from '../database/schema';

/**
 * Wrap an IPC handler so that "Database is closing" errors during shutdown
 * are silently swallowed instead of being logged as scary red error messages.
 */
function safeHandle(channel: string, handler: (...args: any[]) => Promise<any>): void {
  ipcMain.handle(channel, async (...args) => {
    try {
      return await handler(...args);
    } catch (error: any) {
      if (error?.message === 'Database is closing') {
        return null; // Silently ignore during shutdown
      }
      throw error; // Re-throw all other errors
    }
  });
}

export function registerIpcHandlers(): void {
  // ============ Project Handlers ============

  safeHandle('projects:create', async (_, data: { name: string; description?: string; slug?: string; dataPath?: string }) => {
    const engine = getProjectEngine();
    return engine.createProject(data);
  });

  safeHandle('projects:update', async (_, id: string, data: Partial<ProjectData>) => {
    const engine = getProjectEngine();
    return engine.updateProject(id, data);
  });

  safeHandle('projects:delete', async (_, id: string) => {
    const engine = getProjectEngine();
    return engine.deleteProject(id);
  });

  safeHandle('projects:deleteWithData', async (_, id: string) => {
    const engine = getProjectEngine();
    return engine.deleteProjectWithData(id);
  });

  safeHandle('projects:get', async (_, id: string) => {
    const engine = getProjectEngine();
    return engine.getProject(id);
  });

  safeHandle('projects:getAll', async () => {
    const engine = getProjectEngine();
    return engine.getAllProjects();
  });

  safeHandle('projects:getActive', async () => {
    const projectEngine = getProjectEngine();
    const project = await projectEngine.getActiveProject();

    // Ensure all engines have the correct project context
    if (project) {
      const dataDir = projectEngine.getDataDir(project.id, project.dataPath);
      // For thumbnails and meta: use dataDir (whether custom or internal)
      // This ensures all project data lives in the same location for backup
      const postEngine = getPostEngine();
      const mediaEngine = getMediaEngine();
      const metaEngine = getMetaEngine();
      const tagEngine = getTagEngine();
      postEngine.setProjectContext(project.id, dataDir);
      mediaEngine.setProjectContext(project.id, dataDir, dataDir);
      metaEngine.setProjectContext(project.id, dataDir);
      tagEngine.setProjectContext(project.id, dataDir);
      const postMediaEngine = getPostMediaEngine();
      postMediaEngine.setProjectContext(project.id);

      // Sync meta on startup
      await metaEngine.syncOnStartup();

      // Set search language from project metadata
      const { isoToStemmerLanguage } = await import('../engine/stemmer');
      const metadata = await metaEngine.getProjectMetadata();
      if (metadata?.mainLanguage) {
        const stemmerLang = isoToStemmerLanguage(metadata.mainLanguage);
        postEngine.setSearchLanguage(stemmerLang);
        mediaEngine.setSearchLanguage(stemmerLang);
      }
    }

    return project;
  });

  safeHandle('projects:setActive', async (_, id: string) => {
    const projectEngine = getProjectEngine();
    const project = await projectEngine.setActiveProject(id);

    // Update all engines to use the new project context
    if (project) {
      const dataDir = projectEngine.getDataDir(project.id, project.dataPath);
      // For thumbnails and meta: use dataDir (whether custom or internal)
      // This ensures all project data lives in the same location for backup
      const postEngine = getPostEngine();
      const mediaEngine = getMediaEngine();
      const metaEngine = getMetaEngine();
      const tagEngine = getTagEngine();
      postEngine.setProjectContext(project.id, dataDir);
      mediaEngine.setProjectContext(project.id, dataDir, dataDir);
      metaEngine.setProjectContext(project.id, dataDir);
      tagEngine.setProjectContext(project.id, dataDir);
      const postMediaEngine = getPostMediaEngine();
      postMediaEngine.setProjectContext(project.id);

      // Sync meta on project switch
      await metaEngine.syncOnStartup();

      // Set search language from project metadata
      const { isoToStemmerLanguage } = await import('../engine/stemmer');
      const metadata = await metaEngine.getProjectMetadata();
      if (metadata?.mainLanguage) {
        const stemmerLang = isoToStemmerLanguage(metadata.mainLanguage);
        postEngine.setSearchLanguage(stemmerLang);
        mediaEngine.setSearchLanguage(stemmerLang);
      }
    }

    return project;
  });

  // ============ Post Handlers ============
  
  safeHandle('posts:create', async (_, data: Partial<PostData>) => {
    const engine = getPostEngine();
    return engine.createPost(data);
  });

  safeHandle('posts:isSlugAvailable', async (_, slug: string, excludePostId?: string) => {
    const engine = getPostEngine();
    return engine.isSlugAvailable(slug, excludePostId);
  });

  safeHandle('posts:generateUniqueSlug', async (_, title: string, excludePostId?: string) => {
    const engine = getPostEngine();
    return engine.generateUniqueSlug(title, excludePostId);
  });

  safeHandle('posts:update', async (_, id: string, data: Partial<PostData>) => {
    const engine = getPostEngine();
    return engine.updatePost(id, data);
  });

  safeHandle('posts:delete', async (_, id: string) => {
    const engine = getPostEngine();
    return engine.deletePost(id);
  });

  safeHandle('posts:get', async (_, id: string) => {
    const engine = getPostEngine();
    return engine.getPost(id);
  });

  safeHandle('posts:getAll', async (_, options?: PaginationOptions) => {
    const engine = getPostEngine();
    return engine.getAllPosts(options);
  });

  safeHandle('posts:getByStatus', async (_, status: 'draft' | 'published' | 'archived') => {
    const engine = getPostEngine();
    return engine.getPostsByStatus(status);
  });

  safeHandle('posts:publish', async (_, id: string) => {
    const engine = getPostEngine();
    return engine.publishPost(id);
  });

  safeHandle('posts:discard', async (_, id: string) => {
    const engine = getPostEngine();
    return engine.discardChanges(id);
  });

  safeHandle('posts:hasPublishedVersion', async (_, id: string) => {
    const engine = getPostEngine();
    return engine.hasPublishedVersion(id);
  });

  safeHandle('posts:rebuildFromFiles', async () => {
    // Ensure project context is current before rebuilding
    const projectEngine = getProjectEngine();
    const project = await projectEngine.getActiveProject();
    const engine = getPostEngine();
    if (project) {
      const dataDir = projectEngine.getDataDir(project.id, project.dataPath);
      engine.setProjectContext(project.id, dataDir);
    }
    // Fire and forget - don't await, let it run in background
    engine.rebuildDatabaseFromFiles().catch(err => {
      console.error('Post rebuild failed:', err);
    });
  });

  safeHandle('posts:search', async (_, query: string) => {
    const engine = getPostEngine();
    return engine.searchPosts(query);
  });

  safeHandle('posts:filter', async (_, filter: PostFilter) => {
    const engine = getPostEngine();
    return engine.getPostsFiltered(filter);
  });

  safeHandle('posts:getTags', async () => {
    const engine = getPostEngine();
    return engine.getAvailableTags();
  });

  safeHandle('posts:getCategories', async () => {
    const engine = getPostEngine();
    return engine.getAvailableCategories();
  });

  safeHandle('posts:getByYearMonth', async () => {
    const engine = getPostEngine();
    return engine.getPostsByYearMonth();
  });

  safeHandle('posts:getTagsWithCounts', async () => {
    const engine = getPostEngine();
    return engine.getTagsWithCounts();
  });

  safeHandle('posts:getCategoriesWithCounts', async () => {
    const engine = getPostEngine();
    return engine.getCategoriesWithCounts();
  });

  safeHandle('posts:getDashboardStats', async () => {
    const engine = getPostEngine();
    return engine.getDashboardStats();
  });

  safeHandle('posts:getLinksTo', async (_, id: string) => {
    const engine = getPostEngine();
    return engine.getLinksTo(id);
  });

  safeHandle('posts:getLinkedBy', async (_, id: string) => {
    const engine = getPostEngine();
    return engine.getLinkedBy(id);
  });

  safeHandle('posts:rebuildLinks', async () => {
    const engine = getPostEngine();
    return engine.rebuildAllPostLinks();
  });

  safeHandle('posts:reindexText', async () => {
    const projectEngine = getProjectEngine();
    const project = await projectEngine.getActiveProject();
    const engine = getPostEngine();
    if (project) {
      const dataDir = projectEngine.getDataDir(project.id, project.dataPath);
      engine.setProjectContext(project.id, dataDir);
    }
    // Fire and forget - let it run as a background task
    engine.reindexText().catch(err => {
      console.error('Text reindex failed:', err);
    });
  });

  // ============ Media Handlers ============

  safeHandle('media:import', async (_, sourcePath: string, metadata?: Partial<MediaData>) => {
    const engine = getMediaEngine();
    return engine.importMedia(sourcePath, metadata);
  });

  safeHandle('media:importDialog', async () => {
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

    // Ensure project context is current before importing
    const projectEngine = getProjectEngine();
    const project = await projectEngine.getActiveProject();
    const engine = getMediaEngine();
    if (project) {
      const internalDir = projectEngine.getInternalBaseDir(project.id);
      const dataDir = projectEngine.getDataDir(project.id, project.dataPath);
      engine.setProjectContext(project.id, dataDir, internalDir);
    }

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

  safeHandle('media:update', async (_, id: string, data: Partial<MediaData>) => {
    const engine = getMediaEngine();
    return engine.updateMedia(id, data);
  });

  safeHandle('media:delete', async (_, id: string) => {
    const engine = getMediaEngine();
    return engine.deleteMedia(id);
  });

  safeHandle('media:get', async (_, id: string) => {
    const engine = getMediaEngine();
    return engine.getMedia(id);
  });

  safeHandle('media:getUrl', async (_, id: string) => {
    // Returns the relative path for a media item (e.g. media/2025/01/uuid.jpg)
    // This is the format used in markdown content for image references
    const engine = getMediaEngine();
    const relativePath = await engine.getRelativePath(id);
    return relativePath ?? `media/${id}`;
  });

  safeHandle('media:getFilePath', async (_, id: string) => {
    // Returns the actual file path for a media item (for debugging/advanced use)
    const db = getDatabase().getLocal();
    const mediaItem = await db.select().from(media).where(eq(media.id, id)).get();
    return mediaItem?.filePath ?? null;
  });

  safeHandle('media:getAll', async () => {
    const engine = getMediaEngine();
    return engine.getAllMedia();
  });

  safeHandle('media:filter', async (_, filter: import('../engine/MediaEngine').MediaFilter) => {
    const engine = getMediaEngine();
    return engine.getMediaFiltered(filter);
  });

  safeHandle('media:search', async (_, query: string) => {
    const engine = getMediaEngine();
    return engine.searchMedia(query);
  });

  safeHandle('media:getByYearMonth', async () => {
    const engine = getMediaEngine();
    return engine.getMediaByYearMonth();
  });

  safeHandle('media:getTags', async () => {
    const engine = getMediaEngine();
    return engine.getAvailableTags();
  });

  safeHandle('media:getTagsWithCounts', async () => {
    const engine = getMediaEngine();
    return engine.getTagsWithCounts();
  });

  safeHandle('media:rebuildFromFiles', async () => {
    // Ensure project context is current before rebuilding
    const projectEngine = getProjectEngine();
    const project = await projectEngine.getActiveProject();
    const engine = getMediaEngine();
    if (project) {
      const internalDir = projectEngine.getInternalBaseDir(project.id);
      const dataDir = projectEngine.getDataDir(project.id, project.dataPath);
      engine.setProjectContext(project.id, dataDir, internalDir);
    }
    // Fire and forget - don't await, let it run in background
    engine.rebuildDatabaseFromFiles().catch(err => {
      console.error('Media rebuild failed:', err);
    });
  });

  safeHandle('media:reindexText', async () => {
    const engine = getMediaEngine();
    // Fire and forget - don't await, let it run in background
    engine.reindexText().catch(err => {
      console.error('Media text reindex failed:', err);
    });
  });

  safeHandle('media:getThumbnail', async (_, id: string, size?: 'small' | 'medium' | 'large') => {
    const engine = getMediaEngine();
    return engine.getThumbnailDataUrl(id, size || 'small');
  });

  safeHandle('media:regenerateThumbnails', async (_, id: string) => {
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

  safeHandle('media:regenerateMissingThumbnails', async () => {
    const projectEngine = getProjectEngine();
    const project = await projectEngine.getActiveProject();
    const engine = getMediaEngine();
    if (project) {
      const internalDir = projectEngine.getInternalBaseDir(project.id);
      const dataDir = projectEngine.getDataDir(project.id, project.dataPath);
      engine.setProjectContext(project.id, dataDir, internalDir);
    }
    return engine.regenerateMissingThumbnails();
  });

  // ============ Task Handlers ============

  safeHandle('tasks:getAll', async () => {
    return taskManager.getAllTasks();
  });

  safeHandle('tasks:getRunning', async () => {
    return taskManager.getRunningTasks();
  });

  safeHandle('tasks:cancel', async (_, taskId: string) => {
    return taskManager.cancelTask(taskId);
  });

  safeHandle('tasks:clearCompleted', async () => {
    return taskManager.clearCompletedTasks();
  });

  // ============ App Handlers ============

  safeHandle('app:getDataPaths', async () => {
    // Get paths for the active project
    const projectEngine = getProjectEngine();
    const activeProject = await projectEngine.getActiveProject();
    const projectId = activeProject?.id || 'default';
    const paths = projectEngine.getProjectPaths(projectId, activeProject?.dataPath);
    return {
      database: getDatabase().getDataPaths().database,
      posts: paths.posts,
      media: paths.media,
    };
  });

  safeHandle('app:openFolder', async (_, folderPath: string) => {
    return shell.openPath(folderPath);
  });

  safeHandle('app:selectFolder', async (_, title?: string) => {
    const result = await dialog.showOpenDialog({
      title: title || 'Select Folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  safeHandle('app:getDefaultProjectPath', async (_, projectId: string) => {
    const projectEngine = getProjectEngine();
    return projectEngine.getDefaultProjectBaseDir(projectId);
  });

  safeHandle('app:showItemInFolder', async (_, itemPath: string) => {
    return shell.showItemInFolder(itemPath);
  });

  safeHandle('app:readProjectMetadata', async (_, folderPath: string) => {
    const metaPath = path.join(folderPath, 'meta', 'project.json');
    try {
      const content = await fsPromises.readFile(metaPath, 'utf-8');
      const metadata = JSON.parse(content);
      // Return metadata but exclude dataPath (will be set to selected folder)
      return {
        name: metadata.name || undefined,
        description: metadata.description || undefined,
        mainLanguage: metadata.mainLanguage || undefined,
      };
    } catch {
      // File doesn't exist or is invalid - return null
      return null;
    }
  });

  // ============ Meta Handlers ============

  safeHandle('meta:getTags', async () => {
    const engine = getMetaEngine();
    return engine.getTags();
  });

  safeHandle('meta:getCategories', async () => {
    const engine = getMetaEngine();
    return engine.getCategories();
  });

  safeHandle('meta:addTag', async (_, tag: string) => {
    const engine = getMetaEngine();
    await engine.addTag(tag);
    return engine.getTags();
  });

  safeHandle('meta:removeTag', async (_, tag: string) => {
    const engine = getMetaEngine();
    await engine.removeTag(tag);
    return engine.getTags();
  });

  safeHandle('meta:addCategory', async (_, category: string) => {
    const engine = getMetaEngine();
    await engine.addCategory(category);
    return engine.getCategories();
  });

  safeHandle('meta:removeCategory', async (_, category: string) => {
    const engine = getMetaEngine();
    await engine.removeCategory(category);
    return engine.getCategories();
  });

  safeHandle('meta:syncOnStartup', async () => {
    const engine = getMetaEngine();
    await engine.syncOnStartup();
    return {
      tags: await engine.getTags(),
      categories: await engine.getCategories(),
      projectMetadata: await engine.getProjectMetadata(),
    };
  });

  safeHandle('meta:getProjectMetadata', async () => {
    const engine = getMetaEngine();
    return engine.getProjectMetadata();
  });

  safeHandle('meta:setProjectMetadata', async (_, metadata: { name: string; description?: string }) => {
    const engine = getMetaEngine();
    await engine.setProjectMetadata(metadata);
    return engine.getProjectMetadata();
  });

  safeHandle('meta:updateProjectMetadata', async (_, updates: { name?: string; description?: string; dataPath?: string; mainLanguage?: string }) => {
    const engine = getMetaEngine();
    await engine.updateProjectMetadata(updates);
    return engine.getProjectMetadata();
  });

  // ============ Tag Management Handlers ============

  safeHandle('tags:getAll', async () => {
    const engine = getTagEngine();
    return engine.getAllTags();
  });

  safeHandle('tags:getWithCounts', async () => {
    const engine = getTagEngine();
    return engine.getTagsWithCounts();
  });

  safeHandle('tags:get', async (_, id: string) => {
    const engine = getTagEngine();
    return engine.getTag(id);
  });

  safeHandle('tags:getByName', async (_, name: string) => {
    const engine = getTagEngine();
    return engine.getTagByName(name);
  });

  safeHandle('tags:create', async (_, data: { name: string; color?: string }) => {
    const engine = getTagEngine();
    return engine.createTag(data);
  });

  safeHandle('tags:update', async (_, id: string, data: { name?: string; color?: string | null }) => {
    const engine = getTagEngine();
    return engine.updateTag(id, data);
  });

  safeHandle('tags:delete', async (_, id: string) => {
    const engine = getTagEngine();
    return engine.deleteTag(id);
  });

  safeHandle('tags:merge', async (_, sourceTagIds: string[], targetTagId: string) => {
    const engine = getTagEngine();
    return engine.mergeTags(sourceTagIds, targetTagId);
  });

  safeHandle('tags:rename', async (_, id: string, newName: string) => {
    const engine = getTagEngine();
    return engine.renameTag(id, newName);
  });

  safeHandle('tags:getPostsWithTag', async (_, tagId: string) => {
    const engine = getTagEngine();
    return engine.getPostsWithTag(tagId);
  });

  safeHandle('tags:syncFromPosts', async () => {
    const engine = getTagEngine();
    return engine.syncTagsFromPosts();
  });

  // ============ Post-Media Link Handlers ============

  safeHandle('postMedia:link', async (_, postId: string, mediaId: string) => {
    const engine = getPostMediaEngine();
    return engine.linkMediaToPost(postId, mediaId);
  });

  safeHandle('postMedia:unlink', async (_, postId: string, mediaId: string) => {
    const engine = getPostMediaEngine();
    return engine.unlinkMediaFromPost(postId, mediaId);
  });

  safeHandle('postMedia:linkMany', async (_, postId: string, mediaIds: string[]) => {
    const engine = getPostMediaEngine();
    return engine.linkManyToPost(postId, mediaIds);
  });

  safeHandle('postMedia:unlinkMany', async (_, postId: string, mediaIds: string[]) => {
    const engine = getPostMediaEngine();
    return engine.unlinkManyFromPost(postId, mediaIds);
  });

  safeHandle('postMedia:getForPost', async (_, postId: string) => {
    const engine = getPostMediaEngine();
    return engine.getLinkedMediaForPost(postId);
  });

  safeHandle('postMedia:getForMedia', async (_, mediaId: string) => {
    const engine = getPostMediaEngine();
    return engine.getLinkedPostsForMedia(mediaId);
  });

  safeHandle('postMedia:getMediaDataForPost', async (_, postId: string) => {
    const engine = getPostMediaEngine();
    return engine.getLinkedMediaDataForPost(postId);
  });

  safeHandle('postMedia:reorder', async (_, postId: string, mediaIds: string[]) => {
    const engine = getPostMediaEngine();
    return engine.reorderMediaForPost(postId, mediaIds);
  });

  safeHandle('postMedia:isLinked', async (_, postId: string, mediaId: string) => {
    const engine = getPostMediaEngine();
    return engine.isMediaLinkedToPost(postId, mediaId);
  });

  safeHandle('postMedia:import', async (_, postId: string, filePath: string) => {
    const engine = getPostMediaEngine();
    return engine.importMediaForPost(postId, filePath);
  });

  safeHandle('postMedia:rebuild', async () => {
    const engine = getPostMediaEngine();
    return engine.rebuildFromSidecars();
  });

  // ============ Import Analysis Handlers ============

  // Helper to emit progress events
  const emitImportProgress = (step: string, detail?: string) => {
    ipcMain.emit('forward-to-renderer', 'import:progress', { step, detail });
  };

  safeHandle('import:selectAndAnalyze', async (_, uploadsFolder?: string) => {
    emitImportProgress('Selecting file...');
    
    const result = await dialog.showOpenDialog({
      title: 'Select WordPress Export File (WXR)',
      filters: [
        { name: 'WordPress Export', extensions: ['xml'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const filePath = result.filePaths[0];
    const fileName = filePath.split(/[/\\]/).pop() || filePath;
    
    emitImportProgress('Parsing WXR file...', fileName);
    
    const { WxrParser } = await import('../engine/WxrParser');
    const { ImportAnalysisEngine } = await import('../engine/ImportAnalysisEngine');

    const parser = new WxrParser();
    const wxrData = await parser.parseFile(filePath);

    emitImportProgress('Loading project data...', `Found ${wxrData.posts.length} posts, ${wxrData.media.length} media`);

    const analysisEngine = new ImportAnalysisEngine();
    const projectEngine = getProjectEngine();
    const activeProject = await projectEngine.getActiveProject();
    if (activeProject) {
      analysisEngine.setProjectContext(activeProject.id);
    }

    emitImportProgress('Analyzing posts...', `${wxrData.posts.length} posts`);
    
    // Add progress callback to engine
    analysisEngine.onProgress = (step: string, detail?: string) => {
      emitImportProgress(step, detail);
    };

    const report = await analysisEngine.analyzeWxr(wxrData, filePath, uploadsFolder || undefined);
    
    emitImportProgress('Analysis complete');
    
    return report;
  });

  safeHandle('import:analyzeFile', async (_, filePath: string, uploadsFolder?: string) => {
    const fileName = filePath.split(/[/\\]/).pop() || filePath;
    
    emitImportProgress('Parsing WXR file...', fileName);
    
    const { WxrParser } = await import('../engine/WxrParser');
    const { ImportAnalysisEngine } = await import('../engine/ImportAnalysisEngine');

    const parser = new WxrParser();
    const wxrData = await parser.parseFile(filePath);

    emitImportProgress('Loading project data...', `Found ${wxrData.posts.length} posts, ${wxrData.media.length} media`);

    const analysisEngine = new ImportAnalysisEngine();
    const projectEngine = getProjectEngine();
    const activeProject = await projectEngine.getActiveProject();
    if (activeProject) {
      analysisEngine.setProjectContext(activeProject.id);
    }

    emitImportProgress('Analyzing posts...');
    
    // Add progress callback to engine
    analysisEngine.onProgress = (step: string, detail?: string) => {
      emitImportProgress(step, detail);
    };

    const report = await analysisEngine.analyzeWxr(wxrData, filePath, uploadsFolder || undefined);
    
    emitImportProgress('Analysis complete');
    
    return report;
  });

  safeHandle('import:selectUploadsFolder', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select WordPress Uploads Folder',
      properties: ['openDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  // Helper to emit import execution progress events
  const emitImportExecutionProgress = (
    taskId: string,
    phase: string,
    current: number,
    total: number,
    detail?: string,
    eta?: number
  ) => {
    ipcMain.emit('forward-to-renderer', 'import:executionProgress', {
      taskId,
      phase,
      current,
      total,
      detail,
      eta,
    });
  };

  safeHandle('import:execute', async (_, reportJson: string, uploadsFolder?: string) => {
    const { ImportExecutionEngine } = await import('../engine/ImportExecutionEngine');
    
    // Parse the report
    const report = JSON.parse(reportJson) as import('../engine/ImportAnalysisEngine').ImportAnalysisReport;
    
    // Set up project context
    const projectEngine = getProjectEngine();
    const activeProject = await projectEngine.getActiveProject();
    
    // Calculate total items for ETA
    // Note: 'update' and 'content-duplicate' statuses are SKIPPED during import, only 'new' and resolved conflicts are imported
    const totalItems = 
      report.tags.filter(t => !t.existsInProject).length +
      report.categories.filter(c => !c.existsInProject).length +
      report.posts.items.filter(p => p.status === 'new' || (p.status === 'conflict' && p.conflictResolution && p.conflictResolution !== 'ignore')).length +
      report.media.items.filter(m => m.status === 'new').length +
      report.pages.items.filter(p => p.status === 'new' || (p.status === 'conflict' && p.conflictResolution && p.conflictResolution !== 'ignore')).length;

    // Create a task for the import
    const taskId = `import-${Date.now()}`;
    let processedItems = 0;
    let startTime = Date.now();

    const task = {
      id: taskId,
      name: `Import from ${report.site.title || 'WordPress'}`,
      execute: async (onProgress: (progress: number, message: string) => void) => {
        const executionEngine = new ImportExecutionEngine();
        
        if (activeProject) {
          executionEngine.setProjectContext(activeProject.id, activeProject.dataPath);
        }

        const result = await executionEngine.executeImport(report, {
          uploadsFolder,
          onProgress: (phase, current, total, detail) => {
            // Update processed items count based on phase progress
            processedItems++;
            
            // Calculate ETA
            const elapsed = Date.now() - startTime;
            const itemsPerMs = processedItems / elapsed;
            const remainingItems = totalItems - processedItems;
            const etaMs = itemsPerMs > 0 ? remainingItems / itemsPerMs : 0;
            
            // Calculate overall progress percentage
            const overallProgress = totalItems > 0 
              ? Math.round((processedItems / totalItems) * 100) 
              : 0;
            
            // Report to TaskManager
            onProgress(overallProgress, `${phase}: ${detail || `${current}/${total}`}`);
            
            // Also emit detailed progress for UI
            emitImportExecutionProgress(taskId, phase, current, total, detail, etaMs);
          },
        });

        // Convert Map to plain object for serialization
        const serializedResult = {
          ...result,
          wpIdToPostId: Object.fromEntries(result.wpIdToPostId),
        };

        return serializedResult;
      },
    };

    // Run the task - this returns immediately with a promise
    const resultPromise = taskManager.runTask(task);
    
    // Return task ID so UI can track it
    return { taskId, totalItems };
  });

  // ============ Import Definition CRUD Handlers ============

  safeHandle('importDefinitions:create', async (_, name?: string) => {
    const { ImportDefinitionEngine } = await import('../engine/ImportDefinitionEngine');
    const engine = new ImportDefinitionEngine();
    const projectEngine = getProjectEngine();
    const activeProject = await projectEngine.getActiveProject();
    if (activeProject) {
      engine.setProjectContext(activeProject.id);
    }
    return engine.createDefinition(name || undefined);
  });

  safeHandle('importDefinitions:get', async (_, id: string) => {
    const { ImportDefinitionEngine } = await import('../engine/ImportDefinitionEngine');
    const engine = new ImportDefinitionEngine();
    const projectEngine = getProjectEngine();
    const activeProject = await projectEngine.getActiveProject();
    if (activeProject) {
      engine.setProjectContext(activeProject.id);
    }
    return engine.getDefinition(id);
  });

  safeHandle('importDefinitions:getAll', async () => {
    const { ImportDefinitionEngine } = await import('../engine/ImportDefinitionEngine');
    const engine = new ImportDefinitionEngine();
    const projectEngine = getProjectEngine();
    const activeProject = await projectEngine.getActiveProject();
    if (activeProject) {
      engine.setProjectContext(activeProject.id);
    }
    return engine.getAllForProject();
  });

  safeHandle('importDefinitions:update', async (event, id: string, updates: any) => {
    const { ImportDefinitionEngine } = await import('../engine/ImportDefinitionEngine');
    const engine = new ImportDefinitionEngine();
    const projectEngine = getProjectEngine();
    const activeProject = await projectEngine.getActiveProject();
    if (activeProject) {
      engine.setProjectContext(activeProject.id);
    }
    const result = await engine.updateDefinition(id, updates);
    // Notify renderer of name changes for sidebar/tab updates
    if (result && updates.name !== undefined) {
      event.sender.send('importDefinition-name-updated', { definitionId: id, name: result.name });
    }
    return result;
  });

  safeHandle('importDefinitions:delete', async (_, id: string) => {
    const { ImportDefinitionEngine } = await import('../engine/ImportDefinitionEngine');
    const engine = new ImportDefinitionEngine();
    const projectEngine = getProjectEngine();
    const activeProject = await projectEngine.getActiveProject();
    if (activeProject) {
      engine.setProjectContext(activeProject.id);
    }
    return engine.deleteDefinition(id);
  });

  // ============ Event Forwarding ============
  
  // Forward engine events to renderer
  const postEngine = getPostEngine();
  const mediaEngine = getMediaEngine();
  const projectEngine = getProjectEngine();
  const metaEngine = getMetaEngine();
  const tagEngine = getTagEngine();
  const postMediaEngine = getPostMediaEngine();

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

  postMediaEngine.on('mediaLinked', forwardEvent('postMedia:linked'));
  postMediaEngine.on('mediaUnlinked', forwardEvent('postMedia:unlinked'));
  postMediaEngine.on('mediaBatchLinked', forwardEvent('postMedia:batchLinked'));
  postMediaEngine.on('mediaBatchUnlinked', forwardEvent('postMedia:batchUnlinked'));
  postMediaEngine.on('mediaReordered', forwardEvent('postMedia:reordered'));
  postMediaEngine.on('rebuilt', forwardEvent('postMedia:rebuilt'));

  taskManager.on('taskCreated', forwardEvent('task:created'));
  taskManager.on('taskStarted', forwardEvent('task:started'));
  taskManager.on('taskProgress', forwardEvent('task:progress'));
  taskManager.on('taskCompleted', forwardEvent('task:completed'));
  taskManager.on('taskFailed', forwardEvent('task:failed'));
}
