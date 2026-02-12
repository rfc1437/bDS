import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Projects
  projects: {
    create: (data: { name: string; description?: string; slug?: string }) => ipcRenderer.invoke('projects:create', data),
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
    delete: (id: string) => ipcRenderer.invoke('media:delete', id),
    get: (id: string) => ipcRenderer.invoke('media:get', id),
    getUrl: (id: string) => ipcRenderer.invoke('media:getUrl', id),
    getFilePath: (id: string) => ipcRenderer.invoke('media:getFilePath', id),
    getAll: () => ipcRenderer.invoke('media:getAll'),
    rebuildFromFiles: () => ipcRenderer.invoke('media:rebuildFromFiles'),
    getThumbnail: (id: string, size?: 'small' | 'medium' | 'large') => ipcRenderer.invoke('media:getThumbnail', id, size),
    regenerateThumbnails: (id: string) => ipcRenderer.invoke('media:regenerateThumbnails', id),
    regenerateMissingThumbnails: () => ipcRenderer.invoke('media:regenerateMissingThumbnails'),
  },

  // Sync
  sync: {
    configure: (config: unknown) => ipcRenderer.invoke('sync:configure', config),
    start: (direction?: string) => ipcRenderer.invoke('sync:start', direction),
    getStatus: () => ipcRenderer.invoke('sync:getStatus'),
    isConfigured: () => ipcRenderer.invoke('sync:isConfigured'),
    getPendingCount: () => ipcRenderer.invoke('sync:getPendingCount'),
    getLog: (limit?: number) => ipcRenderer.invoke('sync:getLog', limit),
    stopAutoSync: () => ipcRenderer.invoke('sync:stopAutoSync'),
  },

  // Dropbox File Sync
  dropbox: {
    configure: (config: unknown) => ipcRenderer.invoke('dropbox:configure', config),
    isConfigured: () => ipcRenderer.invoke('dropbox:isConfigured'),
    getStatus: () => ipcRenderer.invoke('dropbox:getStatus'),
    syncAll: () => ipcRenderer.invoke('dropbox:syncAll'),
    startWatching: () => ipcRenderer.invoke('dropbox:startWatching'),
    stopWatching: () => ipcRenderer.invoke('dropbox:stopWatching'),
    startPolling: () => ipcRenderer.invoke('dropbox:startPolling'),
    stopPolling: () => ipcRenderer.invoke('dropbox:stopPolling'),
    getConflicts: () => ipcRenderer.invoke('dropbox:getConflicts'),
    resolveConflict: (conflictId: string, resolution: string) =>
      ipcRenderer.invoke('dropbox:resolveConflict', conflictId, resolution),
    getLastSyncTime: () => ipcRenderer.invoke('dropbox:getLastSyncTime'),
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
    updateProjectMetadata: (updates: { name?: string; description?: string; dataPath?: string }) => ipcRenderer.invoke('meta:updateProjectMetadata', updates),
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

    // Event listeners for streaming/progress
    onStreamDelta: (callback: (data: { conversationId: string; delta: string }) => void) => {
      const subscription = (_event: Electron.IpcRendererEvent, data: { conversationId: string; delta: string }) => callback(data);
      ipcRenderer.on('chat-stream-delta', subscription);
      return () => ipcRenderer.removeListener('chat-stream-delta', subscription);
    },
    onToolCall: (callback: (data: { conversationId: string; toolCall: unknown }) => void) => {
      const subscription = (_event: Electron.IpcRendererEvent, data: { conversationId: string; toolCall: unknown }) => callback(data);
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
});

