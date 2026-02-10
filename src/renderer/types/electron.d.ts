// Type definitions for the Electron API exposed via preload

export interface PostData {
  id: string;
  title: string;
  slug: string;
  excerpt?: string;
  content: string;
  status: 'draft' | 'published' | 'archived';
  author?: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  tags: string[];
  categories: string[];
}

export interface MediaData {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  alt?: string;
  caption?: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
}

export interface TaskProgress {
  taskId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  message: string;
  startTime: string;
  endTime?: string;
  error?: string;
}

export interface SyncConfig {
  tursoUrl: string;
  tursoAuthToken: string;
  autoSync: boolean;
  syncInterval: number;
}

export interface SyncResult {
  success: boolean;
  pushed: number;
  pulled: number;
  conflicts: number;
  errors: string[];
}

export interface ElectronAPI {
  posts: {
    create: (data: Partial<PostData>) => Promise<PostData>;
    update: (id: string, data: Partial<PostData>) => Promise<PostData | null>;
    delete: (id: string) => Promise<boolean>;
    get: (id: string) => Promise<PostData | null>;
    getAll: () => Promise<PostData[]>;
    getByStatus: (status: string) => Promise<PostData[]>;
    publish: (id: string) => Promise<PostData | null>;
    unpublish: (id: string) => Promise<PostData | null>;
    rebuildFromFiles: () => Promise<void>;
  };
  media: {
    import: (sourcePath: string, metadata?: Partial<MediaData>) => Promise<MediaData>;
    importDialog: () => Promise<MediaData[]>;
    update: (id: string, data: Partial<MediaData>) => Promise<MediaData | null>;
    delete: (id: string) => Promise<boolean>;
    get: (id: string) => Promise<MediaData | null>;
    getAll: () => Promise<MediaData[]>;
    rebuildFromFiles: () => Promise<void>;
  };
  sync: {
    configure: (config: SyncConfig) => Promise<void>;
    start: (direction?: 'push' | 'pull' | 'bidirectional') => Promise<SyncResult>;
    getStatus: () => Promise<'idle' | 'syncing' | 'error'>;
    isConfigured: () => Promise<boolean>;
    getPendingCount: () => Promise<{ posts: number; media: number }>;
    getLog: (limit?: number) => Promise<unknown[]>;
    stopAutoSync: () => Promise<void>;
  };
  tasks: {
    getAll: () => Promise<TaskProgress[]>;
    getRunning: () => Promise<TaskProgress[]>;
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

export {};
