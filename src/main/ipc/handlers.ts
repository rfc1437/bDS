import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import * as fsPromises from 'fs/promises';
import { eq } from 'drizzle-orm';
import { getPostEngine, PostData, PostFilter, PaginationOptions } from '../engine/PostEngine';
import { getMediaEngine, MediaData } from '../engine/MediaEngine';
import { getProjectEngine, ProjectData } from '../engine/ProjectEngine';
import { getMetaEngine } from '../engine/MetaEngine';
import { getTagEngine } from '../engine/TagEngine';
import { getPostMediaEngine } from '../engine/PostMediaEngine';
import { getGitEngine } from '../engine/GitEngine';
import { taskManager, TaskProgress } from '../engine/TaskManager';
import { getDatabase } from '../database';
import { media } from '../database/schema';
import { APP_MENU_ACTION_EVENT_MAP, APP_MENU_WEB_CONTENTS_ACTIONS, type AppMenuAction } from '../shared/menuCommands';

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

function buildCanonicalPreviewPath(createdAt: Date, slug: string): string {
  const year = createdAt.getFullYear();
  const month = String(createdAt.getMonth() + 1).padStart(2, '0');
  const day = String(createdAt.getDate()).padStart(2, '0');
  return `/${year}/${month}/${day}/${slug}`;
}