// Type definitions for the exposed API
export interface ElectronAPI {
  projects: {
    create: (data: { name: string; description?: string; slug?: string }) => Promise<unknown>;
    update: (id: string, data: unknown) => Promise<unknown>;
    delete: (id: string) => Promise<boolean>;
    get: (id: string) => Promise<unknown>;
    getAll: () => Promise<unknown[]>;
    getActive: () => Promise<unknown>;
    setActive: (id: string) => Promise<unknown>;
  };
  posts: {
    create: (data: unknown) => Promise<unknown>;
    update: (id: string, data: unknown) => Promise<unknown>;
    delete: (id: string) => Promise<boolean>;
    get: (id: string) => Promise<unknown>;
    getAll: () => Promise<unknown[]>;
    getByStatus: (status: string) => Promise<unknown[]>;
    publish: (id: string) => Promise<unknown>;
    unpublish: (id: string) => Promise<unknown>;
    rebuildFromFiles: () => Promise<void>;
    search: (query: string) => Promise<unknown[]>;
    filter: (filter: unknown) => Promise<unknown[]>;
    getTags: () => Promise<string[]>;
    getCategories: () => Promise<string[]>;
    getByYearMonth: () => Promise<{ year: number; month: number; count: number }[]>;
    getTagsWithCounts: () => Promise<{ tag: string; count: number }[]>;
    getCategoriesWithCounts: () => Promise<{ category: string; count: number }[]>;
    getDashboardStats: () => Promise<{ totalPosts: number; draftCount: number; publishedCount: number; archivedCount: number }>;
    getLinksTo: (id: string) => Promise<{ id: string; title: string; slug: string }[]>;
    getLinkedBy: (id: string) => Promise<{ id: string; title: string; slug: string }[]>;
    rebuildLinks: () => Promise<void>;
  };
  media: {
    import: (sourcePath: string, metadata?: unknown) => Promise<unknown>;
    importDialog: () => Promise<unknown[]>;
    update: (id: string, data: unknown) => Promise<unknown>;
    delete: (id: string) => Promise<boolean>;
    get: (id: string) => Promise<unknown>;
    getAll: () => Promise<unknown[]>;
    rebuildFromFiles: () => Promise<void>;
  };
  sync: {
    configure: (config: unknown) => Promise<void>;
    start: (direction?: string) => Promise<unknown>;
    getStatus: () => Promise<string>;
    isConfigured: () => Promise<boolean>;
    getPendingCount: () => Promise<{ posts: number; media: number }>;
    getLog: (limit?: number) => Promise<unknown[]>;
    stopAutoSync: () => Promise<void>;
  };
  dropbox: {
    configure: (config: unknown) => Promise<void>;
    isConfigured: () => Promise<boolean>;
    getStatus: () => Promise<string>;
    syncAll: () => Promise<unknown>;
    startWatching: () => Promise<void>;
    stopWatching: () => Promise<void>;
    startPolling: () => Promise<void>;
    stopPolling: () => Promise<void>;
    getConflicts: () => Promise<unknown[]>;
    resolveConflict: (conflictId: string, resolution: string) => Promise<void>;
    getLastSyncTime: () => Promise<string | null>;
  };
  tasks: {
    getAll: () => Promise<unknown[]>;
    getRunning: () => Promise<unknown[]>;
    cancel: (taskId: string) => Promise<boolean>;
    clearCompleted: () => Promise<void>;
  };
  app: {
    getDataPaths: () => Promise<{ database: string; posts: string; media: string }>;
    openFolder: (folderPath: string) => Promise<string>;
    showItemInFolder: (itemPath: string) => Promise<void>;
    selectFolder: (title?: string) => Promise<string | null>;
    getDefaultProjectPath: (projectId: string) => Promise<string>;
  };
  meta: {
    getTags: () => Promise<string[]>;
    getCategories: () => Promise<string[]>;
    addTag: (tag: string) => Promise<string[]>;
    removeTag: (tag: string) => Promise<string[]>;
    addCategory: (category: string) => Promise<string[]>;
    removeCategory: (category: string) => Promise<string[]>;
    syncOnStartup: () => Promise<{ tags: string[]; categories: string[] }>;
  };
  tags: {
    getAll: () => Promise<unknown[]>;
    getWithCounts: () => Promise<unknown[]>;
    get: (id: string) => Promise<unknown>;
    getByName: (name: string) => Promise<unknown>;
    create: (data: { name: string; color?: string }) => Promise<unknown>;
    update: (id: string, data: { name?: string; color?: string | null }) => Promise<unknown>;
    delete: (id: string) => Promise<boolean>;
    merge: (sourceTagIds: string[], targetTagId: string) => Promise<void>;
    rename: (id: string, newName: string) => Promise<unknown>;
    getPostsWithTag: (tagId: string) => Promise<unknown[]>;
    syncFromPosts: () => Promise<void>;
  };
  chat: {
    // API Key Management
    checkReady: () => Promise<{ ready: boolean; error?: string; backend?: string }>;
    validateApiKey: (apiKey: string) => Promise<{ isValid: boolean; models: Array<{ id: string; name: string }> }>;
    setApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
    getApiKey: () => Promise<{ hasKey: boolean; maskedKey: string }>;

    // Settings
    getAvailableModels: () => Promise<{ success: boolean; models?: Array<{ id: string; name: string }>; selectedModel?: string; error?: string }>;
    setDefaultModel: (modelId: string) => Promise<{ success: boolean; error?: string }>;
    getSystemPrompt: () => Promise<{ success: boolean; prompt?: string; error?: string }>;
    setSystemPrompt: (prompt: string) => Promise<{ success: boolean; error?: string }>;

    // Conversations
    getConversations: () => Promise<unknown[]>;
    createConversation: (title?: string, model?: string) => Promise<unknown>;
    getConversation: (id: string) => Promise<unknown>;
    updateConversation: (id: string, updates: { title?: string; model?: string }) => Promise<unknown>;
    deleteConversation: (id: string) => Promise<boolean>;

    // Messaging
    sendMessage: (conversationId: string, message: string) => Promise<string>;
    abortMessage: (conversationId: string) => Promise<void>;
    getHistory: (conversationId: string) => Promise<unknown[]>;
    clearMessages: (conversationId: string) => Promise<void>;
    setConversationModel: (conversationId: string, modelId: string) => Promise<void>;

    // Event listeners
    onStreamDelta: (callback: (data: { conversationId: string; delta: string }) => void) => () => void;
    onToolCall: (callback: (data: { conversationId: string; toolCall: unknown }) => void) => () => void;
    onToolResult: (callback: (data: { conversationId: string; result: unknown }) => void) => () => void;
    onTitleUpdated: (callback: (data: { conversationId: string; title: string }) => void) => () => void;
  };
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
  once: (channel: string, callback: (...args: unknown[]) => void) => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
