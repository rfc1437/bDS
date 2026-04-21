import { contextBridge, ipcRenderer } from 'electron';
import type { ElectronAPI } from './shared/electronApi';
import type { GitInitProgress } from './shared/electronApi';
import type { SiteValidationReport } from './shared/electronApi';
import type { TranslationValidationReport } from './shared/electronApi';

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
export const electronAPI: ElectronAPI = {
  // Git
  git: {
    checkAvailability: () => ipcRenderer.invoke('git:checkAvailability'),
    getRepoState: (projectPath: string) => ipcRenderer.invoke('git:getRepoState', projectPath),
    getStatus: (projectPath: string) => ipcRenderer.invoke('git:status', projectPath),
    getDiff: (projectPath: string, filePath: string) => ipcRenderer.invoke('git:diff', projectPath, filePath),
    getDiffContent: (projectPath: string, filePath: string) => ipcRenderer.invoke('git:diffContent', projectPath, filePath),
    getCommitDiffContent: (projectPath: string, commitHash: string) => ipcRenderer.invoke('git:commitDiffContent', projectPath, commitHash),
    getHistory: (projectPath: string, limit?: number) => ipcRenderer.invoke('git:history', projectPath, limit),
    getFileHistory: (projectPath: string, filePath: string, limit?: number) => ipcRenderer.invoke('git:fileHistory', projectPath, filePath, limit),
    getRemoteState: (projectPath: string) => ipcRenderer.invoke('git:remoteState', projectPath),
    fetch: (projectPath: string) => ipcRenderer.invoke('git:fetch', projectPath),
    pull: (projectPath: string) => ipcRenderer.invoke('git:pull', projectPath),
    push: (projectPath: string) => ipcRenderer.invoke('git:push', projectPath),
    commitAll: (projectPath: string, message: string) => ipcRenderer.invoke('git:commitAll', projectPath, message),
    ensureGitignore: (projectPath: string) => ipcRenderer.invoke('git:ensureGitignore', projectPath),
    pruneLfs: (projectPath: string, options?: { dryRun?: boolean; verifyRemote?: boolean; recentCommitsToKeep?: number }) => ipcRenderer.invoke('git:pruneLfs', projectPath, options),
    init: (projectPath: string, remoteUrl?: string) => {
      if (remoteUrl) {
        return ipcRenderer.invoke('git:init', projectPath, remoteUrl);
      }
      return ipcRenderer.invoke('git:init', projectPath);
    },
    onInitProgress: (callback: (data: GitInitProgress) => void) => {
      const subscription = (_event: Electron.IpcRendererEvent, data: GitInitProgress) => callback(data);
      ipcRenderer.on('git:initProgress', subscription);
      return () => ipcRenderer.removeListener('git:initProgress', subscription);
    },
  },

  // Projects
  projects: {
    create: (data: { name: string; description?: string; slug?: string; dataPath?: string }) => ipcRenderer.invoke('projects:create', data),
    update: (id: string, data: unknown) => ipcRenderer.invoke('projects:update', id, data),
    delete: (id: string) => ipcRenderer.invoke('projects:delete', id),
    deleteWithData: (id: string) => ipcRenderer.invoke('projects:deleteWithData', id),
    get: (id: string) => ipcRenderer.invoke('projects:get', id),
    getAll: () => ipcRenderer.invoke('projects:getAll'),
    getActive: () => ipcRenderer.invoke('projects:getActive'),
    setActive: (id: string) => ipcRenderer.invoke('projects:setActive', id),
  },

  // Posts
  posts: {
    create: (data: unknown) => ipcRenderer.invoke('posts:create', data),
    update: (id: string, data: unknown) => ipcRenderer.invoke('posts:update', id, data),
    delete: (id: string) => ipcRenderer.invoke('posts:delete', id),
    get: (id: string) => ipcRenderer.invoke('posts:get', id),
    getBySlug: (slug: string) => ipcRenderer.invoke('posts:getBySlug', slug),
    getTranslation: (postId: string, language: string) => ipcRenderer.invoke('posts:getTranslation', postId, language),
    getTranslations: (postId: string) => ipcRenderer.invoke('posts:getTranslations', postId),
    upsertTranslation: (postId: string, language: string, data: unknown) => ipcRenderer.invoke('posts:upsertTranslation', postId, language, data),
    publishTranslation: (postId: string, language: string) => ipcRenderer.invoke('posts:publishTranslation', postId, language),
    getPreviewUrl: (id: string, options?: { draft?: boolean; lang?: string }) => ipcRenderer.invoke('posts:getPreviewUrl', id, options),
    getAll: (options?: { limit?: number; offset?: number }) => ipcRenderer.invoke('posts:getAll', options),
    getByStatus: (status: string) => ipcRenderer.invoke('posts:getByStatus', status),
    publish: (id: string) => ipcRenderer.invoke('posts:publish', id),
    discard: (id: string) => ipcRenderer.invoke('posts:discard', id),
    hasPublishedVersion: (id: string) => ipcRenderer.invoke('posts:hasPublishedVersion', id),
    rebuildFromFiles: () => ipcRenderer.invoke('posts:rebuildFromFiles'),
    reindexText: () => ipcRenderer.invoke('posts:reindexText'),
    search: (query: string) => ipcRenderer.invoke('posts:search', query),
    filter: (filter: unknown) => ipcRenderer.invoke('posts:filter', filter),
    getTags: () => ipcRenderer.invoke('posts:getTags'),
    getCategories: () => ipcRenderer.invoke('posts:getCategories'),
    getByYearMonth: () => ipcRenderer.invoke('posts:getByYearMonth'),
    getTagsWithCounts: () => ipcRenderer.invoke('posts:getTagsWithCounts'),
    getCategoriesWithCounts: () => ipcRenderer.invoke('posts:getCategoriesWithCounts'),
    getDashboardStats: () => ipcRenderer.invoke('posts:getDashboardStats'),
    getLinksTo: (id: string) => ipcRenderer.invoke('posts:getLinksTo', id),
    getLinkedBy: (id: string) => ipcRenderer.invoke('posts:getLinkedBy', id),
    rebuildLinks: () => ipcRenderer.invoke('posts:rebuildLinks'),
    isSlugAvailable: (slug: string, excludePostId?: string) => ipcRenderer.invoke('posts:isSlugAvailable', slug, excludePostId),
    generateUniqueSlug: (title: string, excludePostId?: string) => ipcRenderer.invoke('posts:generateUniqueSlug', title, excludePostId),
    requestAutoTranslation: (id: string) => ipcRenderer.invoke('posts:requestAutoTranslation', id),
  },

  // Media
  media: {
    import: (sourcePath: string, metadata?: unknown) => ipcRenderer.invoke('media:import', sourcePath, metadata),
    importDialog: () => ipcRenderer.invoke('media:importDialog'),
    update: (id: string, data: unknown) => ipcRenderer.invoke('media:update', id, data),
    replaceFile: (id: string, newSourcePath: string) => ipcRenderer.invoke('media:replaceFile', id, newSourcePath),
    replaceFileDialog: (id: string) => ipcRenderer.invoke('media:replaceFileDialog', id),
    delete: (id: string) => ipcRenderer.invoke('media:delete', id),
    get: (id: string) => ipcRenderer.invoke('media:get', id),
    getUrl: (id: string) => ipcRenderer.invoke('media:getUrl', id),
    getFilePath: (id: string) => ipcRenderer.invoke('media:getFilePath', id),
    getAll: () => ipcRenderer.invoke('media:getAll'),
    filter: (filter: unknown) => ipcRenderer.invoke('media:filter', filter),
    search: (query: string) => ipcRenderer.invoke('media:search', query),
    getByYearMonth: () => ipcRenderer.invoke('media:getByYearMonth'),
    getTags: () => ipcRenderer.invoke('media:getTags'),
    getTagsWithCounts: () => ipcRenderer.invoke('media:getTagsWithCounts'),
    rebuildFromFiles: () => ipcRenderer.invoke('media:rebuildFromFiles'),
    reindexText: () => ipcRenderer.invoke('media:reindexText'),
    getThumbnail: (id: string, size?: 'small' | 'medium' | 'large') => ipcRenderer.invoke('media:getThumbnail', id, size),
    regenerateThumbnails: (id: string) => ipcRenderer.invoke('media:regenerateThumbnails', id),
    regenerateMissingThumbnails: () => ipcRenderer.invoke('media:regenerateMissingThumbnails'),
    getTranslation: (mediaId: string, language: string) => ipcRenderer.invoke('media:getTranslation', mediaId, language),
    getTranslations: (mediaId: string) => ipcRenderer.invoke('media:getTranslations', mediaId),
    upsertTranslation: (mediaId: string, language: string, data: unknown) => ipcRenderer.invoke('media:upsertTranslation', mediaId, language, data),
    deleteTranslation: (mediaId: string, language: string) => ipcRenderer.invoke('media:deleteTranslation', mediaId, language),
  },

  // Scripts
  scripts: {
    create: (data: { title: string; kind: import('./shared/electronApi').ScriptKind; content: string; slug?: string; entrypoint?: string; enabled?: boolean }) => ipcRenderer.invoke('scripts:create', data),
    update: (id: string, data: { title?: string; kind?: import('./shared/electronApi').ScriptKind; content?: string; slug?: string; entrypoint?: string; enabled?: boolean }) => ipcRenderer.invoke('scripts:update', id, data),
    delete: (id: string) => ipcRenderer.invoke('scripts:delete', id),
    get: (id: string) => ipcRenderer.invoke('scripts:get', id),
    getAll: () => ipcRenderer.invoke('scripts:getAll'),
    getEnabledMacroSlugs: () => ipcRenderer.invoke('scripts:getEnabledMacroSlugs'),
    rebuildFromFiles: () => ipcRenderer.invoke('scripts:rebuildFromFiles'),
    startTask: (taskId: string, name: string) => ipcRenderer.invoke('scripts:startTask', taskId, name),
    completeTask: (taskId: string) => ipcRenderer.invoke('scripts:completeTask', taskId),
    failTask: (taskId: string, error: string) => ipcRenderer.invoke('scripts:failTask', taskId, error),
  },

  // Templates
  templates: {
    create: (data: { title: string; kind: import('./shared/electronApi').TemplateKind; content: string; slug?: string; enabled?: boolean }) => ipcRenderer.invoke('templates:create', data),
    update: (id: string, data: { title?: string; kind?: import('./shared/electronApi').TemplateKind; content?: string; slug?: string; enabled?: boolean }) => ipcRenderer.invoke('templates:update', id, data),
    delete: (id: string, options?: { force?: boolean }) => ipcRenderer.invoke('templates:delete', id, options),
    get: (id: string) => ipcRenderer.invoke('templates:get', id),
    getAll: () => ipcRenderer.invoke('templates:getAll'),
    getEnabledByKind: (kind: import('./shared/electronApi').TemplateKind) => ipcRenderer.invoke('templates:getEnabledByKind', kind),
    validate: (content: string) => ipcRenderer.invoke('templates:validate', content),
    rebuildFromFiles: () => ipcRenderer.invoke('templates:rebuildFromFiles'),
  },

  // Post-Media Links
  postMedia: {
    link: (postId: string, mediaId: string) => ipcRenderer.invoke('postMedia:link', postId, mediaId),
    unlink: (postId: string, mediaId: string) => ipcRenderer.invoke('postMedia:unlink', postId, mediaId),
    linkMany: (postId: string, mediaIds: string[]) => ipcRenderer.invoke('postMedia:linkMany', postId, mediaIds),
    unlinkMany: (postId: string, mediaIds: string[]) => ipcRenderer.invoke('postMedia:unlinkMany', postId, mediaIds),
    getForPost: (postId: string) => ipcRenderer.invoke('postMedia:getForPost', postId),
    getForMedia: (mediaId: string) => ipcRenderer.invoke('postMedia:getForMedia', mediaId),
    getMediaDataForPost: (postId: string) => ipcRenderer.invoke('postMedia:getMediaDataForPost', postId),
    reorder: (postId: string, mediaIds: string[]) => ipcRenderer.invoke('postMedia:reorder', postId, mediaIds),
    isLinked: (postId: string, mediaId: string) => ipcRenderer.invoke('postMedia:isLinked', postId, mediaId),
    import: (postId: string, filePath: string) => ipcRenderer.invoke('postMedia:import', postId, filePath),
    dropImport: (postId: string, filePath: string) => ipcRenderer.invoke('postMedia:dropImport', postId, filePath),
    dropImportBuffer: (postId: string, payload: { fileName: string; mimeType: string; bytes: Uint8Array }) => ipcRenderer.invoke('postMedia:dropImportBuffer', postId, payload),
    rebuild: () => ipcRenderer.invoke('postMedia:rebuild'),
  },

  // Sync (git operations via GitApiAdapter)
  sync: {
    checkAvailability: () => ipcRenderer.invoke('sync:checkAvailability'),
    getRepoState: () => ipcRenderer.invoke('sync:getRepoState'),
    getStatus: () => ipcRenderer.invoke('sync:getStatus'),
    getHistory: (limit?: number) => ipcRenderer.invoke('sync:getHistory', limit),
    getRemoteState: () => ipcRenderer.invoke('sync:getRemoteState'),
    fetch: () => ipcRenderer.invoke('sync:fetch'),
    pull: () => ipcRenderer.invoke('sync:pull'),
    push: () => ipcRenderer.invoke('sync:push'),
    commitAll: (message: string) => ipcRenderer.invoke('sync:commitAll', message),
  },

  // Tasks
  tasks: {
    getAll: () => ipcRenderer.invoke('tasks:getAll'),
    getRunning: () => ipcRenderer.invoke('tasks:getRunning'),
    cancel: (taskId: string) => ipcRenderer.invoke('tasks:cancel', taskId),
    clearCompleted: () => ipcRenderer.invoke('tasks:clearCompleted'),
  },

  // App
  app: {
    getDataPaths: () => ipcRenderer.invoke('app:getDataPaths'),
    getSystemLanguage: () => ipcRenderer.invoke('app:getSystemLanguage'),
    getTitleBarMetrics: () => ipcRenderer.invoke('app:getTitleBarMetrics'),
    openFolder: (folderPath: string) => ipcRenderer.invoke('app:openFolder', folderPath),
    showItemInFolder: (itemPath: string) => ipcRenderer.invoke('app:showItemInFolder', itemPath),
    selectFolder: (title?: string) => ipcRenderer.invoke('app:selectFolder', title),
    getDefaultProjectPath: (projectId: string) => ipcRenderer.invoke('app:getDefaultProjectPath', projectId),
    readProjectMetadata: (folderPath: string) => ipcRenderer.invoke('app:readProjectMetadata', folderPath),
    getBlogmarkBookmarklet: () => ipcRenderer.invoke('app:getBlogmarkBookmarklet'),
    copyToClipboard: (text: string) => ipcRenderer.invoke('app:copyToClipboard', text),
    notifyRendererReady: () => ipcRenderer.invoke('app:rendererReady'),
    setPreviewPostTarget: (postId: string | null) => ipcRenderer.invoke('app:setPreviewPostTarget', postId),
    triggerMenuAction: (action: string) => ipcRenderer.invoke('app:triggerMenuAction', action),
  },

  // Meta (tags, categories, and project metadata)
  meta: {
    getTags: () => ipcRenderer.invoke('meta:getTags'),
    getCategories: () => ipcRenderer.invoke('meta:getCategories'),
    addTag: (tag: string) => ipcRenderer.invoke('meta:addTag', tag),
    removeTag: (tag: string) => ipcRenderer.invoke('meta:removeTag', tag),
    addCategory: (category: string) => ipcRenderer.invoke('meta:addCategory', category),
    removeCategory: (category: string) => ipcRenderer.invoke('meta:removeCategory', category),
    syncOnStartup: () => ipcRenderer.invoke('meta:syncOnStartup'),
    getProjectMetadata: () => ipcRenderer.invoke('meta:getProjectMetadata'),
    setProjectMetadata: (metadata: { name: string; description?: string }) => ipcRenderer.invoke('meta:setProjectMetadata', metadata),
    updateProjectMetadata: (updates: { name?: string; description?: string; dataPath?: string; publicUrl?: string; mainLanguage?: string; defaultAuthor?: string; maxPostsPerPage?: number; blogmarkCategory?: string; pythonRuntimeMode?: 'webworker' | 'main-thread'; picoTheme?: import('./shared/picoThemes').PicoThemeName; categoryMetadata?: Record<string, { renderInLists: boolean; showTitle: boolean; title: string }>; categorySettings?: Record<string, { renderInLists: boolean; showTitle: boolean }>; semanticSimilarityEnabled?: boolean; blogLanguages?: string[] }) => ipcRenderer.invoke('meta:updateProjectMetadata', updates),
    getPublishingPreferences: () => ipcRenderer.invoke('meta:getPublishingPreferences'),
    setPublishingPreferences: (prefs: { sshHost: string; sshUser: string; sshRemotePath: string; sshMode: 'scp' | 'rsync' }) => ipcRenderer.invoke('meta:setPublishingPreferences', prefs),
    clearPublishingPreferences: () => ipcRenderer.invoke('meta:clearPublishingPreferences'),
  },

  // Tag Management (advanced tag operations)
  tags: {
    getAll: () => ipcRenderer.invoke('tags:getAll'),
    getWithCounts: () => ipcRenderer.invoke('tags:getWithCounts'),
    get: (id: string) => ipcRenderer.invoke('tags:get', id),
    getByName: (name: string) => ipcRenderer.invoke('tags:getByName', name),
    create: (data: { name: string; color?: string }) => ipcRenderer.invoke('tags:create', data),
    update: (id: string, data: { name?: string; color?: string | null; postTemplateSlug?: string | null }) => ipcRenderer.invoke('tags:update', id, data),
    delete: (id: string) => ipcRenderer.invoke('tags:delete', id),
    merge: (sourceTagIds: string[], targetTagId: string) => ipcRenderer.invoke('tags:merge', sourceTagIds, targetTagId),
    rename: (id: string, newName: string) => ipcRenderer.invoke('tags:rename', id, newName),
    getPostsWithTag: (tagId: string) => ipcRenderer.invoke('tags:getPostsWithTag', tagId),
    syncFromPosts: () => ipcRenderer.invoke('tags:syncFromPosts'),
  },

  // Import Analysis
  import: {
    selectAndAnalyze: (uploadsFolder?: string) => ipcRenderer.invoke('import:selectAndAnalyze', uploadsFolder),
    analyzeFile: (filePath: string, uploadsFolder?: string) => ipcRenderer.invoke('import:analyzeFile', filePath, uploadsFolder),
    selectUploadsFolder: () => ipcRenderer.invoke('import:selectUploadsFolder'),
    execute: (reportJson: string, uploadsFolder?: string) => ipcRenderer.invoke('import:execute', reportJson, uploadsFolder),
    onProgress: (callback: (data: { step: string; detail?: string }) => void) => {
      const subscription = (_event: Electron.IpcRendererEvent, data: { step: string; detail?: string }) => callback(data);
      ipcRenderer.on('import:progress', subscription);
      return () => ipcRenderer.removeListener('import:progress', subscription);
    },
    onExecutionProgress: (callback: (data: {
      taskId: string;
      phase: string;
      current: number;
      total: number;
      detail?: string;
      eta?: number;
    }) => void) => {
      const subscription = (_event: Electron.IpcRendererEvent, data: {
        taskId: string;
        phase: string;
        current: number;
        total: number;
        detail?: string;
        eta?: number;
      }) => callback(data);
      ipcRenderer.on('import:executionProgress', subscription);
      return () => ipcRenderer.removeListener('import:executionProgress', subscription);
    },
    onComplete: (callback: (data: {
      taskId: string;
      success: boolean;
      posts: { imported: number; skipped: number; errors: number };
      media: { imported: number; skipped: number; errors: number };
      pages: { imported: number; skipped: number; errors: number };
      tags: { created: number; skipped: number };
    }) => void) => {
      const subscription = (_event: Electron.IpcRendererEvent, data: {
        taskId: string;
        success: boolean;
        posts: { imported: number; skipped: number; errors: number };
        media: { imported: number; skipped: number; errors: number };
        pages: { imported: number; skipped: number; errors: number };
        tags: { created: number; skipped: number };
      }) => callback(data);
      ipcRenderer.on('import:complete', subscription);
      return () => ipcRenderer.removeListener('import:complete', subscription);
    },
  },

  // Import Definition CRUD
  importDefinitions: {
    create: (name?: string) => ipcRenderer.invoke('importDefinitions:create', name),
    get: (id: string) => ipcRenderer.invoke('importDefinitions:get', id),
    getAll: () => ipcRenderer.invoke('importDefinitions:getAll'),
    update: (id: string, updates: unknown) => ipcRenderer.invoke('importDefinitions:update', id, updates),
    delete: (id: string) => ipcRenderer.invoke('importDefinitions:delete', id),
    onNameUpdated: (callback: (data: { definitionId: string; name: string }) => void) => {
      const subscription = (_event: Electron.IpcRendererEvent, data: { definitionId: string; name: string }) => callback(data);
      ipcRenderer.on('importDefinition-name-updated', subscription);
      return () => ipcRenderer.removeListener('importDefinition-name-updated', subscription);
    },
  },

  // Metadata Diff Tool
  metadataDiff: {
    getStats: () => ipcRenderer.invoke('metadataDiff:getStats'),
    scan: () => ipcRenderer.invoke('metadataDiff:scan'),
    syncDbToFile: (postIds: string[], groupLabel: string) => ipcRenderer.invoke('metadataDiff:syncDbToFile', postIds, groupLabel),
    syncFileToDb: (postIds: string[], field: string, groupLabel: string) => ipcRenderer.invoke('metadataDiff:syncFileToDb', postIds, field, groupLabel),
    scanMedia: () => ipcRenderer.invoke('metadataDiff:scanMedia'),
    syncMediaDbToFile: (mediaIds: string[], groupLabel: string) => ipcRenderer.invoke('metadataDiff:syncMediaDbToFile', mediaIds, groupLabel),
    syncMediaFileToDb: (mediaIds: string[], field: string, groupLabel: string) => ipcRenderer.invoke('metadataDiff:syncMediaFileToDb', mediaIds, field, groupLabel),
    scanScripts: () => ipcRenderer.invoke('metadataDiff:scanScripts'),
    syncScriptDbToFile: (scriptIds: string[], groupLabel: string) => ipcRenderer.invoke('metadataDiff:syncScriptDbToFile', scriptIds, groupLabel),
    syncScriptFileToDb: (scriptIds: string[], field: string, groupLabel: string) => ipcRenderer.invoke('metadataDiff:syncScriptFileToDb', scriptIds, field, groupLabel),
    scanTemplates: () => ipcRenderer.invoke('metadataDiff:scanTemplates'),
    syncTemplateDbToFile: (templateIds: string[], groupLabel: string) => ipcRenderer.invoke('metadataDiff:syncTemplateDbToFile', templateIds, groupLabel),
    syncTemplateFileToDb: (templateIds: string[], field: string, groupLabel: string) => ipcRenderer.invoke('metadataDiff:syncTemplateFileToDb', templateIds, field, groupLabel),
    importOrphanFiles: (filePaths: string[]) => ipcRenderer.invoke('metadataDiff:importOrphanFiles', filePaths),
  },

  // Blog operations
  blog: {
    generateSitemap: () => ipcRenderer.invoke('blog:generateSitemap'),
    validateSite: () => ipcRenderer.invoke('blog:validateSite'),
    validateTranslations: () => ipcRenderer.invoke('blog:validateTranslations'),
    fixInvalidTranslations: (report: TranslationValidationReport) => ipcRenderer.invoke('blog:fixInvalidTranslations', report),
    fillMissingTranslations: () => ipcRenderer.invoke('blog:fillMissingTranslations'),
    applyValidation: (report: SiteValidationReport) => ipcRenderer.invoke('blog:applyValidation', report),
    regenerateCalendar: () => ipcRenderer.invoke('blog:regenerateCalendar'),
  },

  // Site publishing (SCP/rsync)
  publish: {
    uploadSite: (credentials: { sshHost: string; sshUser: string; sshRemotePath: string; sshMode: 'scp' | 'rsync' }) =>
      ipcRenderer.invoke('publish:uploadSite', credentials),
  },

  menu: {
    get: () => ipcRenderer.invoke('menu:get'),
    save: (menu: import('./shared/electronApi').MenuDocument) => ipcRenderer.invoke('menu:save', menu),
  },

  // AI Chat (OpenCode Zen API integration)
  chat: {
    // API Key Management
    checkReady: () => ipcRenderer.invoke('chat:checkReady'),
    validateApiKey: (apiKey: string) => ipcRenderer.invoke('chat:validateApiKey', apiKey),
    setApiKey: (apiKey: string) => ipcRenderer.invoke('chat:setApiKey', apiKey),
    getApiKey: () => ipcRenderer.invoke('chat:getApiKey'),

    // Mistral API Key Management
    validateMistralApiKey: (apiKey: string) => ipcRenderer.invoke('chat:validateMistralApiKey', apiKey),
    setMistralApiKey: (apiKey: string) => ipcRenderer.invoke('chat:setMistralApiKey', apiKey),
    getMistralApiKey: () => ipcRenderer.invoke('chat:getMistralApiKey'),

    // Ollama (Local)
    getOllamaEnabled: () => ipcRenderer.invoke('chat:getOllamaEnabled'),
    setOllamaEnabled: (enabled: boolean) => ipcRenderer.invoke('chat:setOllamaEnabled', enabled),
    getOllamaModels: () => ipcRenderer.invoke('chat:getOllamaModels'),
    getOllamaModelCapabilities: () => ipcRenderer.invoke('chat:getOllamaModelCapabilities'),
    setOllamaModelCapabilities: (modelId: string, caps: { tools: boolean; vision: boolean }) => ipcRenderer.invoke('chat:setOllamaModelCapabilities', modelId, caps),

    // LM Studio (Local)
    getLmstudioEnabled: () => ipcRenderer.invoke('chat:getLmstudioEnabled'),
    setLmstudioEnabled: (enabled: boolean) => ipcRenderer.invoke('chat:setLmstudioEnabled', enabled),
    getLmstudioModels: () => ipcRenderer.invoke('chat:getLmstudioModels'),
    getLmstudioModelCapabilities: () => ipcRenderer.invoke('chat:getLmstudioModelCapabilities'),
    setLmstudioModelCapabilities: (modelId: string, caps: { tools: boolean; vision: boolean }) => ipcRenderer.invoke('chat:setLmstudioModelCapabilities', modelId, caps),

    // Generic OpenAI-compatible Endpoint
    getGenericOpenAIEnabled: () => ipcRenderer.invoke('chat:getGenericOpenAIEnabled'),
    setGenericOpenAIEnabled: (enabled: boolean) => ipcRenderer.invoke('chat:setGenericOpenAIEnabled', enabled),
    getGenericOpenAIBaseURL: () => ipcRenderer.invoke('chat:getGenericOpenAIBaseURL'),
    setGenericOpenAIBaseURL: (baseURL: string) => ipcRenderer.invoke('chat:setGenericOpenAIBaseURL', baseURL),
    getGenericOpenAIApiKey: () => ipcRenderer.invoke('chat:getGenericOpenAIApiKey'),
    setGenericOpenAIApiKey: (apiKey: string) => ipcRenderer.invoke('chat:setGenericOpenAIApiKey', apiKey),
    validateGenericOpenAIConfig: () => ipcRenderer.invoke('chat:validateGenericOpenAIConfig'),
    getGenericOpenAIModels: () => ipcRenderer.invoke('chat:getGenericOpenAIModels'),
    getGenericOpenAIModelCapabilities: () => ipcRenderer.invoke('chat:getGenericOpenAIModelCapabilities'),
    setGenericOpenAIModelCapabilities: (modelId: string, caps: { tools: boolean; vision: boolean }) => ipcRenderer.invoke('chat:setGenericOpenAIModelCapabilities', modelId, caps),

    // Offline / Airplane Mode
    getOfflineMode: () => ipcRenderer.invoke('chat:getOfflineMode'),
    setOfflineMode: (enabled: boolean) => ipcRenderer.invoke('chat:setOfflineMode', enabled),
    getOfflineChatModel: () => ipcRenderer.invoke('chat:getOfflineChatModel'),
    setOfflineChatModel: (modelId: string | null) => ipcRenderer.invoke('chat:setOfflineChatModel', modelId),
    getOfflineTitleModel: () => ipcRenderer.invoke('chat:getOfflineTitleModel'),
    setOfflineTitleModel: (modelId: string | null) => ipcRenderer.invoke('chat:setOfflineTitleModel', modelId),
    getOfflineImageAnalysisModel: () => ipcRenderer.invoke('chat:getOfflineImageAnalysisModel'),
    setOfflineImageAnalysisModel: (modelId: string | null) => ipcRenderer.invoke('chat:setOfflineImageAnalysisModel', modelId),
    getKnownLocalModels: () => ipcRenderer.invoke('chat:getKnownLocalModels'),

    // Per-Purpose Model Preferences
    getTitleModel: () => ipcRenderer.invoke('chat:getTitleModel'),
    setTitleModel: (modelId: string | null) => ipcRenderer.invoke('chat:setTitleModel', modelId),
    getImageAnalysisModel: () => ipcRenderer.invoke('chat:getImageAnalysisModel'),
    setImageAnalysisModel: (modelId: string | null) => ipcRenderer.invoke('chat:setImageAnalysisModel', modelId),

    // Settings
    getAvailableModels: () => ipcRenderer.invoke('chat:getAvailableModels'),
    setDefaultModel: (modelId: string) => ipcRenderer.invoke('chat:setDefaultModel', modelId),
    getSystemPrompt: () => ipcRenderer.invoke('chat:getSystemPrompt'),
    setSystemPrompt: (prompt: string) => ipcRenderer.invoke('chat:setSystemPrompt', prompt),

    // Model Catalog
    refreshModelCatalog: () => ipcRenderer.invoke('chat:refreshModelCatalog'),
    getModelCatalog: () => ipcRenderer.invoke('chat:getModelCatalog'),

    // Conversations
    getConversations: () => ipcRenderer.invoke('chat:getConversations'),
    createConversation: (title?: string, model?: string) => ipcRenderer.invoke('chat:createConversation', title, model),
    getConversation: (id: string) => ipcRenderer.invoke('chat:getConversation', id),
    updateConversation: (id: string, updates: { title?: string; model?: string }) => ipcRenderer.invoke('chat:updateConversation', id, updates),
    deleteConversation: (id: string) => ipcRenderer.invoke('chat:deleteConversation', id),

    // Messaging
    sendMessage: (conversationId: string, message: string, metadata?: { surface?: 'tab' | 'sidebar' }) => ipcRenderer.invoke('chat:sendMessage', conversationId, message, metadata),
    addSystemEvent: (conversationId: string, content: string) => ipcRenderer.invoke('chat:addSystemEvent', conversationId, content),
    abortMessage: (conversationId: string) => ipcRenderer.invoke('chat:abortMessage', conversationId),
    getHistory: (conversationId: string) => ipcRenderer.invoke('chat:getHistory', conversationId),
    clearMessages: (conversationId: string) => ipcRenderer.invoke('chat:clearMessages', conversationId),
    setConversationModel: (conversationId: string, modelId: string) => ipcRenderer.invoke('chat:setConversationModel', conversationId, modelId),

    // Taxonomy Analysis
    analyzeTaxonomy: (categories: Array<{ name: string; slug: string; existsInProject: boolean }>, tags: Array<{ name: string; slug: string; existsInProject: boolean }>, modelId: string) => ipcRenderer.invoke('chat:analyzeTaxonomy', categories, tags, modelId),

    // Media Analysis
    analyzeMediaImage: (mediaId: string, language?: string) => ipcRenderer.invoke('chat:analyzeMediaImage', mediaId, language),

    // Post Language Detection
    detectPostLanguage: (title: string, content: string) => ipcRenderer.invoke('chat:detectPostLanguage', title, content),

    // Post Analysis (title, excerpt, slug suggestions)
    analyzePost: (postId: string, language?: string) => ipcRenderer.invoke('chat:analyzePost', postId, language),

    // Post Translation
    translatePost: (postId: string, targetLanguage: string) => ipcRenderer.invoke('chat:translatePost', postId, targetLanguage),

    // Media Language Detection
    detectMediaLanguage: (title: string, alt: string, caption: string) => ipcRenderer.invoke('chat:detectMediaLanguage', title, alt, caption),

    // Media Metadata Translation
    translateMediaMetadata: (mediaId: string, targetLanguage: string) => ipcRenderer.invoke('chat:translateMediaMetadata', mediaId, targetLanguage),

    // Event listeners for streaming/progress
    onStreamDelta: (callback: (data: { conversationId: string; delta: string }) => void) => {
      const subscription = (_event: Electron.IpcRendererEvent, data: { conversationId: string; delta: string }) => callback(data);
      ipcRenderer.on('chat-stream-delta', subscription);
      return () => ipcRenderer.removeListener('chat-stream-delta', subscription);
    },
    onToolCall: (callback: (data: { conversationId: string; toolCall: { name: string; arguments: Record<string, unknown> } }) => void) => {
      const subscription = (_event: Electron.IpcRendererEvent, data: { conversationId: string; toolCall: { name: string; arguments: Record<string, unknown> } }) => callback(data);
      ipcRenderer.on('chat-tool-call', subscription);
      return () => ipcRenderer.removeListener('chat-tool-call', subscription);
    },
    onToolResult: (callback: (data: { conversationId: string; result: unknown }) => void) => {
      const subscription = (_event: Electron.IpcRendererEvent, data: { conversationId: string; result: unknown }) => callback(data);
      ipcRenderer.on('chat-tool-result', subscription);
      return () => ipcRenderer.removeListener('chat-tool-result', subscription);
    },
    onTitleUpdated: (callback: (data: { conversationId: string; title: string }) => void) => {
      const subscription = (_event: Electron.IpcRendererEvent, data: { conversationId: string; title: string }) => callback(data);
      ipcRenderer.on('chat-title-updated', subscription);
      return () => ipcRenderer.removeListener('chat-title-updated', subscription);
    },
    onTokenUsage: (callback: (data: import('./shared/electronApi').ChatTokenUsage) => void) => {
      const subscription = (_event: Electron.IpcRendererEvent, data: import('./shared/electronApi').ChatTokenUsage) => callback(data);
      ipcRenderer.on('chat-token-usage', subscription);
      return () => ipcRenderer.removeListener('chat-token-usage', subscription);
    },

    // A2UI streaming
    onA2UIMessage: (callback: (data: { conversationId: string; message: import('./a2ui/types').A2UIServerMessage }) => void) => {
      const subscription = (_event: Electron.IpcRendererEvent, data: { conversationId: string; message: import('./a2ui/types').A2UIServerMessage }) => callback(data);
      ipcRenderer.on('a2ui-message', subscription);
      return () => ipcRenderer.removeListener('a2ui-message', subscription);
    },
    dispatchA2UIAction: (action: import('./a2ui/types').A2UIClientAction) => ipcRenderer.invoke('a2ui:dispatch', action),
  },

  // Event listeners
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args);
    ipcRenderer.on(channel, subscription);
    return () => ipcRenderer.removeListener(channel, subscription);
  },

  once: (channel: string, callback: (...args: unknown[]) => void) => {
    ipcRenderer.once(channel, (_event, ...args) => callback(...args));
  },

  onEntityChanged: (callback: (payload: import('./shared/electronApi').EntityChangedPayload) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, payload: import('./shared/electronApi').EntityChangedPayload) => callback(payload);
    ipcRenderer.on('entity:changed', subscription);
    return () => ipcRenderer.removeListener('entity:changed', subscription);
  },

  mcp: {
    getAgents: () => ipcRenderer.invoke('mcp:getAgents'),
    addToAgentConfig: (agentId: string) => ipcRenderer.invoke('mcp:addToAgentConfig', agentId),
    removeFromAgentConfig: (agentId: string) => ipcRenderer.invoke('mcp:removeFromAgentConfig', agentId),
    isConfigured: (agentId: string) => ipcRenderer.invoke('mcp:isConfigured', agentId),
    getPort: () => ipcRenderer.invoke('mcp:getPort'),
  },

  // Semantic similarity / embeddings
  embeddings: {
    findSimilar: (postId: string, k?: number) => ipcRenderer.invoke('embeddings:findSimilar', postId, k),
    computeSimilarities: (sourcePostId: string, targetPostIds: string[]) => ipcRenderer.invoke('embeddings:computeSimilarities', sourcePostId, targetPostIds),
    getProgress: () => ipcRenderer.invoke('embeddings:getProgress'),
    suggestTags: (postId: string, excludeTags: string[]) => ipcRenderer.invoke('embeddings:suggestTags', postId, excludeTags),
    findDuplicates: (threshold?: number) => ipcRenderer.invoke('embeddings:findDuplicates', threshold),
    runDuplicateSearch: (threshold?: number) => ipcRenderer.invoke('embeddings:runDuplicateSearch', threshold),
    dismissPair: (postIdA: string, postIdB: string) => ipcRenderer.invoke('embeddings:dismissPair', postIdA, postIdB),
    dismissPairs: (pairIds: Array<[string, string]>) => ipcRenderer.invoke('embeddings:dismissPairs', pairIds),
    indexUnindexedPosts: () => ipcRenderer.invoke('embeddings:indexUnindexedPosts'),
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