function resolvePostCreatedAt(post: { createdAt: Date | string }): Date {
  if (post.createdAt instanceof Date) {
    return post.createdAt;
  }

  const parsed = new Date(post.createdAt);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function runWebContentsMenuAction(sender: any, action: AppMenuAction): boolean {
  if (!sender) {
    return false;
  }

  if (!APP_MENU_WEB_CONTENTS_ACTIONS.has(action)) {
    return false;
  }

  switch (action) {
    case 'undo':
      sender.undo?.();
      return true;
    case 'redo':
      sender.redo?.();
      return true;
    case 'cut':
      sender.cut?.();
      return true;
    case 'copy':
      sender.copy?.();
      return true;
    case 'paste':
      sender.paste?.();
      return true;
    case 'delete':
      sender.delete?.();
      return true;
    case 'selectAll':
      sender.selectAll?.();
      return true;
    case 'toggleDevTools':
      sender.toggleDevTools?.();
      return true;
    default:
      return false;
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildSitemapUrl(
  loc: string,
  lastmod: string,
  changefreq: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never',
  priority: string,
): string {
  return [
    '  <url>',
    `    <loc>${escapeXml(loc)}</loc>`,
    `    <lastmod>${escapeXml(lastmod)}</lastmod>`,
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    '  </url>',
  ].join('\n');
}

export function registerIpcHandlers(): void {
  // ============ Git Handlers ============

  safeHandle('git:checkAvailability', async () => {
    const engine = getGitEngine();
    return engine.checkAvailability();
  });

  safeHandle('git:getRepoState', async (_, projectPath: string) => {
    const engine = getGitEngine();
    return engine.getRepoState(projectPath);
  });

  safeHandle('git:status', async (_, projectPath: string) => {
    const engine = getGitEngine();
    return engine.getStatus(projectPath);
  });

  safeHandle('git:diff', async (_, projectPath: string, filePath: string) => {
    const engine = getGitEngine();
    return engine.getDiff(projectPath, filePath);
  });

  safeHandle('git:diffContent', async (_, projectPath: string, filePath: string) => {
    const engine = getGitEngine();
    return engine.getDiffContent(projectPath, filePath);
  });

  safeHandle('git:commitDiffContent', async (_, projectPath: string, commitHash: string) => {
    const engine = getGitEngine();
    return engine.getCommitDiffContent(projectPath, commitHash);
  });

  safeHandle('git:history', async (_, projectPath: string, limit?: number) => {
    const engine = getGitEngine();
    return engine.getHistory(projectPath, limit);
  });

  safeHandle('git:fileHistory', async (_, projectPath: string, filePath: string, limit?: number) => {
    const engine = getGitEngine();
    return engine.getFileHistory(projectPath, filePath, limit);
  });

  safeHandle('git:remoteState', async (_, projectPath: string) => {
    const engine = getGitEngine();
    return engine.getRemoteState(projectPath);
  });

  safeHandle('git:fetch', async (_, projectPath: string) => {
    const engine = getGitEngine();
    return engine.fetch(projectPath);
  });

  safeHandle('git:pull', async (_, projectPath: string) => {
    const engine = getGitEngine();
    return engine.pull(projectPath);
  });

  safeHandle('git:push', async (_, projectPath: string) => {
    const engine = getGitEngine();
    return engine.push(projectPath);
  });

  safeHandle('git:commitAll', async (_, projectPath: string, message: string) => {
    const engine = getGitEngine();
    return engine.commitAll(projectPath, message);
  });

  safeHandle('git:init', async (event, projectPath: string, remoteUrl?: string) => {
    const engine = getGitEngine();
    return engine.initializeRepo(projectPath, remoteUrl, (progress) => {
      event.sender.send('git:initProgress', progress);
    });
  });

  safeHandle('git:ensureGitignore', async (_, projectPath: string) => {
    const engine = getGitEngine();
    return engine.ensureGitignore(projectPath);
  });

  safeHandle('git:pruneLfs', async (_, projectPath: string, options?: { dryRun?: boolean; verifyRemote?: boolean }) => {
    const engine = getGitEngine();
    return engine.pruneLfsCache(projectPath, options);
  });

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
    
    // If no author provided, use default author from project settings
    if (!data.author) {
      const metaEngine = getMetaEngine();
      const metadata = await metaEngine.getProjectMetadata();
      if (metadata?.defaultAuthor) {
        data.author = metadata.defaultAuthor;
      }
    }
    
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

  safeHandle('posts:getPreviewUrl', async (_, id: string) => {
    const engine = getPostEngine();
    const post = await engine.getPost(id);

    if (!post) {
      return null;
    }

    const createdAt = resolvePostCreatedAt(post);
    const canonicalPath = buildCanonicalPreviewPath(createdAt, post.slug);
    return `http://127.0.0.1:4123${canonicalPath}`;
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
    return engine.rebuildDatabaseFromFiles();
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
    return engine.reindexText();
  });

  // ============ Media Handlers ============

  safeHandle('media:import', async (_, sourcePath: string, metadata?: Partial<MediaData>) => {
    const engine = getMediaEngine();
    
    // If no author provided, use default author from project settings
    if (!metadata?.author) {
      const metaEngine = getMetaEngine();
      const projectMetadata = await metaEngine.getProjectMetadata();
      if (projectMetadata?.defaultAuthor) {
        metadata = metadata || {};
        metadata.author = projectMetadata.defaultAuthor;
      }
    }
    
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
      const dataDir = projectEngine.getDataDir(project.id, project.dataPath);
      // For thumbnails and meta: use dataDir (whether custom or internal)
      // This ensures all project data lives in the same location for backup
      engine.setProjectContext(project.id, dataDir, dataDir);
    }

    const imported: MediaData[] = [];

    // Get default author from project settings
    const metaEngine = getMetaEngine();
    const projectMetadata = await metaEngine.getProjectMetadata();
    const defaultAuthor = projectMetadata?.defaultAuthor;

    for (const filePath of result.filePaths) {
      try {
        const media = await engine.importMedia(filePath, defaultAuthor ? { author: defaultAuthor } : undefined);
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

  safeHandle('media:replaceFile', async (_, id: string, newSourcePath: string) => {
    const engine = getMediaEngine();
    return engine.replaceMediaFile(id, newSourcePath);
  });

  safeHandle('media:replaceFileDialog', async (_, id: string) => {
    // Get the current media to determine file type filter
    const engine = getMediaEngine();
    const currentMedia = await engine.getMedia(id);
    if (!currentMedia) {
      return null;
    }

    // Build filter based on current media type
    let filters: { name: string; extensions: string[] }[] = [];
    if (currentMedia.mimeType.startsWith('image/')) {
      filters = [
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'] },
        { name: 'All Files', extensions: ['*'] },
      ];
    } else {
      filters = [{ name: 'All Files', extensions: ['*'] }];
    }

    const result = await dialog.showOpenDialog({
      title: 'Replace Media File',
      filters,
      properties: ['openFile'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return engine.replaceMediaFile(id, result.filePaths[0]);
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
    // and exposes it as an absolute preview path (e.g. /media/2025/01/uuid.jpg)
    // so inserted markdown uses root-absolute URLs.
    const engine = getMediaEngine();
    const relativePath = await engine.getRelativePath(id);
    const normalized = relativePath ?? `media/${id}`;
    return normalized.startsWith('/') ? normalized : `/${normalized}`;
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
      const dataDir = projectEngine.getDataDir(project.id, project.dataPath);
      // For thumbnails and meta: use dataDir (whether custom or internal)
      // This ensures all project data lives in the same location for backup
      engine.setProjectContext(project.id, dataDir, dataDir);
    }
    return engine.rebuildDatabaseFromFiles();
  });

  safeHandle('media:reindexText', async () => {
    const engine = getMediaEngine();
    return engine.reindexText();
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
      const dataDir = projectEngine.getDataDir(project.id, project.dataPath);
      // For thumbnails and meta: use dataDir (whether custom or internal)
      // This ensures all project data lives in the same location for backup
      engine.setProjectContext(project.id, dataDir, dataDir);
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

  safeHandle('app:getTitleBarMetrics', async (event) => {
    const ownerWindow = BrowserWindow.fromWebContents(event.sender);
    const buttonPosition = ownerWindow?.getWindowButtonPosition?.();
    if (!buttonPosition) {
      return null;
    }

    const estimatedClusterWidth = Math.max(52, Math.round(buttonPosition.y * 4));
    const trailingPadding = Math.max(8, Math.round(buttonPosition.y * 0.6));
    const macosLeftInset = Math.max(0, Math.round(buttonPosition.x + estimatedClusterWidth + trailingPadding));

    return { macosLeftInset };
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

  safeHandle('app:triggerMenuAction', async (event, action: string) => {
    const typedAction = action as AppMenuAction;

    if (typedAction === 'quit') {
      app.quit();
      return;
    }

    if (typedAction === 'viewOnGitHub') {
      await shell.openExternal('https://github.com/rfc1437/bDS');
      return;
    }

    if (typedAction === 'reportIssue') {
      await shell.openExternal('https://github.com/rfc1437/bDS/issues');
      return;
    }

    const handledByWebContents = runWebContentsMenuAction((event as any)?.sender, typedAction);
    if (handledByWebContents) {
      return;
    }

    const channel = APP_MENU_ACTION_EVENT_MAP[typedAction];
    if (!channel) {
      return;
    }
    event.sender.send(channel);
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
    if (!engine.isInitialized()) {
      await engine.syncOnStartup();
    }
    return engine.getProjectMetadata();
  });

  safeHandle('meta:setProjectMetadata', async (_, metadata: { name: string; description?: string }) => {
    const engine = getMetaEngine();
    await engine.setProjectMetadata(metadata);
    return engine.getProjectMetadata();
  });

  safeHandle('meta:updateProjectMetadata', async (_, updates: { name?: string; description?: string; dataPath?: string; mainLanguage?: string; defaultAuthor?: string; maxPostsPerPage?: number }) => {
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

        // Get default author from project settings
        const metaEngine = getMetaEngine();
        const projectMetadata = await metaEngine.getProjectMetadata();
        const defaultAuthor = projectMetadata?.defaultAuthor;

        const result = await executionEngine.executeImport(report, {
          uploadsFolder,
          defaultAuthor,
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

        // Emit import:complete event to notify UI to refresh
        ipcMain.emit('forward-to-renderer', 'import:complete', {
          taskId,
          success: result.success,
          posts: result.posts,
          media: result.media,
          pages: result.pages,
          tags: result.tags,
        });

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

  // ============ Metadata Diff Handlers ============

  safeHandle('metadataDiff:getStats', async () => {
    const { getMetadataDiffEngine } = await import('../engine/MetadataDiffEngine');
    const engine = getMetadataDiffEngine();
    const projectEngine = getProjectEngine();
    const activeProject = await projectEngine.getActiveProject();
    if (activeProject) {
      engine.setProjectContext(activeProject.id);
    }
    return engine.getTableStats();
  });

  safeHandle('metadataDiff:scan', async () => {
    const { getMetadataDiffEngine } = await import('../engine/MetadataDiffEngine');
    const engine = getMetadataDiffEngine();
    const projectEngine = getProjectEngine();
    const activeProject = await projectEngine.getActiveProject();
    if (activeProject) {
      engine.setProjectContext(activeProject.id);
    }

    // Forward progress events to renderer
    const taskId = `metadata-diff-scan-${Date.now()}`;
    
    return taskManager.runTask({
      id: taskId,
      name: 'Scanning for metadata differences',
      execute: async (onProgress) => {
        return engine.scanAllPublishedPosts((current, total, message) => {
          const percent = total > 0 ? (current / total) * 100 : 0;
          onProgress(percent, message);
        });
      },
    });
  });

  safeHandle('metadataDiff:syncDbToFile', async (_, postIds: string[], groupLabel: string) => {
    const { getMetadataDiffEngine } = await import('../engine/MetadataDiffEngine');
    const engine = getMetadataDiffEngine();
    const projectEngine = getProjectEngine();
    const activeProject = await projectEngine.getActiveProject();
    if (activeProject) {
      engine.setProjectContext(activeProject.id);
    }
    return engine.runSyncDbToFileTask(postIds, groupLabel);
  });

  safeHandle('metadataDiff:syncFileToDb', async (_, postIds: string[], field: string, groupLabel: string) => {
    const { getMetadataDiffEngine } = await import('../engine/MetadataDiffEngine');
    const engine = getMetadataDiffEngine();
    const projectEngine = getProjectEngine();
    const activeProject = await projectEngine.getActiveProject();
    if (activeProject) {
      engine.setProjectContext(activeProject.id);
    }
    return engine.runSyncFileToDbTask(postIds, field as 'tags' | 'categories' | 'title' | 'excerpt' | 'author', groupLabel);
  });

  // ============ Sitemap Generation ============

  safeHandle('blog:generateSitemap', async () => {
    const projectEngine = getProjectEngine();
    const project = await projectEngine.getActiveProject();
    if (!project) {
      throw new Error('No active project');
    }

    const dataDir = projectEngine.getDataDir(project.id, project.dataPath);
    const taskId = `sitemap-generate-${Date.now()}`;

    return taskManager.runTask({
      id: taskId,
      name: 'Generate Sitemap',
      execute: async (onProgress) => {
        onProgress(0, 'Loading posts...');

        const db = getDatabase().getLocal();
        const { posts: postsTable } = await import('../database/schema');
        const { eq: eqOp, desc: descOp } = await import('drizzle-orm');

        const dbPosts = await db
          .select()
          .from(postsTable)
          .where(eqOp(postsTable.projectId, project.id))
          .orderBy(descOp(postsTable.createdAt))
          .all();

        // Only include published posts (not drafts or archived) in sitemap
        const publishedPosts = dbPosts.filter(p => p.status === 'published');

        onProgress(10, `Found ${publishedPosts.length} published posts`);

        const baseUrl = 'http://127.0.0.1:4123';
        const now = new Date().toISOString();

        // Collect all unique tags, categories, and year/month/day archives
        const allTags = new Set<string>();
        const allCategories = new Set<string>();
        const yearMonths = new Map<string, Date>(); // key -> most recent post date
        const years = new Map<number, Date>(); // year -> most recent post date
        const yearMonthDays = new Map<string, Date>(); // YYYY/MM/DD -> most recent post date

        const postUrls: Array<{ loc: string; lastmod: string }> = [];

        for (const post of publishedPosts) {
          // Parse tags and categories
          const tags: string[] = JSON.parse(post.tags || '[]');
          const categories: string[] = JSON.parse(post.categories || '[]');

          for (const tag of tags) allTags.add(tag);
          for (const cat of categories) allCategories.add(cat);

          // Build canonical post URL using shared helpers
          const createdAt = resolvePostCreatedAt(post);
          const canonicalPath = buildCanonicalPreviewPath(createdAt, post.slug);
          const postUrl = `${baseUrl}${canonicalPath}`;
          const updatedAt = post.updatedAt instanceof Date 
            ? post.updatedAt 
            : new Date(post.updatedAt as unknown as Date | string | number);
          postUrls.push({ loc: postUrl, lastmod: updatedAt.toISOString() });

          // Track archives
          const year = createdAt.getFullYear();
          const month = String(createdAt.getMonth() + 1).padStart(2, '0');
          const day = String(createdAt.getDate()).padStart(2, '0');
          const ymKey = `${year}/${month}`;
          const ymdKey = `${year}/${month}/${day}`;

          if (!yearMonths.has(ymKey) || updatedAt > yearMonths.get(ymKey)!) {
            yearMonths.set(ymKey, updatedAt);
          }
          if (!years.has(year) || updatedAt > years.get(year)!) {
            years.set(year, updatedAt);
          }
          if (!yearMonthDays.has(ymdKey) || updatedAt > yearMonthDays.get(ymdKey)!) {
            yearMonthDays.set(ymdKey, updatedAt);
          }
        }

        onProgress(40, 'Building sitemap XML...');

        // Build XML sitemap
        const urls: string[] = [];

        // Homepage
        urls.push(buildSitemapUrl(baseUrl + '/', now, 'daily', '1.0'));

        // Individual posts
        for (const post of postUrls) {
          urls.push(buildSitemapUrl(post.loc, post.lastmod, 'monthly', '0.8'));
        }

        onProgress(55, 'Adding archive pages...');

        // Year archives
        for (const [year, lastmod] of Array.from(years.entries()).sort((a, b) => b[0] - a[0])) {
          urls.push(buildSitemapUrl(`${baseUrl}/${year}`, lastmod.toISOString(), 'monthly', '0.5'));
        }

        // Year/Month archives
        for (const [ym, lastmod] of Array.from(yearMonths.entries()).sort().reverse()) {
          urls.push(buildSitemapUrl(`${baseUrl}/${ym}`, lastmod.toISOString(), 'monthly', '0.5'));
        }

        // Year/Month/Day archives
        for (const [ymd, lastmod] of Array.from(yearMonthDays.entries()).sort().reverse()) {
          urls.push(buildSitemapUrl(`${baseUrl}/${ymd}`, lastmod.toISOString(), 'monthly', '0.4'));
        }

        onProgress(70, 'Adding category pages...');

        // Category pages
        for (const category of Array.from(allCategories).sort()) {
          urls.push(buildSitemapUrl(
            `${baseUrl}/category/${encodeURIComponent(category)}`,
            now,
            'weekly',
            '0.6',
          ));
        }

        onProgress(80, 'Adding tag pages...');

        // Tag pages
        for (const tag of Array.from(allTags).sort()) {
          urls.push(buildSitemapUrl(
            `${baseUrl}/tag/${encodeURIComponent(tag)}`,
            now,
            'weekly',
            '0.6',
          ));
        }

        onProgress(90, 'Writing sitemap file...');

        const xml = [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
          ...urls,
          '</urlset>',
          '',
        ].join('\n');

        // Write to html folder in the project data directory
        const htmlDir = path.join(dataDir, 'html');
        await fsPromises.mkdir(htmlDir, { recursive: true });
        const sitemapPath = path.join(htmlDir, 'sitemap.xml');
        await fsPromises.writeFile(sitemapPath, xml, 'utf-8');

        onProgress(100, `Sitemap generated with ${urls.length} URLs`);

        return {
          path: sitemapPath,
          urlCount: urls.length,
          postCount: postUrls.length,
          tagCount: allTags.size,
          categoryCount: allCategories.size,
          archiveCount: years.size + yearMonths.size + yearMonthDays.size,
        };
      },
    });
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
  mediaEngine.on('mediaFileReplaced', forwardEvent('media:fileReplaced'));
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
