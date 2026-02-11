export { TaskManager, taskManager, type Task, type TaskProgress, type TaskStatus } from './TaskManager';
export { PostEngine, getPostEngine, type PostData, type PostFilter, type SearchResult, type PaginatedResult, type PaginationOptions } from './PostEngine';
export { MediaEngine, getMediaEngine, type MediaData } from './MediaEngine';
export { SyncEngine, getSyncEngine, type SyncConfig, type SyncResult, type SyncDirection, type SyncStatus } from './SyncEngine';
export { ProjectEngine, getProjectEngine, type ProjectData } from './ProjectEngine';
export { MetaEngine, getMetaEngine, type ProjectMetadata, DEFAULT_CATEGORIES } from './MetaEngine';
export {
  TagEngine,
  getTagEngine,
  type TagData,
  type TagWithCount,
  type CreateTagInput,
  type UpdateTagInput,
  type DeleteTagResult,
  type MergeTagsResult,
  type RenameTagResult,
  type SyncTagsResult,
} from './TagEngine';
export {
  stemText,
  stemWord,
  stemQuery,
  prepareForFTS,
  getSupportedLanguages,
  type SupportedLanguage,
} from './stemmer';
export {
  DropboxSyncEngine,
  getDropboxSyncEngine,
  type DropboxSyncConfig,
  type DropboxSyncStatus,
  type DropboxConflict,
  type DropboxRemoteChange,
  type DropboxChangesResult,
  type FileSyncResult,
  type FileUploadResult,
  type FileDownloadResult,
  type ConflictResolution,
} from './DropboxSyncEngine';
export {
  ChatEngine,
  type ChatConversationData,
  type ChatMessageData,
  type CreateConversationInput,
} from './ChatEngine';
export {
  CopilotManager,
  type SendMessageOptions,
  type SendMessageResult,
} from './CopilotManager';


