import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Projects
  projects: {
    create: (data: { name: string; description?: string; slug?: string }) => ipcRenderer.invoke('projects:create', data),
    update: (id: string, data: unknown) => ipcRenderer.invoke('projects:update', id, data),
    delete: (id: string) => ipcRenderer.invoke('projects:delete', id),
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
    unpublish: (id: string) => ipcRenderer.invoke('posts:unpublish', id),
    discard: (id: string) => ipcRenderer.invoke('posts:discard', id),
    hasPublishedVersion: (id: string) => ipcRenderer.invoke('posts:hasPublishedVersion', id),
    rebuildFromFiles: () => ipcRenderer.invoke('posts:rebuildFromFiles'),
    search: (query: string) => ipcRenderer.invoke('posts:search', query),
    filter: (filter: unknown) => ipcRenderer.invoke('posts:filter', filter),
    getTags: () => ipcRenderer.invoke('posts:getTags'),
    getCategories: () => ipcRenderer.invoke('posts:getCategories'),
    getByYearMonth: () => ipcRenderer.invoke('posts:getByYearMonth'),
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
  };
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
  once: (channel: string, callback: (...args: unknown[]) => void) => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
