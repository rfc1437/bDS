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
    getAll: () => ipcRenderer.invoke('posts:getAll'),
    getByStatus: (status: string) => ipcRenderer.invoke('posts:getByStatus', status),
    publish: (id: string) => ipcRenderer.invoke('posts:publish', id),
    unpublish: (id: string) => ipcRenderer.invoke('posts:unpublish', id),
    rebuildFromFiles: () => ipcRenderer.invoke('posts:rebuildFromFiles'),
    search: (query: string) => ipcRenderer.invoke('posts:search', query),
    filter: (filter: unknown) => ipcRenderer.invoke('posts:filter', filter),
    getTags: () => ipcRenderer.invoke('posts:getTags'),
    getCategories: () => ipcRenderer.invoke('posts:getCategories'),
    getByYearMonth: () => ipcRenderer.invoke('posts:getByYearMonth'),
  },

  // Media
  media: {
    import: (sourcePath: string, metadata?: unknown) => ipcRenderer.invoke('media:import', sourcePath, metadata),
    importDialog: () => ipcRenderer.invoke('media:importDialog'),
    update: (id: string, data: unknown) => ipcRenderer.invoke('media:update', id, data),
    delete: (id: string) => ipcRenderer.invoke('media:delete', id),
    get: (id: string) => ipcRenderer.invoke('media:get', id),
    getAll: () => ipcRenderer.invoke('media:getAll'),
    rebuildFromFiles: () => ipcRenderer.invoke('media:rebuildFromFiles'),
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
