// Type definitions for the Electron API exposed via preload

/** Payload emitted when the CLI mutates an entity (via db_notifications). */
export interface EntityChangedPayload {
  entity: 'post' | 'media' | 'script' | 'template';
  entityId: string;
  action: 'created' | 'updated' | 'deleted';
}

export interface ImportExecuteResult {
  taskId: string;
  totalItems: number;
}

export interface ImportExecutionProgress {
  taskId: string;
  phase: string;
  current: number;
  total: number;
  detail?: string;
  eta?: number;
}

export interface ImportCompleteResult {
  taskId: string;
  success: boolean;
  posts: { imported: number; skipped: number; errors: number };
  media: { imported: number; skipped: number; errors: number };
  pages: { imported: number; skipped: number; errors: number };
  tags: { created: number; skipped: number };
}

export interface ImportDefinitionData {
  id: string;
  projectId: string;
  name: string;
  wxrFilePath: string | null;
  uploadsFolderPath: string | null;
  lastAnalysisResult: unknown | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMetadata {
  name: string;
  description?: string;
  dataPath?: string;
  publicUrl?: string;
  mainLanguage?: string;
  defaultAuthor?: string;
  maxPostsPerPage?: number;
  blogmarkCategory?: string;
  pythonRuntimeMode?: 'webworker' | 'main-thread';
  picoTheme?: import('./picoThemes').PicoThemeName;
  categoryMetadata?: Record<string, CategoryMetadata>;
  categorySettings?: Record<string, CategoryRenderSettings>;
  semanticSimilarityEnabled?: boolean;
  blogLanguages?: string[];
}

export interface CategoryRenderSettings {
  renderInLists: boolean;
  showTitle: boolean;
  postTemplateSlug?: string;
  listTemplateSlug?: string;
}

export interface CategoryMetadata extends CategoryRenderSettings {
  title: string;
}

export interface PublishingPreferences {
  sshHost: string;
  sshUser: string;
  sshRemotePath: string;
  sshMode: 'scp' | 'rsync';
}

export interface ProjectData {
  id: string;
  name: string;
  slug: string;
  description?: string;
  dataPath?: string;
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
  language?: string;
  doNotTranslate?: boolean;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  tags: string[];
  categories: string[];
  availableLanguages: string[];
  templateSlug?: string;
}

export interface PostTranslationData {
  id: string;
  projectId: string;
  translationFor: string;
  language: string;
  title: string;
  excerpt?: string;
  content: string;
  status: 'draft' | 'published' | 'archived';
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  filePath: string;
}

export interface PostFilter {
  status?: 'draft' | 'published' | 'archived';
  tags?: string[];
  categories?: string[];
  language?: string;
  missingTranslationLanguage?: string;
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
  title?: string;
  alt?: string;
  caption?: string;
  author?: string;
  language?: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  availableLanguages: string[];
}

export interface MediaTranslationData {
  id: string;
  projectId: string;
  translationFor: string;
  language: string;
  title?: string;
  alt?: string;
  caption?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MediaFilter {
  tags?: string[];
  year?: number;
  month?: number;
  language?: string;
  missingTranslationLanguage?: string;
}

export interface MediaSearchResult {
  id: string;
  originalName: string;
  title?: string;
  mimeType: string;
  createdAt: string;
}

export type ScriptKind = 'macro' | 'utility' | 'transform';

export interface ScriptData {
  id: string;
  projectId: string;
  slug: string;
  title: string;
  kind: ScriptKind;
  entrypoint: string;
  enabled: boolean;
  version: number;
  filePath: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export type TemplateKind = 'post' | 'list' | 'not-found' | 'partial';

export interface TemplateData {
  id: string;
  projectId: string;
  slug: string;
  title: string;
  kind: TemplateKind;
  enabled: boolean;
  version: number;
  filePath: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateDeleteResult {
  deleted: boolean;
  references?: { postIds: string[]; tagIds: string[] };
}

export interface TaskProgress {
  taskId: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  message: string;
  startTime: string;
  endTime?: string;
  error?: string;
  groupId?: string;
  groupName?: string;
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
  postTemplateSlug?: string;
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

export interface GitAvailability {
  gitFound: boolean;
  version?: string;
}

export interface GitRepoState {
  isRepo: boolean;
  rootPath?: string;
  currentBranch?: string;
  hasRemote: boolean;
}

export type GitFileStatus = 'untracked' | 'modified' | 'deleted' | 'renamed' | 'staged';

export interface GitStatusFile {
  path: string;
  status: GitFileStatus;
  previousPath?: string;
}

export interface GitStatusCounts {
  untracked: number;
  modified: number;
  deleted: number;
  renamed: number;
  staged: number;
  total: number;
}

export interface GitStatusDto {
  files: GitStatusFile[];
  counts: GitStatusCounts;
}

export interface GitDiffDto {
  filePath: string;
  patch: string;
}

export interface GitDiffContentDto {
  filePath: string;
  original: string;
  modified: string;
}

export interface GitCommitDiffContentDto {
  commitHash: string;
  original: string;
  modified: string;
  files: GitCommitDiffFileDto[];
}

export interface GitCommitDiffFileDto {
  filePath: string;
  original: string;
  modified: string;
}

export type GitHistorySyncStatus = 'both' | 'local-only' | 'remote-only';

export interface GitHistoryEntry {
  hash: string;
  shortHash: string;
  date: string;
  subject: string;
  author: string;
  syncStatus?: GitHistorySyncStatus;
}

export interface GitRemoteStateDto {
  localBranch: string | null;
  upstreamBranch: string | null;
  hasUpstream: boolean;
  ahead: number;
  behind: number;
}

export type GitInitPhase =
  | 'checking-git'
  | 'initializing-repo'
  | 'configuring-lfs'
  | 'tracking-lfs-patterns'
  | 'staging-files'
  | 'creating-initial-commit'
  | 'configuring-remote'
  | 'completed'
  | 'failed';

export interface GitInitProgress {
  phase: GitInitPhase;
  progress: number;
  message: string;
  detail?: string;
}

export interface GitInitResult {
  success: boolean;
  error?: string;
  code?: 'git-missing' | 'git-lfs-missing' | 'init-failed' | 'remote-failed' | 'commit-failed';
}

export interface GitIgnoreEnsureResult {
  updated: boolean;
  created: boolean;
  addedEntries: string[];
}

export interface GitLfsPruneResult {
  success: boolean;
  dryRun: boolean;
  verifyRemote: boolean;
  recentCommitsToKeep: number;
  output?: string;
  error?: string;
}

export interface GitActionResult {
  success: boolean;
  code?: 'auth-required' | 'conflict' | 'network' | 'action-failed' | 'offline';
  error?: string;
  guidance?: string[];
}

// Post-Media Link types
export interface MediaLinkData {
  id: string;
  projectId: string;
  postId: string;
  mediaId: string;
  sortOrder: number;
  createdAt: string;
}

// Chat/AI types
export interface ChatConversation {
  id: string;
  title: string;
  model?: string;
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
  provider: string;
  vision?: boolean;
}

export interface ModelCatalogEntry {
  id: string;
  name: string;
  family: string | null;
  contextWindow: number | null;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  inputPrice: number | null;
  outputPrice: number | null;
  cacheReadPrice: number | null;
  supportsAttachments: boolean | null;
  supportsReasoning: boolean | null;
  supportsToolCall: boolean | null;
}

export interface ModelCatalogRefreshResult {
  success: boolean;
  modelsUpdated: number;
  notModified?: boolean;
  error?: string;
}

export interface ChatReadyStatus {
  ready: boolean;
  error?: string;
  backend?: string;
  providers?: { opencode: boolean; mistral: boolean; ollama: boolean; lmstudio: boolean; offlineMode: boolean };
}

export interface ChatApiKeyStatus {
  hasKey: boolean;
  maskedKey: string;
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

export interface ChatTokenUsage {
  conversationId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  cumulativeInputTokens: number;
  cumulativeOutputTokens: number;
  cumulativeCacheReadTokens: number;
  cumulativeCacheWriteTokens: number;
  cumulativeTotalTokens: number;
}

export interface ChatSendMetadata {
  surface?: 'tab' | 'sidebar';
}

// A2UI types imported for use in ElectronAPI and re-exported for renderer
import type { A2UIServerMessage, A2UIClientAction } from '../a2ui/types';
export type { A2UIServerMessage, A2UIClientAction };

export interface SimilarPost {
  postId: string;
  similarity: number;
}

export interface TagSuggestion {
  name: string;
  score: number;
}

export interface DuplicatePair {
  postA: { id: string; title: string; slug: string; publishedAt?: Date };
  postB: { id: string; title: string; slug: string; publishedAt?: Date };
  similarity: number;
  exactMatch?: boolean;
}

export interface SiteValidationReport {
  sitemapPath: string;
  sitemapChanged: boolean;
  missingUrlPaths: string[];
  extraUrlPaths: string[];
  updatedPostUrlPaths: string[];
  expectedUrlCount: number;
  existingHtmlUrlCount: number;
}

export interface TranslationValidationIssue {
  issue: 'same-language-as-canonical' | 'missing-source-post' | 'do-not-translate-has-translations' | 'content-in-database';
  translationId?: string;
  translationFor: string;
  canonicalLanguage?: string;
  translationLanguage: string;
  title?: string;
  filePath?: string;
}

export interface TranslationValidationReport {
  checkedDatabaseRowCount: number;
  checkedFilesystemFileCount: number;
  invalidDatabaseRows: TranslationValidationIssue[];
  invalidFilesystemFiles: TranslationValidationIssue[];
}

export interface TranslationValidationFixResult {
  deletedDatabaseRows: number;
  deletedFiles: number;
  flushedTranslations: number;
}

export interface SiteValidationApplyResult {
  renderedUrlCount: number;
  deletedUrlCount: number;
  removedEmptyDirCount: number;
}

export interface CalendarRegenerationResult {
  calendarPath: string;
  changed: boolean;
}

export type MenuItemKind = 'page' | 'submenu' | 'category-archive' | 'home';

export interface MenuItemData {
  id: string;
  title: string;
  kind: MenuItemKind;
  pageId?: string;
  pageSlug?: string;
  categoryName?: string;
  children: MenuItemData[];
}

export interface MenuDocument {
  items: MenuItemData[];
}

export interface ElectronAPI {
  git: {
    checkAvailability: () => Promise<GitAvailability>;
    getRepoState: (projectPath: string) => Promise<GitRepoState>;
    getStatus: (projectPath: string) => Promise<GitStatusDto>;
    getDiff: (projectPath: string, filePath: string) => Promise<GitDiffDto>;
    getDiffContent: (projectPath: string, filePath: string) => Promise<GitDiffContentDto>;
    getCommitDiffContent: (projectPath: string, commitHash: string) => Promise<GitCommitDiffContentDto>;
    getHistory: (projectPath: string, limit?: number) => Promise<GitHistoryEntry[]>;
    getFileHistory: (projectPath: string, filePath: string, limit?: number) => Promise<GitHistoryEntry[]>;
    getRemoteState: (projectPath: string) => Promise<GitRemoteStateDto>;
    fetch: (projectPath: string) => Promise<GitActionResult>;
    pull: (projectPath: string) => Promise<GitActionResult>;
    push: (projectPath: string) => Promise<GitActionResult>;
    commitAll: (projectPath: string, message: string) => Promise<GitActionResult>;
    ensureGitignore: (projectPath: string) => Promise<GitIgnoreEnsureResult>;
    pruneLfs: (projectPath: string, options?: { dryRun?: boolean; verifyRemote?: boolean; recentCommitsToKeep?: number }) => Promise<GitLfsPruneResult>;
    init: (projectPath: string, remoteUrl?: string) => Promise<GitInitResult>;
    onInitProgress: (callback: (progress: GitInitProgress) => void) => () => void;
  };
  projects: {
    create: (data: { name: string; description?: string; slug?: string; dataPath?: string }) => Promise<ProjectData>;
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
    getBySlug: (slug: string) => Promise<PostData | null>;
    getTranslation: (postId: string, language: string) => Promise<PostTranslationData | null>;
    getTranslations: (postId: string) => Promise<PostTranslationData[]>;
    upsertTranslation: (postId: string, language: string, data: Partial<PostTranslationData>) => Promise<PostTranslationData>;
    publishTranslation: (postId: string, language: string) => Promise<PostTranslationData | null>;
    getPreviewUrl: (id: string, options?: { draft?: boolean; lang?: string }) => Promise<string | null>;
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
    replaceFile: (id: string, newSourcePath: string) => Promise<MediaData | null>;
    replaceFileDialog: (id: string) => Promise<MediaData | null>;
    delete: (id: string) => Promise<boolean>;
    get: (id: string) => Promise<MediaData | null>;
    getUrl: (id: string) => Promise<string | null>;
    getFilePath: (id: string) => Promise<string | null>;
    getAll: () => Promise<MediaData[]>;
    rebuildFromFiles: () => Promise<void>;
    reindexText: () => Promise<void>;
    getThumbnail: (id: string, size?: 'small' | 'medium' | 'large') => Promise<string | null>;
    regenerateThumbnails: (id: string) => Promise<Record<string, string> | null>;
    regenerateMissingThumbnails: () => Promise<{ processed: number; generated: number; failed: number }>;
    filter: (filter: MediaFilter) => Promise<MediaData[]>;
    search: (query: string) => Promise<MediaSearchResult[]>;
    getByYearMonth: () => Promise<{ year: number; month: number; count: number }[]>;
    getTags: () => Promise<string[]>;
    getTagsWithCounts: () => Promise<TagCount[]>;
    getTranslation: (mediaId: string, language: string) => Promise<MediaTranslationData | null>;
    getTranslations: (mediaId: string) => Promise<MediaTranslationData[]>;
    upsertTranslation: (mediaId: string, language: string, data: Partial<MediaTranslationData>) => Promise<MediaTranslationData>;
    deleteTranslation: (mediaId: string, language: string) => Promise<boolean>;
  };
  scripts: {
    create: (data: {
      title: string;
      kind: ScriptKind;
      content: string;
      slug?: string;
      entrypoint?: string;
      enabled?: boolean;
    }) => Promise<ScriptData>;
    update: (id: string, data: {
      title?: string;
      kind?: ScriptKind;
      content?: string;
      slug?: string;
      entrypoint?: string;
      enabled?: boolean;
    }) => Promise<ScriptData | null>;
    delete: (id: string) => Promise<boolean>;
    get: (id: string) => Promise<ScriptData | null>;
    getAll: () => Promise<ScriptData[]>;
    /** Internal: editor macro plugin helper. Not exposed via Python API contract. */
    getEnabledMacroSlugs: () => Promise<string[]>;
    rebuildFromFiles: () => Promise<void>;
    /** Create a task entry for a running utility script. */
    startTask: (taskId: string, name: string) => Promise<void>;
    /** Mark a utility script task as completed. */
    completeTask: (taskId: string) => Promise<void>;
    /** Mark a utility script task as failed. */
    failTask: (taskId: string, error: string) => Promise<void>;
  };
  templates: {
    create: (data: {
      title: string;
      kind: TemplateKind;
      content: string;
      slug?: string;
      enabled?: boolean;
    }) => Promise<TemplateData>;
    update: (id: string, data: {
      title?: string;
      kind?: TemplateKind;
      content?: string;
      slug?: string;
      enabled?: boolean;
    }) => Promise<TemplateData | null>;
    delete: (id: string, options?: { force?: boolean }) => Promise<TemplateDeleteResult>;
    get: (id: string) => Promise<TemplateData | null>;
    getAll: () => Promise<TemplateData[]>;
    getEnabledByKind: (kind: TemplateKind) => Promise<TemplateData[]>;
    validate: (content: string) => Promise<{ valid: boolean; errors: string[] }>;
    rebuildFromFiles: () => Promise<void>;
  };
  postMedia: {
    link: (postId: string, mediaId: string) => Promise<MediaLinkData>;
    unlink: (postId: string, mediaId: string) => Promise<void>;
    linkMany: (postId: string, mediaIds: string[]) => Promise<{ linked: string[]; skipped: string[] }>;
    unlinkMany: (postId: string, mediaIds: string[]) => Promise<{ unlinked: string[] }>;
    getForPost: (postId: string) => Promise<MediaLinkData[]>;
    getForMedia: (mediaId: string) => Promise<MediaLinkData[]>;
    getMediaDataForPost: (postId: string) => Promise<Array<MediaLinkData & { media: MediaData }>>;
    reorder: (postId: string, mediaIds: string[]) => Promise<void>;
    isLinked: (postId: string, mediaId: string) => Promise<boolean>;
    import: (postId: string, filePath: string) => Promise<MediaLinkData>;
    dropImport: (postId: string, filePath: string) => Promise<{ mediaId: string; alt: string; relativePath: string }>;
    rebuild: () => Promise<void>;
  };
  sync: {
    checkAvailability: () => Promise<{ gitFound: boolean; version?: string }>;
    getRepoState: () => Promise<{ isRepo: boolean; rootPath?: string; currentBranch?: string; hasRemote: boolean }>;
    getStatus: () => Promise<{ files: Array<{ path: string; status: string; previousPath?: string }>; counts: { untracked: number; modified: number; deleted: number; renamed: number; staged: number } }>;
    getHistory: (limit?: number) => Promise<Array<{ hash: string; shortHash: string; date: string; subject: string; author: string }>>;
    getRemoteState: () => Promise<{ localBranch: string | null; upstreamBranch: string | null; hasUpstream: boolean; ahead: number; behind: number }>;
    fetch: () => Promise<{ success: boolean; code?: string; error?: string; guidance?: string[] }>;
    pull: () => Promise<{ success: boolean; code?: string; error?: string; guidance?: string[] }>;
    push: () => Promise<{ success: boolean; code?: string; error?: string; guidance?: string[] }>;
    commitAll: (message: string) => Promise<{ success: boolean; code?: string; error?: string; guidance?: string[] }>;
  };
  tasks: {
    getAll: () => Promise<TaskProgress[]>;
    getRunning: () => Promise<TaskProgress[]>;
    cancel: (taskId: string) => Promise<boolean>;
    clearCompleted: () => Promise<void>;
  };
  app: {
    getDataPaths: () => Promise<{ database: string; posts: string; media: string }>;
    getSystemLanguage: () => Promise<string>;
    getTitleBarMetrics: () => Promise<{ macosLeftInset: number } | null>;
    openFolder: (folderPath: string) => Promise<string>;
    showItemInFolder: (itemPath: string) => Promise<void>;
    selectFolder: (title?: string) => Promise<string | null>;
    getDefaultProjectPath: (projectId: string) => Promise<string>;
    readProjectMetadata: (folderPath: string) => Promise<{ name?: string; description?: string; publicUrl?: string; mainLanguage?: string } | null>;
    getBlogmarkBookmarklet: () => Promise<string>;
    copyToClipboard: (text: string) => Promise<boolean>;
    notifyRendererReady: () => Promise<boolean>;
    setPreviewPostTarget: (postId: string | null) => Promise<void>;
    triggerMenuAction: (action: string) => Promise<void>;
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
    updateProjectMetadata: (updates: { name?: string; description?: string; dataPath?: string; publicUrl?: string; mainLanguage?: string; defaultAuthor?: string; maxPostsPerPage?: number; blogmarkCategory?: string; pythonRuntimeMode?: 'webworker' | 'main-thread'; picoTheme?: import('./picoThemes').PicoThemeName; categoryMetadata?: Record<string, CategoryMetadata>; categorySettings?: Record<string, CategoryRenderSettings>; semanticSimilarityEnabled?: boolean; blogLanguages?: string[] }) => Promise<ProjectMetadata | null>;
    getPublishingPreferences: () => Promise<PublishingPreferences | null>;
    setPublishingPreferences: (prefs: PublishingPreferences) => Promise<void>;
    clearPublishingPreferences: () => Promise<void>;
  };
  tags: {
    getAll: () => Promise<TagData[]>;
    getWithCounts: () => Promise<TagWithCount[]>;
    get: (id: string) => Promise<TagData | null>;
    getByName: (name: string) => Promise<TagData | null>;
    create: (data: { name: string; color?: string }) => Promise<TagData>;
    update: (id: string, data: { name?: string; color?: string | null; postTemplateSlug?: string | null }) => Promise<TagData | null>;
    delete: (id: string) => Promise<DeleteTagResult>;
    merge: (sourceTagIds: string[], targetTagId: string) => Promise<MergeTagsResult>;
    rename: (id: string, newName: string) => Promise<RenameTagResult>;
    getPostsWithTag: (tagId: string) => Promise<string[]>;
    syncFromPosts: () => Promise<SyncTagsResult>;
  };
  import: {
    selectAndAnalyze: (uploadsFolder?: string) => Promise<unknown>;
    analyzeFile: (filePath: string, uploadsFolder?: string) => Promise<unknown>;
    selectUploadsFolder: () => Promise<string | null>;
    execute: (reportJson: string, uploadsFolder?: string) => Promise<ImportExecuteResult>;
    onProgress: (callback: (data: { step: string; detail?: string }) => void) => () => void;
    onExecutionProgress: (callback: (data: ImportExecutionProgress) => void) => () => void;
    onComplete: (callback: (data: ImportCompleteResult) => void) => () => void;
  };
  importDefinitions: {
    create: (name?: string) => Promise<ImportDefinitionData>;
    get: (id: string) => Promise<ImportDefinitionData | null>;
    getAll: () => Promise<ImportDefinitionData[]>;
    update: (id: string, updates: Partial<Pick<ImportDefinitionData, 'name' | 'wxrFilePath' | 'uploadsFolderPath' | 'lastAnalysisResult'>>) => Promise<ImportDefinitionData | null>;
    delete: (id: string) => Promise<boolean>;
    onNameUpdated: (callback: (data: { definitionId: string; name: string }) => void) => () => void;
  };
  metadataDiff: {
    getStats: () => Promise<{
      totalPosts: number;
      publishedPosts: number;
      draftPosts: number;
      totalMedia: number;
      totalScripts: number;
      publishedScripts: number;
      totalTemplates: number;
      publishedTemplates: number;
    }>;
    scan: () => Promise<{
      totalScanned: number;
      postsWithDifferences: number;
      differences: Array<{
        postId: string;
        title: string;
        slug: string;
        filePath?: string;
        hasDifferences: boolean;
        fileMissing?: boolean;
        differences: Record<string, { dbValue: unknown; fileValue: unknown }>;
      }>;
      groups: Array<{
        field: string;
        label: string;
        posts: Array<{
          postId: string;
          title: string;
          slug: string;
          dbValue: unknown;
          fileValue: unknown;
        }>;
      }>;
      orphanFiles: Array<{
        filePath: string;
        slug: string;
        title?: string;
        id?: string;
      }>;
    }>;
    syncDbToFile: (postIds: string[], groupLabel: string) => Promise<{ success: number; failed: number }>;
    syncFileToDb: (postIds: string[], field: string, groupLabel: string) => Promise<{ success: number; failed: number }>;
    scanMedia: () => Promise<{
      totalScanned: number;
      itemsWithDifferences: number;
      differences: Array<{
        mediaId: string;
        originalName: string;
        filePath?: string;
        hasDifferences: boolean;
        fileMissing?: boolean;
        differences: Record<string, { dbValue: unknown; fileValue: unknown }>;
      }>;
      groups: Array<{
        field: string;
        label: string;
        items: Array<{ mediaId: string; originalName: string; dbValue: unknown; fileValue: unknown }>;
      }>;
    }>;
    syncMediaDbToFile: (mediaIds: string[], groupLabel: string) => Promise<{ success: number; failed: number }>;
    syncMediaFileToDb: (mediaIds: string[], field: string, groupLabel: string) => Promise<{ success: number; failed: number }>;
    scanScripts: () => Promise<{
      totalScanned: number;
      itemsWithDifferences: number;
      differences: Array<{
        scriptId: string;
        title: string;
        slug: string;
        filePath?: string;
        hasDifferences: boolean;
        fileMissing?: boolean;
        differences: Record<string, { dbValue: unknown; fileValue: unknown }>;
      }>;
      groups: Array<{
        field: string;
        label: string;
        items: Array<{ scriptId: string; title: string; slug: string; dbValue: unknown; fileValue: unknown }>;
      }>;
    }>;
    syncScriptDbToFile: (scriptIds: string[], groupLabel: string) => Promise<{ success: number; failed: number }>;
    syncScriptFileToDb: (scriptIds: string[], field: string, groupLabel: string) => Promise<{ success: number; failed: number }>;
    scanTemplates: () => Promise<{
      totalScanned: number;
      itemsWithDifferences: number;
      differences: Array<{
        templateId: string;
        title: string;
        slug: string;
        filePath?: string;
        hasDifferences: boolean;
        fileMissing?: boolean;
        differences: Record<string, { dbValue: unknown; fileValue: unknown }>;
      }>;
      groups: Array<{
        field: string;
        label: string;
        items: Array<{ templateId: string; title: string; slug: string; dbValue: unknown; fileValue: unknown }>;
      }>;
    }>;
    syncTemplateDbToFile: (templateIds: string[], groupLabel: string) => Promise<{ success: number; failed: number }>;
    syncTemplateFileToDb: (templateIds: string[], field: string, groupLabel: string) => Promise<{ success: number; failed: number }>;
    importOrphanFiles: (filePaths: string[]) => Promise<{ success: number; failed: number }>;
  };
  blog: {
    generateSitemap: () => Promise<{
      path: string;
      urlCount: number;
      postCount: number;
      tagCount: number;
      categoryCount: number;
      archiveCount: number;
      pagesGenerated: number;
    }>;
    validateSite: () => Promise<SiteValidationReport>;
    validateTranslations: () => Promise<TranslationValidationReport>;
    fixInvalidTranslations: (report: TranslationValidationReport) => Promise<TranslationValidationFixResult>;
    fillMissingTranslations: () => Promise<{ taskStarted: boolean }>;
    applyValidation: (report: SiteValidationReport) => Promise<SiteValidationApplyResult>;
    regenerateCalendar: () => Promise<CalendarRegenerationResult>;
  };
  publish: {
    uploadSite: (credentials: {
      sshHost: string;
      sshUser: string;
      sshRemotePath: string;
      sshMode: 'scp' | 'rsync';
    }) => Promise<{
      htmlFilesUploaded: number;
      thumbnailFilesUploaded: number;
      mediaFilesUploaded: number;
      filesSkipped: number;
    }>;
  };
  menu: {
    get: () => Promise<MenuDocument>;
    save: (menu: MenuDocument) => Promise<MenuDocument>;
  };
  chat: {
    // API Key Management
    checkReady: () => Promise<ChatReadyStatus>;
    validateApiKey: (apiKey: string) => Promise<{ isValid: boolean; models: ChatModel[] }>;
    setApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
    getApiKey: () => Promise<ChatApiKeyStatus>;

    // Mistral API Key
    validateMistralApiKey: (apiKey: string) => Promise<{ isValid: boolean; models: ChatModel[] }>;
    setMistralApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
    getMistralApiKey: () => Promise<ChatApiKeyStatus>;

    // Ollama (local)
    getOllamaEnabled: () => Promise<boolean>;
    setOllamaEnabled: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
    getOllamaModels: () => Promise<ChatModel[]>;
    getOllamaModelCapabilities: () => Promise<Record<string, { tools: boolean; vision: boolean }>>;
    setOllamaModelCapabilities: (modelId: string, caps: { tools: boolean; vision: boolean }) => Promise<{ success: boolean; error?: string }>;

    // LM Studio (local)
    getLmstudioEnabled: () => Promise<boolean>;
    setLmstudioEnabled: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
    getLmstudioModels: () => Promise<ChatModel[]>;
    getLmstudioModelCapabilities: () => Promise<Record<string, { tools: boolean; vision: boolean }>>;
    setLmstudioModelCapabilities: (modelId: string, caps: { tools: boolean; vision: boolean }) => Promise<{ success: boolean; error?: string }>;

    // Offline / Airplane mode
    getOfflineMode: () => Promise<boolean>;
    setOfflineMode: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
    getOfflineChatModel: () => Promise<{ success: boolean; modelId?: string | null }>;
    setOfflineChatModel: (modelId: string | null) => Promise<{ success: boolean; error?: string }>;
    getOfflineTitleModel: () => Promise<{ success: boolean; modelId?: string | null }>;
    setOfflineTitleModel: (modelId: string | null) => Promise<{ success: boolean; error?: string }>;
    getOfflineImageAnalysisModel: () => Promise<{ success: boolean; modelId?: string | null }>;
    setOfflineImageAnalysisModel: (modelId: string | null) => Promise<{ success: boolean; error?: string }>;
    getKnownLocalModels: () => Promise<ChatModel[]>;

    // Settings
    getAvailableModels: () => Promise<{ success: boolean; models?: ChatModel[]; selectedModel?: string; error?: string }>;
    setDefaultModel: (modelId: string) => Promise<{ success: boolean; error?: string }>;
    getSystemPrompt: () => Promise<{ success: boolean; prompt?: string; error?: string }>;
    setSystemPrompt: (prompt: string) => Promise<{ success: boolean; error?: string }>;

    // Per-purpose model preferences
    getTitleModel: () => Promise<{ success: boolean; modelId?: string | null; error?: string }>;
    setTitleModel: (modelId: string | null) => Promise<{ success: boolean; error?: string }>;
    getImageAnalysisModel: () => Promise<{ success: boolean; modelId?: string | null; error?: string }>;
    setImageAnalysisModel: (modelId: string | null) => Promise<{ success: boolean; error?: string }>;

    // Model Catalog
    refreshModelCatalog: () => Promise<ModelCatalogRefreshResult>;
    getModelCatalog: () => Promise<{ success: boolean; entries: ModelCatalogEntry[]; error?: string }>;

    // Conversations
    getConversations: () => Promise<ChatConversation[]>;
    createConversation: (title?: string, model?: string) => Promise<ChatConversation>;
    getConversation: (id: string) => Promise<ChatConversation | null>;
    updateConversation: (id: string, updates: { title?: string; model?: string }) => Promise<ChatConversation | null>;
    deleteConversation: (id: string) => Promise<boolean>;

    // Messaging
    sendMessage: (conversationId: string, message: string, metadata?: ChatSendMetadata) => Promise<{ success: boolean; message?: string; error?: string }>;
    addSystemEvent: (conversationId: string, content: string) => Promise<{ success: boolean; error?: string }>;
    abortMessage: (conversationId: string) => Promise<void>;
    getHistory: (conversationId: string) => Promise<ChatMessage[]>;
    clearMessages: (conversationId: string) => Promise<void>;
    setConversationModel: (conversationId: string, modelId: string) => Promise<void>;

    // Taxonomy Analysis
    analyzeTaxonomy: (categories: Array<{ name: string; slug: string; existsInProject: boolean }>, tags: Array<{ name: string; slug: string; existsInProject: boolean }>, modelId: string) => Promise<{ success: boolean; categoryMappings?: Record<string, string>; tagMappings?: Record<string, string>; error?: string }>;

    // Media Analysis
    analyzeMediaImage: (mediaId: string, language?: string) => Promise<{ success: boolean; title?: string; alt?: string; caption?: string; error?: string }>;

    // Post Language Detection
    detectPostLanguage: (title: string, content: string) => Promise<{ success: boolean; language?: string; error?: string }>;

    // Post Analysis (title, excerpt, slug suggestions)
    analyzePost: (postId: string, language?: string) => Promise<{ success: boolean; title?: string; excerpt?: string; slug?: string; error?: string }>;

    // Post Translation
    translatePost: (postId: string, targetLanguage: string) => Promise<{ success: boolean; translation?: PostTranslationData; error?: string }>;

    // Media Language Detection
    detectMediaLanguage: (title: string, alt: string, caption: string) => Promise<{ success: boolean; language?: string; error?: string }>;

    // Media Metadata Translation
    translateMediaMetadata: (mediaId: string, targetLanguage: string) => Promise<{ success: boolean; translation?: MediaTranslationData; error?: string }>;

    // Event listeners for streaming/progress
    onStreamDelta: (callback: (data: ChatStreamDelta) => void) => () => void;
    onToolCall: (callback: (data: ChatToolCall) => void) => () => void;
    onToolResult: (callback: (data: ChatToolResult) => void) => () => void;
    onTitleUpdated: (callback: (data: ChatTitleUpdate) => void) => () => void;
    onTokenUsage: (callback: (data: ChatTokenUsage) => void) => () => void;

    // A2UI streaming
    onA2UIMessage: (callback: (data: { conversationId: string; message: A2UIServerMessage }) => void) => () => void;
    dispatchA2UIAction: (action: A2UIClientAction) => Promise<{ success: boolean; error?: string }>;
  };
  embeddings: {
    findSimilar: (postId: string, k?: number) => Promise<SimilarPost[]>;
    computeSimilarities: (sourcePostId: string, targetPostIds: string[]) => Promise<Record<string, number>>;
    getProgress: () => Promise<{ indexed: number; total: number }>;
    suggestTags: (postId: string, excludeTags: string[]) => Promise<TagSuggestion[]>;
    findDuplicates: (threshold?: number) => Promise<DuplicatePair[]>;
    runDuplicateSearch: (threshold?: number) => Promise<void>;
    dismissPair: (postIdA: string, postIdB: string) => Promise<void>;
    dismissPairs: (pairIds: Array<[string, string]>) => Promise<void>;
    indexUnindexedPosts: () => Promise<void>;
  };
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
  once: (channel: string, callback: (...args: unknown[]) => void) => void;
  /** Subscribe to entity-changed events fired by the CLI NotificationWatcher. */
  onEntityChanged: (callback: (payload: EntityChangedPayload) => void) => () => void;
  mcp: {
    getAgents: () => Promise<Array<{ id: string; label: string }>>;
    addToAgentConfig: (agentId: string) => Promise<{ success: boolean; configPath: string; error?: string }>;
    removeFromAgentConfig: (agentId: string) => Promise<{ success: boolean; configPath: string; error?: string }>;
    isConfigured: (agentId: string) => Promise<boolean>;
    getPort: () => Promise<number | null>;
  };
}

