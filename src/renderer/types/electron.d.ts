// Type definitions for the Electron API exposed via preload

export interface ProjectMetadata {
  name: string;
  description?: string;
}

export interface ProjectData {
  id: string;
  name: string;
  slug: string;
  description?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PostData {
  id: string;
  projectId: string;
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

export interface PostFilter {
  status?: 'draft' | 'published' | 'archived';
  tags?: string[];
  categories?: string[];
  year?: number;
  month?: number;
  from?: string;
  to?: string;
}

export interface SearchResult {
  id: string;
  title: string;
  slug: string;
  excerpt?: string;
}

export interface MediaData {
  id: string;
  projectId: string;
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

export interface DropboxConfig {
  accessToken: string;
  appKey: string;
  remotePath?: string;
}

export interface DropboxSyncResult {
  uploaded: number;
  downloaded: number;
  conflicts: number;
  errors?: string[];
}

export interface DropboxConflict {
  id: string;
  localPath: string;
  remotePath: string;
  localModified: string;
  remoteModified: string;
}

export interface PaginatedPostsResult {
  items: PostData[];
  hasMore: boolean;
  total: number;
}

export interface DashboardStats {
  totalPosts: number;
  draftCount: number;
  publishedCount: number;
  archivedCount: number;
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface CategoryCount {
  category: string;
  count: number;
}

export interface TagData {
  id: string;
  projectId: string;
  name: string;
  color?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TagWithCount {
  name: string;
  color: string | null;
  count: number;
}

export interface DeleteTagResult {
  success: boolean;
  postsUpdated: number;
}

export interface MergeTagsResult {
  success: boolean;
  postsUpdated: number;
  tagsDeleted: number;
  targetTag: string;
}

export interface RenameTagResult {
  success: boolean;
  postsUpdated: number;
  oldName: string;
  newName: string;
}

export interface SyncTagsResult {
  discovered: number;
  added: string[];
}

// Chat/AI types
export interface ChatConversation {
  id: string;
  projectId: string;
  title: string;
  model?: string;
  copilotSessionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: string;
  createdAt: string;
}

export interface ChatModel {
  id: string;
  name: string;
}

export interface ChatAuthStatus {
  authenticated: boolean;
  username?: string;
}

export interface ChatReadyStatus {
  ready: boolean;
  authenticated: boolean;
}

export interface ChatStreamDelta {
  conversationId: string;
  delta: string;
}

export interface ChatToolCall {
  conversationId: string;
  toolCall: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface ChatToolResult {
  conversationId: string;
  result: unknown;
}

export interface ChatTitleUpdate {
  conversationId: string;
  title: string;
}

export interface ChatDeviceCode {
  verificationUri: string;
  userCode: string;
}

export interface ElectronAPI {
  projects: {
    create: (data: { name: string; description?: string; slug?: string }) => Promise<ProjectData>;
    update: (id: string, data: Partial<ProjectData>) => Promise<ProjectData | null>;
    delete: (id: string) => Promise<boolean>;
    deleteWithData: (id: string) => Promise<boolean>;
    get: (id: string) => Promise<ProjectData | null>;
    getAll: () => Promise<ProjectData[]>;
    getActive: () => Promise<ProjectData | null>;
    setActive: (id: string) => Promise<ProjectData | null>;
  };
  posts: {
    create: (data: Partial<PostData>) => Promise<PostData>;
    update: (id: string, data: Partial<PostData>) => Promise<PostData | null>;
    delete: (id: string) => Promise<boolean>;
    get: (id: string) => Promise<PostData | null>;
    getAll: (options?: { limit?: number; offset?: number }) => Promise<PaginatedPostsResult>;
    getByStatus: (status: string) => Promise<PostData[]>;
    publish: (id: string) => Promise<PostData | null>;
    discard: (id: string) => Promise<PostData | null>;
    hasPublishedVersion: (id: string) => Promise<boolean>;
    rebuildFromFiles: () => Promise<void>;
    reindexText: () => Promise<void>;
    search: (query: string) => Promise<SearchResult[]>;
    filter: (filter: PostFilter) => Promise<PostData[]>;
    getTags: () => Promise<string[]>;
    getCategories: () => Promise<string[]>;
    getByYearMonth: () => Promise<{ year: number; month: number; count: number }[]>;
    getDashboardStats: () => Promise<DashboardStats>;
    getTagsWithCounts: () => Promise<TagCount[]>;
    getCategoriesWithCounts: () => Promise<CategoryCount[]>;
    getLinksTo: (id: string) => Promise<PostData[]>;
    getLinkedBy: (id: string) => Promise<PostData[]>;
    rebuildLinks: () => Promise<void>;
    isSlugAvailable: (slug: string, excludePostId?: string) => Promise<boolean>;
    generateUniqueSlug: (title: string, excludePostId?: string) => Promise<string>;
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
  dropbox: {
    configure: (config: DropboxConfig) => Promise<void>;
    isConfigured: () => Promise<boolean>;
    getStatus: () => Promise<string>;
    syncAll: () => Promise<DropboxSyncResult>;
    startWatching: () => Promise<void>;
    stopWatching: () => Promise<void>;
    startPolling: () => Promise<void>;
    stopPolling: () => Promise<void>;
    getConflicts: () => Promise<DropboxConflict[]>;
    resolveConflict: (conflictId: string, resolution: 'local-wins' | 'remote-wins') => Promise<void>;
    getLastSyncTime: () => Promise<string | null>;
  };
  app: {
    getDataPaths: () => Promise<{ database: string; posts: string; media: string }>;
    openFolder: (folderPath: string) => Promise<string>;
    showItemInFolder: (itemPath: string) => Promise<void>;
  };
  meta: {
    getTags: () => Promise<string[]>;
    getCategories: () => Promise<string[]>;
    addTag: (tag: string) => Promise<string[]>;
    removeTag: (tag: string) => Promise<string[]>;
    addCategory: (category: string) => Promise<string[]>;
    removeCategory: (category: string) => Promise<string[]>;
    syncOnStartup: () => Promise<{ tags: string[]; categories: string[]; projectMetadata: ProjectMetadata | null }>;
    getProjectMetadata: () => Promise<ProjectMetadata | null>;
    setProjectMetadata: (metadata: { name: string; description?: string }) => Promise<ProjectMetadata | null>;
    updateProjectMetadata: (updates: { name?: string; description?: string }) => Promise<ProjectMetadata | null>;
  };
  tags: {
    getAll: () => Promise<TagData[]>;
    getWithCounts: () => Promise<TagWithCount[]>;
    get: (id: string) => Promise<TagData | null>;
    getByName: (name: string) => Promise<TagData | null>;
    create: (data: { name: string; color?: string }) => Promise<TagData>;
    update: (id: string, data: { name?: string; color?: string | null }) => Promise<TagData | null>;
    delete: (id: string) => Promise<DeleteTagResult>;
    merge: (sourceTagIds: string[], targetTagId: string) => Promise<MergeTagsResult>;
    rename: (id: string, newName: string) => Promise<RenameTagResult>;
    getPostsWithTag: (tagId: string) => Promise<string[]>;
    syncFromPosts: () => Promise<SyncTagsResult>;
  };
  chat: {
    // Authentication
    checkReady: () => Promise<ChatReadyStatus>;
    copilotAuthStatus: () => Promise<ChatAuthStatus>;
    copilotLogin: () => Promise<{ success: boolean; error?: string; login?: string }>;
    copilotLogout: () => Promise<void>;
    
    // Settings
    getAvailableModels: () => Promise<ChatModel[]>;
    setDefaultModel: (modelId: string) => Promise<void>;
    getSystemPrompt: () => Promise<string | null>;
    setSystemPrompt: (prompt: string) => Promise<void>;
    
    // Conversations
    getConversations: () => Promise<ChatConversation[]>;
    createConversation: (title?: string, model?: string) => Promise<ChatConversation>;
    getConversation: (id: string) => Promise<ChatConversation | null>;
    updateConversation: (id: string, updates: { title?: string; model?: string }) => Promise<ChatConversation | null>;
    deleteConversation: (id: string) => Promise<boolean>;
    
    // Messaging
    sendMessage: (conversationId: string, message: string) => Promise<string>;
    abortMessage: (conversationId: string) => Promise<void>;
    getHistory: (conversationId: string) => Promise<ChatMessage[]>;
    clearMessages: (conversationId: string) => Promise<void>;
    setConversationModel: (conversationId: string, modelId: string) => Promise<void>;
    
    // Event listeners for streaming/progress
    onStreamDelta: (callback: (data: ChatStreamDelta) => void) => () => void;
    onToolCall: (callback: (data: ChatToolCall) => void) => () => void;
    onToolResult: (callback: (data: ChatToolResult) => void) => () => void;
    onTitleUpdated: (callback: (data: ChatTitleUpdate) => void) => () => void;
    onDeviceCode: (callback: (data: ChatDeviceCode) => void) => () => void;
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
