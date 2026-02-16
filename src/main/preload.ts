import { contextBridge, ipcRenderer } from 'electron';
import type { ElectronAPI } from './shared/electronApi';
import type { GitInitProgress } from './shared/electronApi';

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
    getHistory: (projectPath: string, limit?: number) => ipcRenderer.invoke('git:history', projectPath, limit),
    fetch: (projectPath: string) => ipcRenderer.invoke('git:fetch', projectPath),
    pull: (projectPath: string) => ipcRenderer.invoke('git:pull', projectPath),
    push: (projectPath: string) => ipcRenderer.invoke('git:push', projectPath),
    commitAll: (projectPath: string, message: string) => ipcRenderer.invoke('git:commitAll', projectPath, message),
    ensureGitignore: (projectPath: string) => ipcRenderer.invoke('git:ensureGitignore', projectPath),
    pruneLfs: (projectPath: string, options?: { dryRun?: boolean; verifyRemote?: boolean }) => ipcRenderer.invoke('git:pruneLfs', projectPath, options),
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
    rebuild: () => ipcRenderer.invoke('postMedia:rebuild'),
  },

  // Sync
  sync: {
    configure: (config: unknown) => ipcRenderer.invoke('sync:configure', config),
    start: (direction?: 'push' | 'pull' | 'bidirectional') => ipcRenderer.invoke('sync:start', direction),
    getStatus: () => ipcRenderer.invoke('sync:getStatus'),
    isConfigured: () => ipcRenderer.invoke('sync:isConfigured'),
    getPendingCount: () => ipcRenderer.invoke('sync:getPendingCount'),
    getLog: (limit?: number) => ipcRenderer.invoke('sync:getLog', limit),
    stopAutoSync: () => ipcRenderer.invoke('sync:stopAutoSync'),
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
    openFolder: (folderPath: string) => ipcRenderer.invoke('app:openFolder', folderPath),
    showItemInFolder: (itemPath: string) => ipcRenderer.invoke('app:showItemInFolder', itemPath),
    selectFolder: (title?: string) => ipcRenderer.invoke('app:selectFolder', title),
    getDefaultProjectPath: (projectId: string) => ipcRenderer.invoke('app:getDefaultProjectPath', projectId),
    readProjectMetadata: (folderPath: string) => ipcRenderer.invoke('app:readProjectMetadata', folderPath),
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
    updateProjectMetadata: (updates: { name?: string; description?: string; dataPath?: string; mainLanguage?: string }) => ipcRenderer.invoke('meta:updateProjectMetadata', updates),
  },

  // Tag Management (advanced tag operations)
  tags: {
    getAll: () => ipcRenderer.invoke('tags:getAll'),
    getWithCounts: () => ipcRenderer.invoke('tags:getWithCounts'),
    get: (id: string) => ipcRenderer.invoke('tags:get', id),
    getByName: (name: string) => ipcRenderer.invoke('tags:getByName', name),
    create: (data: { name: string; color?: string }) => ipcRenderer.invoke('tags:create', data),
    update: (id: string, data: { name?: string; color?: string | null }) => ipcRenderer.invoke('tags:update', id, data),
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
  },

  // AI Chat (OpenCode Zen API integration)
  chat: {
    // API Key Management
    checkReady: () => ipcRenderer.invoke('chat:checkReady'),
    validateApiKey: (apiKey: string) => ipcRenderer.invoke('chat:validateApiKey', apiKey),
    setApiKey: (apiKey: string) => ipcRenderer.invoke('chat:setApiKey', apiKey),
    getApiKey: () => ipcRenderer.invoke('chat:getApiKey'),

    // Settings
    getAvailableModels: () => ipcRenderer.invoke('chat:getAvailableModels'),
    setDefaultModel: (modelId: string) => ipcRenderer.invoke('chat:setDefaultModel', modelId),
    getSystemPrompt: () => ipcRenderer.invoke('chat:getSystemPrompt'),
    setSystemPrompt: (prompt: string) => ipcRenderer.invoke('chat:setSystemPrompt', prompt),

    // Conversations
    getConversations: () => ipcRenderer.invoke('chat:getConversations'),
    createConversation: (title?: string, model?: string) => ipcRenderer.invoke('chat:createConversation', title, model),
    getConversation: (id: string) => ipcRenderer.invoke('chat:getConversation', id),
    updateConversation: (id: string, updates: { title?: string; model?: string }) => ipcRenderer.invoke('chat:updateConversation', id, updates),
    deleteConversation: (id: string) => ipcRenderer.invoke('chat:deleteConversation', id),

    // Messaging
    sendMessage: (conversationId: string, message: string) => ipcRenderer.invoke('chat:sendMessage', conversationId, message),
    abortMessage: (conversationId: string) => ipcRenderer.invoke('chat:abortMessage', conversationId),
    getHistory: (conversationId: string) => ipcRenderer.invoke('chat:getHistory', conversationId),
    clearMessages: (conversationId: string) => ipcRenderer.invoke('chat:clearMessages', conversationId),
    setConversationModel: (conversationId: string, modelId: string) => ipcRenderer.invoke('chat:setConversationModel', conversationId, modelId),

    // Taxonomy Analysis
    analyzeTaxonomy: (categories: Array<{ name: string; slug: string; existsInProject: boolean }>, tags: Array<{ name: string; slug: string; existsInProject: boolean }>, modelId: string) => ipcRenderer.invoke('chat:analyzeTaxonomy', categories, tags, modelId),

    // Media Analysis
    analyzeMediaImage: (mediaId: string, language?: string) => ipcRenderer.invoke('chat:analyzeMediaImage', mediaId, language),

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
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
