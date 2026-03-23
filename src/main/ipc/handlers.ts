import { app, BrowserWindow, ipcMain, dialog, shell, clipboard } from 'electron';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import * as path from 'path';
import * as fsPromises from 'fs/promises';
import { eq } from 'drizzle-orm';
import type { PostData, PostFilter, PaginationOptions } from '../engine/PostEngine';
import type { MediaData } from '../engine/MediaEngine';
import type { ProjectData } from '../engine/ProjectEngine';
import { MetaEngine } from '../engine/MetaEngine';
import type { MenuDocument } from '../engine/MenuEngine';
import type { CreateScriptInput, UpdateScriptInput } from '../engine/ScriptEngine';
import type { CreateTemplateInput, UpdateTemplateInput } from '../engine/TemplateEngine';
import { getDatabase } from '../database';
import { media } from '../database/schema';
import { APP_MENU_ACTION_EVENT_MAP, APP_MENU_WEB_CONTENTS_ACTIONS, type AppMenuAction } from '../shared/menuCommands';
import { generateBlogmarkBookmarkletSource } from '../shared/blogmark';
import { registerMetadataDiffHandlers } from './metadataDiffHandlers';
import { registerBlogHandlers } from './blogHandlers';
import { registerPublishHandlers } from './publishHandlers';
import { registerEmbeddingHandlers } from './embeddingHandlers';
import { isOfflineModeActive } from './chatHandlers';
import type { EngineBundle } from '../engine/EngineBundle';
import { resolveUiLanguageFromSystemLocale, translateMenu } from '../shared/i18n';
import { autoTranslatePost, autoTranslateMediaMetadata, autoAnalyzeMediaImage } from './chatHandlers';
import { v4 as uuidv4 } from 'uuid';

const SUPPORTED_DROP_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp']);
const SUPPORTED_DROP_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp']);

/**
 * Wrap an IPC handler so that "Database is closing" errors during shutdown
 * are silently swallowed instead of being logged as scary red error messages.
 */
function isDatabaseClosingError(error: unknown): error is { message: string } {
  return typeof error === 'object' && error !== null && 'message' in error && (error as { message: unknown }).message === 'Database is closing';
}

function safeHandle<Args extends unknown[], Result>(channel: string, handler: (event: IpcMainInvokeEvent, ...args: Args) => Promise<Result>): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await handler(event, ...(args as Args));
    } catch (error) {
      if (isDatabaseClosingError(error)) {
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

function runWebContentsMenuAction(sender: WebContents | undefined, action: AppMenuAction): boolean {
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
    if (sender.isDevToolsOpened?.()) {
      sender.closeDevTools?.();
    } else {
      sender.openDevTools?.({ mode: 'detach' });
    }
    return true;
  case 'reload':
    sender.reload?.();
    return true;
  case 'forceReload':
    sender.reloadIgnoringCache?.();
    return true;
  case 'resetZoom':
    sender.setZoomLevel?.(0);
    return true;
  case 'zoomIn': {
    const currentZoomLevel = sender.getZoomLevel?.() ?? 0;
    sender.setZoomLevel?.(currentZoomLevel + 0.5);
    return true;
  }
  case 'zoomOut': {
    const currentZoomLevel = sender.getZoomLevel?.() ?? 0;
    sender.setZoomLevel?.(currentZoomLevel - 0.5);
    return true;
  }
  case 'toggleFullScreen': {
    const ownerWindow = BrowserWindow.fromWebContents(sender);
    if (!ownerWindow) {
      return false;
    }
    ownerWindow.setFullScreen(!ownerWindow.isFullScreen());
    return true;
  }
  default:
    return false;
  }
}

function assertSupportedDropImage(params: { filePath?: string; fileName?: string; mimeType?: string }): void {
  const mimeType = params.mimeType?.trim().toLowerCase();
  if (mimeType && SUPPORTED_DROP_IMAGE_MIME_TYPES.has(mimeType)) {
    return;
  }

  const nameForExtension = params.filePath || params.fileName || '';
  const extension = path.extname(nameForExtension).toLowerCase();
  if (SUPPORTED_DROP_IMAGE_EXTENSIONS.has(extension)) {
    return;
  }

  throw new Error('Only image files can be imported into the media library from drag-and-drop or paste.');
}

async function handleDroppedImageImport(
  bundle: EngineBundle,
  postId: string,
  importMedia: (metadata: Partial<MediaData>) => Promise<MediaData>,
): Promise<{ mediaId: string; alt: string; relativePath: string }> {
  const mediaEngine = bundle.mediaEngine;
  const postMediaEngine = bundle.postMediaEngine;
  const postEngine = bundle.postEngine;
  const metaEngine = bundle.metaEngine;

  const projectMetadata = await metaEngine.getProjectMetadata();
  const mainLanguage = projectMetadata?.mainLanguage || 'en';
  const blogLanguages: string[] = projectMetadata?.blogLanguages || [];

  const metadata: Partial<MediaData> = {};
  if (projectMetadata?.defaultAuthor) {
    metadata.author = projectMetadata.defaultAuthor;
  }
  metadata.language = mainLanguage;

  const importedMedia = await importMedia(metadata);

  const db = getDatabase().getLocal();
  const dbMedia = await db.select().from(media).where(eq(media.id, importedMedia.id)).get();
  if (dbMedia?.filePath && importedMedia.mimeType.startsWith('image/') && !importedMedia.mimeType.includes('svg')) {
    try {
      await mediaEngine.generateThumbnails(importedMedia.id, dbMedia.filePath);
    } catch {
      // Non-critical: AI analysis will fall back to other thumbnail sizes
    }
  }

  await postMediaEngine.linkMediaToPost(postId, importedMedia.id);

  let alt = importedMedia.alt || '';
  const analysis = await autoAnalyzeMediaImage(importedMedia.id, mainLanguage);
  if (analysis.success) {
    await mediaEngine.updateMedia(importedMedia.id, {
      title: analysis.title,
      alt: analysis.alt,
      caption: analysis.caption,
      language: mainLanguage,
    });
    alt = analysis.alt || alt;

    const otherLanguages = blogLanguages.filter(lang => lang !== mainLanguage);
    for (const targetLang of otherLanguages) {
      await autoTranslateMediaMetadata(importedMedia.id, targetLang).catch(() => {
        // Non-critical: translation failure shouldn't block the drop
      });
    }
  }

  const post = await postEngine.getPost(postId);
  if (post?.status === 'published') {
    await postEngine.updatePost(postId, { content: post.content || '', status: 'draft' });
  }

  const relativePath = await mediaEngine.getRelativePath(importedMedia.id);

  return {
    mediaId: importedMedia.id,
    alt,
    relativePath: relativePath || `media/${importedMedia.filename}`,
  };
}

function buildMcpAgentConfigOptions(): import('../engine/MCPAgentConfigEngine').MCPAgentConfigOptions {
  const os = require('os') as typeof import('os');
  const scriptPath = app.isPackaged
    ? path.join(process.resourcesPath, 'bds-mcp.cjs')
    : path.join(app.getAppPath(), 'dist', 'cli', 'bds-mcp.cjs');
  return {
    homeDir: os.homedir(),
    platform: process.platform,
    execPath: process.execPath,
    scriptPath,
  };
}

/**
 * Start a background task that indexes all unindexed posts for semantic similarity.
 * Shows progress in the TaskPopup so the user can see model loading and indexing progress.
 */
export function startEmbeddingIndexTask(bundle: EngineBundle): void {
  const systemLocale = typeof app.getLocale === 'function' ? app.getLocale() : 'en';
  const lang = resolveUiLanguageFromSystemLocale(systemLocale);
  const tr = (key: string) => translateMenu(lang, key);

  bundle.taskManager.runTask({
    id: `embedding-index-${Date.now()}`,
    name: tr('task.embeddingIndex.name'),
    execute: async (onProgress) => {
      onProgress(0, tr('task.embeddingIndex.loading'));
      await bundle.embeddingEngine.indexUnindexedPosts((indexed, total) => {
        const pct = total > 0 ? Math.round((indexed / total) * 100) : 0;
        onProgress(pct, tr('task.embeddingIndex.indexing')
          .replace('{indexed}', String(indexed))
          .replace('{total}', String(total)));
      });
    },
  }).catch(() => {});
}

/**
 * Start a background task that fully rebuilds the embedding index.
 * Clears existing embeddings and re-indexes all posts with progress reporting.
 */
export function startRebuildEmbeddingIndexTask(bundle: EngineBundle): void {
  const systemLocale = typeof app.getLocale === 'function' ? app.getLocale() : 'en';
  const lang = resolveUiLanguageFromSystemLocale(systemLocale);
  const tr = (key: string) => translateMenu(lang, key);

  bundle.taskManager.runTask({
    id: `rebuild-embedding-index-${Date.now()}`,
    name: tr('task.rebuildEmbeddingIndex.name'),
    execute: async (onProgress) => {
      onProgress(0, tr('task.rebuildEmbeddingIndex.clearing'));
      await bundle.embeddingEngine.reindexAll((indexed, total) => {
        const pct = total > 0 ? Math.round((indexed / total) * 100) : 0;
        onProgress(pct, tr('task.embeddingIndex.indexing')
          .replace('{indexed}', String(indexed))
          .replace('{total}', String(total)));
      });
    },
  }).catch(() => {});
}

/**
 * Start a background task that searches for duplicate posts using semantic similarity.
 * Once complete, the results are forwarded to the renderer via 'embeddings:duplicateSearchResult'.
 */
export function startDuplicateSearchTask(bundle: EngineBundle, threshold = 0.92): void {
  const systemLocale = typeof app.getLocale === 'function' ? app.getLocale() : 'en';
  const lang = resolveUiLanguageFromSystemLocale(systemLocale);
  const tr = (key: string) => translateMenu(lang, key);

  bundle.taskManager.runTask({
    id: `duplicate-search-${Date.now()}`,
    name: tr('task.duplicateSearch.name'),
    execute: async (onProgress) => {
      onProgress(0, tr('task.duplicateSearch.searching').replace('{checked}', '0').replace('{total}', '…'));
      const pairs = await bundle.embeddingEngine.findDuplicates(threshold, (checked, total) => {
        const pct = total > 0 ? Math.round((checked / total) * 100) : 0;
        onProgress(pct, tr('task.duplicateSearch.searching')
          .replace('{checked}', String(checked))
          .replace('{total}', String(total)));
      });
      onProgress(100, tr('task.duplicateSearch.name'));
      return pairs;
    },
  }).then((pairs) => {
    ipcMain.emit('forward-to-renderer', 'embeddings:duplicateSearchResult', pairs);
  }).catch(() => {});
}

export function registerIpcHandlers(bundle: EngineBundle): void {
  // ============ Git Handlers ============

  safeHandle('git:checkAvailability', async () => {
    const engine = bundle.gitEngine;
    return engine.checkAvailability();
  });

  safeHandle('git:getRepoState', async (_, projectPath: string) => {
    const engine = bundle.gitEngine;
    return engine.getRepoState(projectPath);
  });

  safeHandle('git:status', async (_, projectPath: string) => {
    const engine = bundle.gitEngine;
    return engine.getStatus(projectPath);
  });

  safeHandle('git:diff', async (_, projectPath: string, filePath: string) => {
    const engine = bundle.gitEngine;
    return engine.getDiff(projectPath, filePath);
  });

  safeHandle('git:diffContent', async (_, projectPath: string, filePath: string) => {
    const engine = bundle.gitEngine;
    return engine.getDiffContent(projectPath, filePath);
  });

  safeHandle('git:commitDiffContent', async (_, projectPath: string, commitHash: string) => {
    const engine = bundle.gitEngine;
    return engine.getCommitDiffContent(projectPath, commitHash);
  });

  safeHandle('git:history', async (_, projectPath: string, limit?: number) => {
    const engine = bundle.gitEngine;
    return engine.getHistory(projectPath, limit);
  });

  safeHandle('git:fileHistory', async (_, projectPath: string, filePath: string, limit?: number) => {
    const engine = bundle.gitEngine;
    return engine.getFileHistory(projectPath, filePath, limit);
  });

  safeHandle('git:remoteState', async (_, projectPath: string) => {
    if (isOfflineModeActive()) {
      return { ahead: 0, behind: 0 };
    }
    const engine = bundle.gitEngine;
    return engine.getRemoteState(projectPath);
  });

  safeHandle('git:fetch', async (_, projectPath: string) => {
    if (isOfflineModeActive()) {
      return { success: false, code: 'offline' };
    }
    const engine = bundle.gitEngine;
    return engine.fetch(projectPath);
  });

  safeHandle('git:pull', async (_, projectPath: string) => {
    if (isOfflineModeActive()) {
      return { success: false, code: 'offline' };
    }
    const engine = bundle.gitEngine;
    const beforeHead = await engine.getHeadCommit(projectPath);
    const pullResult = await engine.pull(projectPath);

    if (!pullResult.success) {
      return pullResult;
    }

    const afterHead = await engine.getHeadCommit(projectPath);
    if (!beforeHead || !afterHead || beforeHead === afterHead) {
      return pullResult;
    }

    const [changedPostFiles, changedScriptFiles, changedTemplateFiles] = await Promise.all([
      engine.getChangedPostFilesBetween(projectPath, beforeHead, afterHead),
      engine.getChangedScriptFilesBetween(projectPath, beforeHead, afterHead),
      engine.getChangedTemplateFilesBetween(projectPath, beforeHead, afterHead),
    ]);
    if (changedPostFiles.length === 0 && changedScriptFiles.length === 0 && changedTemplateFiles.length === 0) {
      return pullResult;
    }

    try {
      const projectEngine = bundle.projectEngine;
      const project = await projectEngine.getActiveProject();
      const postEngine = bundle.postEngine;
      const scriptEngine = bundle.scriptEngine;
      const templateEngine = bundle.templateEngine;

      if (project) {
        const dataDir = projectEngine.getDataDir(project.id, project.dataPath);
        postEngine.setProjectContext(project.id, dataDir);
        scriptEngine.setProjectContext(project.id, dataDir);
        templateEngine.setProjectContext(project.id, dataDir);
      }

      await Promise.all([
        changedPostFiles.length > 0
          ? postEngine.reconcilePublishedPostsFromGitChanges(projectPath, changedPostFiles)
          : Promise.resolve(),
        changedScriptFiles.length > 0
          ? scriptEngine.reconcileScriptsFromGitChanges(projectPath, changedScriptFiles)
          : Promise.resolve(),
        changedTemplateFiles.length > 0
          ? templateEngine.reconcileTemplatesFromGitChanges(projectPath, changedTemplateFiles)
          : Promise.resolve(),
      ]);
    } catch (error) {
      console.error('Failed to reconcile published posts/scripts/templates after git pull:', error);
    }

    return pullResult;
  });

  safeHandle('git:push', async (_, projectPath: string) => {
    if (isOfflineModeActive()) {
      return { success: false, code: 'offline' };
    }
    const engine = bundle.gitEngine;
    return engine.push(projectPath);
  });

  safeHandle('git:commitAll', async (_, projectPath: string, message: string) => {
    const engine = bundle.gitEngine;
    return engine.commitAll(projectPath, message);
  });

  safeHandle('git:init', async (event, projectPath: string, remoteUrl?: string) => {
    const engine = bundle.gitEngine;
    return engine.initializeRepo(projectPath, remoteUrl, (progress) => {
      event.sender.send('git:initProgress', progress);
    });
  });

  safeHandle('git:ensureGitignore', async (_, projectPath: string) => {
    const engine = bundle.gitEngine;
    return engine.ensureGitignore(projectPath);
  });

  safeHandle('git:pruneLfs', async (_, projectPath: string, options?: { dryRun?: boolean; verifyRemote?: boolean }) => {
    const engine = bundle.gitEngine;
    return engine.pruneLfsCache(projectPath, options);
  });

  // ============ Project Handlers ============

  safeHandle('projects:create', async (_, data: { name: string; description?: string; slug?: string; dataPath?: string }) => {
    const engine = bundle.projectEngine;
    return engine.createProject(data);
  });

  safeHandle('projects:update', async (_, id: string, data: Partial<ProjectData>) => {
    const engine = bundle.projectEngine;
    return engine.updateProject(id, data);
  });

  safeHandle('projects:delete', async (_, id: string) => {
    const engine = bundle.projectEngine;
    return engine.deleteProject(id);
  });

  safeHandle('projects:deleteWithData', async (_, id: string) => {
    const engine = bundle.projectEngine;
    return engine.deleteProjectWithData(id);
  });

  safeHandle('app:getSystemLanguage', async () => {
    return app.getLocale();
  });

  safeHandle('projects:get', async (_, id: string) => {
    const engine = bundle.projectEngine;
    return engine.getProject(id);
  });

  safeHandle('projects:getAll', async () => {
    const engine = bundle.projectEngine;
    return engine.getAllProjects();
  });

  safeHandle('projects:getActive', async () => {
    const projectEngine = bundle.projectEngine;
    const project = await projectEngine.getActiveProject();

    // Ensure all engines have the correct project context
    if (project) {
      const dataDir = projectEngine.getDataDir(project.id, project.dataPath);
      // For thumbnails and meta: use dataDir (whether custom or internal)
      // This ensures all project data lives in the same location for backup
      const postEngine = bundle.postEngine;
      const mediaEngine = bundle.mediaEngine;
      const metaEngine = bundle.metaEngine;
      const menuEngine = bundle.menuEngine;
      const tagEngine = bundle.tagEngine;
      const scriptEngine = bundle.scriptEngine;
      const templateEngine = bundle.templateEngine;
      postEngine.setProjectContext(project.id, dataDir);
      mediaEngine.setProjectContext(project.id, dataDir, dataDir);
      metaEngine.setProjectContext(project.id, dataDir);
      menuEngine.setProjectContext(project.id, dataDir);
      tagEngine.setProjectContext(project.id, dataDir);
      scriptEngine.setProjectContext(project.id, dataDir);
      templateEngine.setProjectContext(project.id, dataDir);
      const postMediaEngine = bundle.postMediaEngine;
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
        postEngine.setMainLanguage(metadata.mainLanguage);
      }
    }

    return project;
  });

  safeHandle('projects:setActive', async (_, id: string) => {
    const projectEngine = bundle.projectEngine;
    const project = await projectEngine.setActiveProject(id);

    // Update all engines to use the new project context
    if (project) {
      const dataDir = projectEngine.getDataDir(project.id, project.dataPath);
      // For thumbnails and meta: use dataDir (whether custom or internal)
      // This ensures all project data lives in the same location for backup
      const postEngine = bundle.postEngine;
      const mediaEngine = bundle.mediaEngine;
      const metaEngine = bundle.metaEngine;
      const menuEngine = bundle.menuEngine;
      const tagEngine = bundle.tagEngine;
      const scriptEngine = bundle.scriptEngine;
      const templateEngine = bundle.templateEngine;
      postEngine.setProjectContext(project.id, dataDir);
      mediaEngine.setProjectContext(project.id, dataDir, dataDir);
      metaEngine.setProjectContext(project.id, dataDir);
      menuEngine.setProjectContext(project.id, dataDir);
      tagEngine.setProjectContext(project.id, dataDir);
      scriptEngine.setProjectContext(project.id, dataDir);
      templateEngine.setProjectContext(project.id, dataDir);
      const postMediaEngine = bundle.postMediaEngine;
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
        postEngine.setMainLanguage(metadata.mainLanguage);
      }
    }

    return project;
  });

  // ============ Post Handlers ============

  // Auto-translate: enqueue translation tasks for each blog language that does
  // not yet have a translation. Only triggered on manual save or publish.
  const enqueueAutoTranslations = async (post: PostData): Promise<void> => {
    if (post.doNotTranslate) {
      return;
    }
    const metadata = await bundle.metaEngine.getProjectMetadata();
    if (!metadata) {
      return;
    }
    const blogLanguages = metadata.blogLanguages || [];
    const mainLang = metadata.mainLanguage || 'en';
    const postLang = post.language || mainLang;
    const targetLanguages = blogLanguages.filter((lang) => lang !== postLang);
    if (targetLanguages.length === 0) {
      return;
    }

    const existingTranslations = await bundle.postEngine.getPostTranslations(post.id);
    const existingLangs = new Set(existingTranslations.map((t) => t.language));
    const missingLanguages = targetLanguages.filter((lang) => !existingLangs.has(lang));
    if (missingLanguages.length === 0) {
      return;
    }

    const groupId = uuidv4();
    for (const targetLang of missingLanguages) {
      bundle.taskManager.runTask({
        id: uuidv4(),
        name: `Translate "${post.title}" → ${targetLang}`,
        groupId,
        groupName: `Auto-translate: ${post.title}`,
        execute: async (onProgress) => {
          onProgress(10, `Translating to ${targetLang}...`);
          const result = await autoTranslatePost(post.id, targetLang);
          if (!result.success) {
            throw new Error(result.error || `Translation to ${targetLang} failed`);
          }
          onProgress(70, 'Translating linked media...');
          // Cascade: translate linked media metadata
          const links = await bundle.postMediaEngine.getLinkedMediaForPost(post.id);
          for (const link of links) {
            const mediaTranslations = await bundle.mediaEngine.getMediaTranslations(link.mediaId);
            const hasLang = mediaTranslations.some((t) => t.language === targetLang);
            if (!hasLang) {
              await autoTranslateMediaMetadata(link.mediaId, targetLang).catch(() => {});
            }
          }
          onProgress(100, 'Done');
        },
      }).catch((error) => {
        console.error(`[Auto-translate] Failed for ${post.id} → ${targetLang}:`, error);
      });
    }
  };

  safeHandle('posts:create', async (_, data: Partial<PostData>) => {
    const engine = bundle.postEngine;
    
    // If no author provided, use default author from project settings
    if (!data.author) {
      const metaEngine = bundle.metaEngine;
      const metadata = await metaEngine.getProjectMetadata();
      if (metadata?.defaultAuthor) {
        data.author = metadata.defaultAuthor;
      }
    }

    // If no language provided, default from project settings
    if (!data.language) {
      const metaEngine = bundle.metaEngine;
      const metadata = await metaEngine.getProjectMetadata();
      if (metadata?.mainLanguage) {
        data.language = metadata.mainLanguage;
      }
    }
    
    return engine.createPost(data);
  });

  safeHandle('posts:isSlugAvailable', async (_, slug: string, excludePostId?: string) => {
    const engine = bundle.postEngine;
    return engine.isSlugAvailable(slug, excludePostId);
  });

  safeHandle('posts:generateUniqueSlug', async (_, title: string, excludePostId?: string) => {
    const engine = bundle.postEngine;
    return engine.generateUniqueSlug(title, excludePostId);
  });

  safeHandle('posts:update', async (_, id: string, data: Partial<PostData>) => {
    const engine = bundle.postEngine;
    return engine.updatePost(id, data);
  });

  safeHandle('posts:requestAutoTranslation', async (_, id: string) => {
    const post = await bundle.postEngine.getPost(id);
    if (post) {
      await enqueueAutoTranslations(post);
    }
  });

  safeHandle('posts:delete', async (_, id: string) => {
    const engine = bundle.postEngine;
    return engine.deletePost(id);
  });

  safeHandle('posts:get', async (_, id: string) => {
    const engine = bundle.postEngine;
    return engine.getPost(id);
  });

  safeHandle('posts:getBySlug', async (_, slug: string) => {
    const engine = bundle.postEngine;
    return engine.getPostBySlug(slug);
  });

  safeHandle('posts:getTranslation', async (_, postId: string, language: string) => {
    const engine = bundle.postEngine;
    return engine.getPostTranslation(postId, language);
  });

  safeHandle('posts:getTranslations', async (_, postId: string) => {
    const engine = bundle.postEngine;
    return engine.getPostTranslations(postId);
  });

  safeHandle('posts:upsertTranslation', async (_, postId: string, language: string, data: Record<string, unknown>) => {
    const engine = bundle.postEngine;
    return engine.upsertPostTranslation(postId, language, data as never);
  });

  safeHandle('posts:publishTranslation', async (_, postId: string, language: string) => {
    const engine = bundle.postEngine;
    return engine.publishPostTranslation(postId, language);
  });

  safeHandle('posts:getPreviewUrl', async (_, id: string, options?: { draft?: boolean; lang?: string }) => {
    const engine = bundle.postEngine;
    const post = await engine.getPost(id);

    if (!post) {
      return null;
    }

    const createdAt = resolvePostCreatedAt(post);
    const canonicalPath = buildCanonicalPreviewPath(createdAt, post.slug);
    if (options?.draft) {
      const params = new URLSearchParams({ draft: 'true', postId: id });
      if (options.lang?.trim()) {
        params.set('lang', options.lang.trim().toLowerCase());
      }
      return `http://127.0.0.1:4123${canonicalPath}?${params.toString()}`;
    }

    if (options?.lang?.trim()) {
      return `http://127.0.0.1:4123${canonicalPath}?lang=${encodeURIComponent(options.lang.trim().toLowerCase())}`;
    }

    return `http://127.0.0.1:4123${canonicalPath}`;
  });

  safeHandle('posts:getAll', async (_, options?: PaginationOptions) => {
    const engine = bundle.postEngine;
    return engine.getAllPosts(options);
  });

  safeHandle('posts:getByStatus', async (_, status: 'draft' | 'published' | 'archived') => {
    const engine = bundle.postEngine;
    return engine.getPostsByStatus(status);
  });

  safeHandle('posts:publish', async (_, id: string) => {
    const engine = bundle.postEngine;
    const published = await engine.publishPost(id);
    if (published) {
      enqueueAutoTranslations(published);
    }
    return published;
  });

  safeHandle('posts:discard', async (_, id: string) => {
    const engine = bundle.postEngine;
    return engine.discardChanges(id);
  });

  safeHandle('posts:hasPublishedVersion', async (_, id: string) => {
    const engine = bundle.postEngine;
    return engine.hasPublishedVersion(id);
  });

  safeHandle('posts:rebuildFromFiles', async () => {
    // Ensure project context is current before rebuilding
    const projectEngine = bundle.projectEngine;
    const project = await projectEngine.getActiveProject();
    const engine = bundle.postEngine;
    const metaEngine = bundle.metaEngine;
    if (project) {
      const dataDir = projectEngine.getDataDir(project.id, project.dataPath);
      engine.setProjectContext(project.id, dataDir);
      metaEngine.setProjectContext(project.id, dataDir);
    }
    await engine.rebuildDatabaseFromFiles();
    await metaEngine.syncOnStartup();
    return true;
  });

  safeHandle('posts:search', async (_, query: string) => {
    const engine = bundle.postEngine;
    return engine.searchPosts(query);
  });

  safeHandle('posts:filter', async (_, filter: PostFilter) => {
    const engine = bundle.postEngine;
    return engine.getPostsFiltered(filter);
  });

  safeHandle('posts:getTags', async () => {
    const engine = bundle.postEngine;
    return engine.getAvailableTags();
  });

  safeHandle('posts:getCategories', async () => {
    const engine = bundle.postEngine;
    return engine.getAvailableCategories();
  });

  safeHandle('posts:getByYearMonth', async () => {
    const engine = bundle.postEngine;
    return engine.getPostsByYearMonth();
  });

  safeHandle('posts:getTagsWithCounts', async () => {
    const engine = bundle.postEngine;
    return engine.getTagsWithCounts();
  });

  safeHandle('posts:getCategoriesWithCounts', async () => {
    const engine = bundle.postEngine;
    return engine.getCategoriesWithCounts();
  });

  safeHandle('posts:getDashboardStats', async () => {
    const engine = bundle.postEngine;
    return engine.getDashboardStats();
  });

  safeHandle('posts:getLinksTo', async (_, id: string) => {
    const engine = bundle.postEngine;
    return engine.getLinksTo(id);
  });

  safeHandle('posts:getLinkedBy', async (_, id: string) => {
    const engine = bundle.postEngine;
    return engine.getLinkedBy(id);
  });

  safeHandle('posts:rebuildLinks', async () => {
    const engine = bundle.postEngine;
    return engine.rebuildAllPostLinks();
  });

  safeHandle('posts:reindexText', async () => {
    const projectEngine = bundle.projectEngine;
    const project = await projectEngine.getActiveProject();
    const engine = bundle.postEngine;
    if (project) {
      const dataDir = projectEngine.getDataDir(project.id, project.dataPath);
      engine.setProjectContext(project.id, dataDir);
    }
    return engine.reindexText();
  });

  // ============ Media Handlers ============

  safeHandle('media:import', async (_, sourcePath: string, metadata?: Partial<MediaData>) => {
    const engine = bundle.mediaEngine;
    
    // If no author provided, use default author from project settings
    if (!metadata?.author) {
      const metaEngine = bundle.metaEngine;
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
    const projectEngine = bundle.projectEngine;
    const project = await projectEngine.getActiveProject();
    const engine = bundle.mediaEngine;
    if (project) {
      const dataDir = projectEngine.getDataDir(project.id, project.dataPath);
      // For thumbnails and meta: use dataDir (whether custom or internal)
      // This ensures all project data lives in the same location for backup
      engine.setProjectContext(project.id, dataDir, dataDir);
    }

    const imported: MediaData[] = [];

    // Get default author from project settings
    const metaEngine = bundle.metaEngine;
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
    const engine = bundle.mediaEngine;
    return engine.updateMedia(id, data);
  });

  safeHandle('media:replaceFile', async (_, id: string, newSourcePath: string) => {
    const engine = bundle.mediaEngine;
    return engine.replaceMediaFile(id, newSourcePath);
  });

  safeHandle('media:replaceFileDialog', async (_, id: string) => {
    // Get the current media to determine file type filter
    const engine = bundle.mediaEngine;
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
    const engine = bundle.mediaEngine;
    return engine.deleteMedia(id);
  });

  safeHandle('media:get', async (_, id: string) => {
    const engine = bundle.mediaEngine;
    return engine.getMedia(id);
  });

  safeHandle('media:getUrl', async (_, id: string) => {
    // Returns the relative path for a media item (e.g. media/2025/01/uuid.jpg)
    // and exposes it as an absolute preview path (e.g. /media/2025/01/uuid.jpg)
    // so inserted markdown uses root-absolute URLs.
    const engine = bundle.mediaEngine;
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
    const engine = bundle.mediaEngine;
    return engine.getAllMedia();
  });

  safeHandle('media:filter', async (_, filter: import('../engine/MediaEngine').MediaFilter) => {
    const engine = bundle.mediaEngine;
    return engine.getMediaFiltered(filter);
  });

  safeHandle('media:search', async (_, query: string) => {
    const engine = bundle.mediaEngine;
    return engine.searchMedia(query);
  });

  safeHandle('media:getByYearMonth', async () => {
    const engine = bundle.mediaEngine;
    return engine.getMediaByYearMonth();
  });

  safeHandle('media:getTags', async () => {
    const engine = bundle.mediaEngine;
    return engine.getAvailableTags();
  });

  safeHandle('media:getTagsWithCounts', async () => {
    const engine = bundle.mediaEngine;
    return engine.getTagsWithCounts();
  });

  safeHandle('media:rebuildFromFiles', async () => {
    // Ensure project context is current before rebuilding
    const projectEngine = bundle.projectEngine;
    const project = await projectEngine.getActiveProject();
    const engine = bundle.mediaEngine;
    if (project) {
      const dataDir = projectEngine.getDataDir(project.id, project.dataPath);
      // For thumbnails and meta: use dataDir (whether custom or internal)
      // This ensures all project data lives in the same location for backup
      engine.setProjectContext(project.id, dataDir, dataDir);
    }
    return engine.rebuildDatabaseFromFiles();
  });

  safeHandle('media:reindexText', async () => {
    const engine = bundle.mediaEngine;
    return engine.reindexText();
  });

  safeHandle('media:getThumbnail', async (_, id: string, size?: 'small' | 'medium' | 'large') => {
    const engine = bundle.mediaEngine;
    return engine.getThumbnailDataUrl(id, size || 'small');
  });

  safeHandle('media:regenerateThumbnails', async (_, id: string) => {
    const engine = bundle.mediaEngine;
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
    const projectEngine = bundle.projectEngine;
    const project = await projectEngine.getActiveProject();
    const engine = bundle.mediaEngine;
    if (project) {
      const dataDir = projectEngine.getDataDir(project.id, project.dataPath);
      // For thumbnails and meta: use dataDir (whether custom or internal)
      // This ensures all project data lives in the same location for backup
      engine.setProjectContext(project.id, dataDir, dataDir);
    }
    return engine.regenerateMissingThumbnails();
  });

  // ============ Media Translation Handlers ============

  safeHandle('media:getTranslation', async (_, mediaId: string, language: string) => {
    const engine = bundle.mediaEngine;
    return engine.getMediaTranslation(mediaId, language);
  });

  safeHandle('media:getTranslations', async (_, mediaId: string) => {
    const engine = bundle.mediaEngine;
    return engine.getMediaTranslations(mediaId);
  });

  safeHandle('media:upsertTranslation', async (_, mediaId: string, language: string, data: { title?: string; alt?: string; caption?: string }) => {
    const engine = bundle.mediaEngine;
    return engine.upsertMediaTranslation(mediaId, language, data);
  });

  safeHandle('media:deleteTranslation', async (_, mediaId: string, language: string) => {
    const engine = bundle.mediaEngine;
    return engine.deleteMediaTranslation(mediaId, language);
  });

  // ============ Script Handlers ============

  safeHandle('scripts:create', async (_, data: CreateScriptInput) => {
    const engine = bundle.scriptEngine;
    return engine.createScript(data);
  });

  safeHandle('scripts:update', async (_, id: string, data: UpdateScriptInput) => {
    const engine = bundle.scriptEngine;
    return engine.updateScript(id, data);
  });

  safeHandle('scripts:delete', async (_, id: string) => {
    const engine = bundle.scriptEngine;
    return engine.deleteScript(id);
  });

  safeHandle('scripts:get', async (_, id: string) => {
    const engine = bundle.scriptEngine;
    return engine.getScript(id);
  });

  safeHandle('scripts:getAll', async () => {
    const engine = bundle.scriptEngine;
    return engine.getAllScripts();
  });

  // Internal: used by the editor macro plugin to detect known Python macros.
  // Intentionally excluded from the Python API contract and API.md because
  // it is an internal renderer helper, not a user-facing scripting API.
  safeHandle('scripts:getEnabledMacroSlugs', async () => {
    const engine = bundle.scriptEngine;
    const scripts = await engine.getEnabledMacroScripts();
    return scripts.map((s) => s.slug);
  });

  safeHandle('scripts:rebuildFromFiles', async () => {
    const projectEngine = bundle.projectEngine;
    const project = await projectEngine.getActiveProject();
    const engine = bundle.scriptEngine;
    if (project) {
      const dataDir = projectEngine.getDataDir(project.id, project.dataPath);
      engine.setProjectContext(project.id, dataDir);
    }
    await engine.rebuildDatabaseFromFiles();
    return true;
  });

  // ============ Script Task Lifecycle (external tasks for utility scripts) ====

  safeHandle('scripts:startTask', async (_, taskId: string, name: string) => {
    bundle.taskManager.startExternalTask(taskId, name);
  });

  safeHandle('scripts:completeTask', async (_, taskId: string) => {
    bundle.taskManager.completeExternalTask(taskId);
  });

  safeHandle('scripts:failTask', async (_, taskId: string, error: string) => {
    bundle.taskManager.failExternalTask(taskId, error);
  });

  // ============ Template Handlers ============

  safeHandle('templates:create', async (_, data: CreateTemplateInput) => {
    const engine = bundle.templateEngine;
    return engine.createTemplate(data);
  });

  safeHandle('templates:update', async (_, id: string, data: UpdateTemplateInput) => {
    const engine = bundle.templateEngine;
    return engine.updateTemplate(id, data);
  });

  safeHandle('templates:delete', async (_, id: string, options?: { force?: boolean }) => {
    const engine = bundle.templateEngine;
    return engine.deleteTemplate(id, options);
  });

  safeHandle('templates:get', async (_, id: string) => {
    const engine = bundle.templateEngine;
    return engine.getTemplate(id);
  });

  safeHandle('templates:getAll', async () => {
    const engine = bundle.templateEngine;
    return engine.getAllTemplates();
  });

  safeHandle('templates:getEnabledByKind', async (_, kind: string) => {
    const engine = bundle.templateEngine;
    return engine.getEnabledTemplatesByKind(kind as 'post' | 'list' | 'not-found' | 'partial');
  });

  safeHandle('templates:validate', async (_, content: string) => {
    const engine = bundle.templateEngine;
    return engine.validateTemplate(content);
  });

  safeHandle('templates:rebuildFromFiles', async () => {
    const projectEngine = bundle.projectEngine;
    const project = await projectEngine.getActiveProject();
    const engine = bundle.templateEngine;
    if (project) {
      const dataDir = projectEngine.getDataDir(project.id, project.dataPath);
      engine.setProjectContext(project.id, dataDir);
    }
    await engine.rebuildDatabaseFromFiles();
    return true;
  });

  // ============ Task Handlers ============

  safeHandle('tasks:getAll', async () => {
    return bundle.taskManager.getAllTasks();
  });

  safeHandle('tasks:getRunning', async () => {
    return bundle.taskManager.getRunningTasks();
  });

  safeHandle('tasks:cancel', async (_, taskId: string) => {
    return bundle.taskManager.cancelTask(taskId);
  });

  safeHandle('tasks:clearCompleted', async () => {
    return bundle.taskManager.clearCompletedTasks();
  });

  // ============ Sync Handlers (git operations via GitApiAdapter) ============

  safeHandle('sync:checkAvailability', async () => {
    return bundle.gitApiAdapter.checkAvailability();
  });

  safeHandle('sync:getRepoState', async () => {
    return bundle.gitApiAdapter.getRepoState();
  });

  safeHandle('sync:getStatus', async () => {
    return bundle.gitApiAdapter.getStatus();
  });

  safeHandle('sync:getHistory', async (_, limit?: number) => {
    return bundle.gitApiAdapter.getHistory(limit);
  });

  safeHandle('sync:getRemoteState', async () => {
    return bundle.gitApiAdapter.getRemoteState();
  });

  safeHandle('sync:fetch', async () => {
    return bundle.gitApiAdapter.fetch();
  });

  safeHandle('sync:pull', async () => {
    return bundle.gitApiAdapter.pull();
  });

  safeHandle('sync:push', async () => {
    return bundle.gitApiAdapter.push();
  });

  safeHandle('sync:commitAll', async (_, message: string) => {
    return bundle.gitApiAdapter.commitAll(message);
  });

  // ============ App Handlers ============

  safeHandle('app:getDataPaths', async () => {
    // Get paths for the active project
    const projectEngine = bundle.projectEngine;
    const activeProject = await projectEngine.getActiveProject();
    const projectId = activeProject?.id || 'default';
    const paths = projectEngine.getProjectPaths(projectId, activeProject?.dataPath);
    return {
      database: getDatabase().getDbPath(),
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
    const projectEngine = bundle.projectEngine;
    return projectEngine.getDefaultProjectBaseDir(projectId);
  });

  safeHandle('app:getBlogmarkBookmarklet', async () => {
    return generateBlogmarkBookmarkletSource();
  });

  safeHandle('app:copyToClipboard', async (_, text: string) => {
    clipboard.writeText(String(text ?? ''));
    return true;
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
        publicUrl: metadata.publicUrl || undefined,
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

    if (typedAction === 'openInBrowser') {
      await shell.openExternal('http://localhost:4123/');
      return;
    }

    if (typedAction === 'openDataFolder') {
      const dbPath = getDatabase().getDbPath();
      await shell.openPath(path.dirname(dbPath));
      return;
    }

    if (typedAction === 'reportIssue') {
      await shell.openExternal('https://github.com/rfc1437/bDS/issues');
      return;
    }

    if (typedAction === 'rebuildEmbeddingIndex') {
      startRebuildEmbeddingIndexTask(bundle);
      return;
    }

    const sender = event && typeof event === 'object' && 'sender' in event
      ? (event as IpcMainInvokeEvent).sender
      : undefined;
    const handledByWebContents = runWebContentsMenuAction(sender, typedAction);
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

  const ensureMetaContext = async (engine: MetaEngine) => {
    const projectEngine = bundle.projectEngine;
    const activeProject = await projectEngine.getActiveProject();
    if (!activeProject) {
      return;
    }

    const dataDir = projectEngine.getDataDir(activeProject.id, activeProject.dataPath);
    engine.setProjectContext(activeProject.id, dataDir);
  };

  const ensureMetaReady = async (engine: MetaEngine) => {
    await ensureMetaContext(engine);
    if (!engine.isInitialized()) {
      await engine.syncOnStartup();
    }
  };

  safeHandle('menu:get', async () => {
    const projectEngine = bundle.projectEngine;
    const menuEngine = bundle.menuEngine;
    const project = await projectEngine.getActiveProject();

    if (!project) {
      throw new Error('No active project');
    }

    const dataDir = projectEngine.getDataDir(project.id, project.dataPath);
    menuEngine.setProjectContext(project.id, dataDir);
    return menuEngine.getMenu();
  });

  safeHandle('menu:save', async (_, menu: MenuDocument) => {
    const projectEngine = bundle.projectEngine;
    const menuEngine = bundle.menuEngine;
    const project = await projectEngine.getActiveProject();

    if (!project) {
      throw new Error('No active project');
    }

    const dataDir = projectEngine.getDataDir(project.id, project.dataPath);
    menuEngine.setProjectContext(project.id, dataDir);
    return menuEngine.saveMenu(menu);
  });

  safeHandle('meta:getTags', async () => {
    const engine = bundle.metaEngine;
    await ensureMetaReady(engine);
    return engine.getTags();
  });

  safeHandle('meta:getCategories', async () => {
    const engine = bundle.metaEngine;
    await ensureMetaReady(engine);
    return engine.getCategories();
  });

  safeHandle('meta:addTag', async (_, tag: string) => {
    const engine = bundle.metaEngine;
    await ensureMetaReady(engine);
    await engine.addTag(tag);
    return engine.getTags();
  });

  safeHandle('meta:removeTag', async (_, tag: string) => {
    const engine = bundle.metaEngine;
    await ensureMetaReady(engine);
    await engine.removeTag(tag);
    return engine.getTags();
  });

  safeHandle('meta:addCategory', async (_, category: string) => {
    const engine = bundle.metaEngine;
    await ensureMetaReady(engine);
    await engine.addCategory(category);
    return engine.getCategories();
  });

  safeHandle('meta:removeCategory', async (_, category: string) => {
    const engine = bundle.metaEngine;
    await ensureMetaReady(engine);
    await engine.removeCategory(category);
    return engine.getCategories();
  });

  safeHandle('meta:syncOnStartup', async () => {
    const engine = bundle.metaEngine;
    await ensureMetaContext(engine);
    await engine.syncOnStartup();
    return {
      tags: await engine.getTags(),
      categories: await engine.getCategories(),
      projectMetadata: await engine.getProjectMetadata(),
    };
  });

  safeHandle('meta:getProjectMetadata', async () => {
    const engine = bundle.metaEngine;
    await ensureMetaReady(engine);
    return engine.getProjectMetadata();
  });

  safeHandle('meta:setProjectMetadata', async (_, metadata: { name: string; description?: string }) => {
    const engine = bundle.metaEngine;
    await ensureMetaContext(engine);
    await engine.setProjectMetadata(metadata);
    return engine.getProjectMetadata();
  });

  safeHandle('meta:updateProjectMetadata', async (_, updates: { name?: string; description?: string; dataPath?: string; publicUrl?: string; mainLanguage?: string; defaultAuthor?: string; maxPostsPerPage?: number; blogmarkCategory?: string; pythonRuntimeMode?: 'webworker' | 'main-thread'; picoTheme?: import('../shared/picoThemes').PicoThemeName; categoryMetadata?: Record<string, { renderInLists: boolean; showTitle: boolean; title: string }>; categorySettings?: Record<string, { renderInLists: boolean; showTitle: boolean }>; semanticSimilarityEnabled?: boolean; blogLanguages?: string[] }) => {
    const engine = bundle.metaEngine;
    await ensureMetaContext(engine);
    const previousMetadata = await engine.getProjectMetadata();
    const wasEnabled = previousMetadata?.semanticSimilarityEnabled === true;
    await engine.updateProjectMetadata(updates);
    if (updates.semanticSimilarityEnabled === true && !wasEnabled) {
      startEmbeddingIndexTask(bundle);
    }
    return engine.getProjectMetadata();
  });

  safeHandle('meta:getPublishingPreferences', async () => {
    const engine = bundle.metaEngine;
    await ensureMetaReady(engine);
    return engine.getPublishingPreferences();
  });

  safeHandle('meta:setPublishingPreferences', async (_, prefs: { sshHost: string; sshUser: string; sshRemotePath: string; sshMode: 'scp' | 'rsync' }) => {
    const engine = bundle.metaEngine;
    await ensureMetaContext(engine);
    await engine.setPublishingPreferences(prefs);
  });

  safeHandle('meta:clearPublishingPreferences', async () => {
    const engine = bundle.metaEngine;
    await ensureMetaContext(engine);
    await engine.clearPublishingPreferences();
  });

  // ============ Tag Management Handlers ============

  safeHandle('tags:getAll', async () => {
    const engine = bundle.tagEngine;
    return engine.getAllTags();
  });

  safeHandle('tags:getWithCounts', async () => {
    const engine = bundle.tagEngine;
    return engine.getTagsWithCounts();
  });

  safeHandle('tags:get', async (_, id: string) => {
    const engine = bundle.tagEngine;
    return engine.getTag(id);
  });

  safeHandle('tags:getByName', async (_, name: string) => {
    const engine = bundle.tagEngine;
    return engine.getTagByName(name);
  });

  safeHandle('tags:create', async (_, data: { name: string; color?: string }) => {
    const engine = bundle.tagEngine;
    return engine.createTag(data);
  });

  safeHandle('tags:update', async (_, id: string, data: { name?: string; color?: string | null; postTemplateSlug?: string | null }) => {
    const engine = bundle.tagEngine;
    return engine.updateTag(id, data);
  });

  safeHandle('tags:delete', async (_, id: string) => {
    const engine = bundle.tagEngine;
    return engine.deleteTag(id);
  });

  safeHandle('tags:merge', async (_, sourceTagIds: string[], targetTagId: string) => {
    const engine = bundle.tagEngine;
    return engine.mergeTags(sourceTagIds, targetTagId);
  });

  safeHandle('tags:rename', async (_, id: string, newName: string) => {
    const engine = bundle.tagEngine;
    return engine.renameTag(id, newName);
  });

  safeHandle('tags:getPostsWithTag', async (_, tagId: string) => {
    const engine = bundle.tagEngine;
    return engine.getPostsWithTag(tagId);
  });

  safeHandle('tags:syncFromPosts', async () => {
    const engine = bundle.tagEngine;
    return engine.syncTagsFromPosts();
  });

  // ============ Post-Media Link Handlers ============

  safeHandle('postMedia:link', async (_, postId: string, mediaId: string) => {
    const engine = bundle.postMediaEngine;
    return engine.linkMediaToPost(postId, mediaId);
  });

  safeHandle('postMedia:unlink', async (_, postId: string, mediaId: string) => {
    const engine = bundle.postMediaEngine;
    return engine.unlinkMediaFromPost(postId, mediaId);
  });

  safeHandle('postMedia:linkMany', async (_, postId: string, mediaIds: string[]) => {
    const engine = bundle.postMediaEngine;
    return engine.linkManyToPost(postId, mediaIds);
  });

  safeHandle('postMedia:unlinkMany', async (_, postId: string, mediaIds: string[]) => {
    const engine = bundle.postMediaEngine;
    return engine.unlinkManyFromPost(postId, mediaIds);
  });

  safeHandle('postMedia:getForPost', async (_, postId: string) => {
    const engine = bundle.postMediaEngine;
    return engine.getLinkedMediaForPost(postId);
  });

  safeHandle('postMedia:getForMedia', async (_, mediaId: string) => {
    const engine = bundle.postMediaEngine;
    return engine.getLinkedPostsForMedia(mediaId);
  });

  safeHandle('postMedia:getMediaDataForPost', async (_, postId: string) => {
    const engine = bundle.postMediaEngine;
    return engine.getLinkedMediaDataForPost(postId);
  });

  safeHandle('postMedia:reorder', async (_, postId: string, mediaIds: string[]) => {
    const engine = bundle.postMediaEngine;
    return engine.reorderMediaForPost(postId, mediaIds);
  });

  safeHandle('postMedia:isLinked', async (_, postId: string, mediaId: string) => {
    const engine = bundle.postMediaEngine;
    return engine.isMediaLinkedToPost(postId, mediaId);
  });

  safeHandle('postMedia:import', async (_, postId: string, filePath: string) => {
    const engine = bundle.postMediaEngine;
    return engine.importMediaForPost(postId, filePath);
  });

  safeHandle('postMedia:dropImport', async (_, postId: string, filePath: string) => {
    assertSupportedDropImage({ filePath });
    return handleDroppedImageImport(bundle, postId, (metadata) => bundle.mediaEngine.importMedia(filePath, metadata));
  });

  safeHandle('postMedia:dropImportBuffer', async (_, postId: string, payload: { fileName: string; mimeType: string; bytes: Uint8Array }) => {
    assertSupportedDropImage({ fileName: payload.fileName, mimeType: payload.mimeType });
    return handleDroppedImageImport(bundle, postId, (metadata) => bundle.mediaEngine.importMediaBuffer(payload.bytes, payload.fileName, {
      ...metadata,
      mimeType: payload.mimeType,
    }));
  });

  safeHandle('postMedia:rebuild', async () => {
    const engine = bundle.postMediaEngine;
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
    const projectEngine = bundle.projectEngine;
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
    const projectEngine = bundle.projectEngine;
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
    eta?: number,
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
    const projectEngine = bundle.projectEngine;
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
    const startTime = Date.now();

    const task = {
      id: taskId,
      name: `Import from ${report.site.title || 'WordPress'}`,
      execute: async (onProgress: (progress: number, message: string) => void) => {
        const executionEngine = new ImportExecutionEngine({
          tagEngine: bundle.tagEngine,
          postEngine: bundle.postEngine,
          mediaEngine: bundle.mediaEngine,
          postMediaEngine: bundle.postMediaEngine,
        });
        
        if (activeProject) {
          executionEngine.setProjectContext(activeProject.id, activeProject.dataPath);
        }

        // Get default author from project settings
        const metaEngine = bundle.metaEngine;
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
    void bundle.taskManager.runTask(task);
    
    // Return task ID so UI can track it
    return { taskId, totalItems };
  });

  // ============ Import Definition CRUD Handlers ============

  safeHandle('importDefinitions:create', async (_, name?: string) => {
    const { ImportDefinitionEngine } = await import('../engine/ImportDefinitionEngine');
    const engine = new ImportDefinitionEngine();
    const projectEngine = bundle.projectEngine;
    const activeProject = await projectEngine.getActiveProject();
    if (activeProject) {
      engine.setProjectContext(activeProject.id);
    }
    return engine.createDefinition(name || undefined);
  });

  safeHandle('importDefinitions:get', async (_, id: string) => {
    const { ImportDefinitionEngine } = await import('../engine/ImportDefinitionEngine');
    const engine = new ImportDefinitionEngine();
    const projectEngine = bundle.projectEngine;
    const activeProject = await projectEngine.getActiveProject();
    if (activeProject) {
      engine.setProjectContext(activeProject.id);
    }
    return engine.getDefinition(id);
  });

  safeHandle('importDefinitions:getAll', async () => {
    const { ImportDefinitionEngine } = await import('../engine/ImportDefinitionEngine');
    const engine = new ImportDefinitionEngine();
    const projectEngine = bundle.projectEngine;
    const activeProject = await projectEngine.getActiveProject();
    if (activeProject) {
      engine.setProjectContext(activeProject.id);
    }
    return engine.getAllForProject();
  });

  safeHandle('importDefinitions:update', async (event, id: string, updates: Record<string, unknown>) => {
    const { ImportDefinitionEngine } = await import('../engine/ImportDefinitionEngine');
    const engine = new ImportDefinitionEngine();
    const projectEngine = bundle.projectEngine;
    const activeProject = await projectEngine.getActiveProject();
    if (activeProject) {
      engine.setProjectContext(activeProject.id);
    }
    const result = await engine.updateDefinition(id, updates);
    // Notify renderer of name changes for sidebar/tab updates
    if (result && updates.name !== undefined && event && typeof event === 'object' && 'sender' in event) {
      (event as IpcMainInvokeEvent).sender.send('importDefinition-name-updated', { definitionId: id, name: result.name });
    }
    return result;
  });

  safeHandle('importDefinitions:delete', async (_, id: string) => {
    const { ImportDefinitionEngine } = await import('../engine/ImportDefinitionEngine');
    const engine = new ImportDefinitionEngine();
    const projectEngine = bundle.projectEngine;
    const activeProject = await projectEngine.getActiveProject();
    if (activeProject) {
      engine.setProjectContext(activeProject.id);
    }
    return engine.deleteDefinition(id);
  });

  registerMetadataDiffHandlers(safeHandle, bundle);
  registerBlogHandlers(safeHandle, bundle);
  registerPublishHandlers(safeHandle, bundle);
  registerEmbeddingHandlers(safeHandle, bundle);

  // ============ MCP Config Handlers ============

  safeHandle('mcp:getAgents', async () => {
    const { MCPAgentConfigEngine } = await import('../engine/MCPAgentConfigEngine');
    const engine = new MCPAgentConfigEngine(buildMcpAgentConfigOptions());
    return engine.getAgents();
  });

  safeHandle('mcp:addToAgentConfig', async (_event: unknown, agentId: string) => {
    const { MCPAgentConfigEngine } = await import('../engine/MCPAgentConfigEngine');
    const engine = new MCPAgentConfigEngine(buildMcpAgentConfigOptions());
    return engine.addToConfig(agentId as import('../engine/MCPAgentConfigEngine').MCPAgentId);
  });

  safeHandle('mcp:removeFromAgentConfig', async (_event: unknown, agentId: string) => {
    const { MCPAgentConfigEngine } = await import('../engine/MCPAgentConfigEngine');
    const engine = new MCPAgentConfigEngine(buildMcpAgentConfigOptions());
    return engine.removeFromConfig(agentId as import('../engine/MCPAgentConfigEngine').MCPAgentId);
  });

  safeHandle('mcp:isConfigured', async (_event: unknown, agentId: string) => {
    const { MCPAgentConfigEngine } = await import('../engine/MCPAgentConfigEngine');
    const engine = new MCPAgentConfigEngine(buildMcpAgentConfigOptions());
    return engine.isConfigured(agentId as import('../engine/MCPAgentConfigEngine').MCPAgentId);
  });

  safeHandle('mcp:getPort', async () => {
    try {
      return bundle.mcpServer.getPort();
    } catch {
      return null;
    }
  });
}

/**
 * Register event forwarding from engine EventEmitters to the renderer via IPC.
 * Must be called after the database is initialized (engines require DB access).
 * Separated from registerIpcHandlers() so that handler registration can happen
 * synchronously before any async work, eliminating startup race conditions.
 */
export function registerEventForwarding(bundle: EngineBundle): void {
  const postEngine = bundle.postEngine;
  const mediaEngine = bundle.mediaEngine;
  const projectEngine = bundle.projectEngine;
  const metaEngine = bundle.metaEngine;
  const tagEngine = bundle.tagEngine;
  const postMediaEngine = bundle.postMediaEngine;
  const embeddingEngine = bundle.embeddingEngine;

  // Wire PostEngine events → EmbeddingEngine (opt-in via semanticSimilarityEnabled)
  const ifSemanticEnabled = (fn: () => void): void => {
    metaEngine.getProjectMetadata().then((metadata) => {
      if (metadata?.semanticSimilarityEnabled === true) {
        fn();
      }
    }).catch(() => {});
  };

  postEngine.on('postCreated', (post: { id: string; title: string; content: string }) => {
    ifSemanticEnabled(() => {
      embeddingEngine.embedPost(post.id, post.title, post.content ?? '').catch(() => {});
    });
  });
  postEngine.on('postUpdated', (post: { id: string; title: string; content: string }) => {
    ifSemanticEnabled(() => {
      embeddingEngine.embedPost(post.id, post.title, post.content ?? '').catch(() => {});
    });
  });
  postEngine.on('postDeleted', (id: string) => {
    ifSemanticEnabled(() => {
      embeddingEngine.removePost(id).catch(() => {});
    });
  });
  postEngine.on('databaseRebuilt', () => {
    ifSemanticEnabled(() => {
      embeddingEngine.reindexAll().catch(() => {});
    });
  });

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
  projectEngine.on('activeProjectChanged', (project: { id: string } | null) => {
    if (project?.id) {
      embeddingEngine.setProjectContext(project.id).catch(() => {});
    }
  });

  postEngine.on('postCreated', forwardEvent('post:created'));
  postEngine.on('postUpdated', forwardEvent('post:updated'));
  postEngine.on('postDeleted', forwardEvent('post:deleted'));
  postEngine.on('postTranslationCreated', forwardEvent('post:translationCreated'));
  postEngine.on('postTranslationUpdated', forwardEvent('post:translationUpdated'));
  postEngine.on('rebuildStarted', forwardEvent('posts:rebuildStarted'));
  postEngine.on('databaseRebuilt', forwardEvent('posts:databaseRebuilt'));

  mediaEngine.on('mediaImported', forwardEvent('media:imported'));
  mediaEngine.on('mediaUpdated', forwardEvent('media:updated'));
  mediaEngine.on('mediaDeleted', forwardEvent('media:deleted'));
  mediaEngine.on('mediaFileReplaced', forwardEvent('media:fileReplaced'));
  mediaEngine.on('mediaTranslationCreated', forwardEvent('media:translationCreated'));
  mediaEngine.on('mediaTranslationUpdated', forwardEvent('media:translationUpdated'));
  mediaEngine.on('mediaTranslationDeleted', forwardEvent('media:translationDeleted'));
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

  bundle.taskManager.on('taskCreated', forwardEvent('task:created'));
  bundle.taskManager.on('taskStarted', forwardEvent('task:started'));
  bundle.taskManager.on('taskProgress', forwardEvent('task:progress'));
  bundle.taskManager.on('taskCompleted', forwardEvent('task:completed'));
  bundle.taskManager.on('taskFailed', forwardEvent('task:failed'));

  const scriptEngine = bundle.scriptEngine;
  scriptEngine.on('scriptCreated', forwardEvent('script:created'));
  scriptEngine.on('scriptUpdated', forwardEvent('script:updated'));
  scriptEngine.on('scriptDeleted', forwardEvent('script:deleted'));
  scriptEngine.on('scriptsRebuilt', forwardEvent('scripts:rebuilt'));

  const templateEngine = bundle.templateEngine;
  templateEngine.on('templateCreated', forwardEvent('template:created'));
  templateEngine.on('templateUpdated', forwardEvent('template:updated'));
  templateEngine.on('templateDeleted', forwardEvent('template:deleted'));
  templateEngine.on('templatesRebuilt', forwardEvent('templates:rebuilt'));
}
