import { sqliteTable, text, integer, real, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';

// Projects table - stores blog projects/websites
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description'),
  dataPath: text('data_path'), // Custom path for project data (null = default userData/projects/{id})
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(false),
});

// Posts table - stores metadata for blog posts
// Draft content is stored in the `content` column.
// Published content lives on the filesystem; `filePath` points to the .md file.
// When a post is published, `content` is cleared (moved to file).
// When a published post is edited, `content` holds draft changes and status becomes 'draft'.
export const posts = sqliteTable('posts', {
  projectId: text('project_id').notNull(),
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  slug: text('slug').notNull(),
  excerpt: text('excerpt'),
  content: text('content'), // Draft body text (null/empty when published — content is in the file)
  status: text('status', { enum: ['draft', 'published', 'archived'] }).notNull().default('draft'),
  author: text('author'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  publishedAt: integer('published_at', { mode: 'timestamp' }),
  filePath: text('file_path').notNull().default(''), // Empty for never-published drafts
  checksum: text('checksum'),
  tags: text('tags'), // JSON array stored as text
  categories: text('categories'), // JSON array stored as text
  templateSlug: text('template_slug'), // Optional user template override for this post
  // Legacy columns (kept for migration compatibility, no longer written)
  publishedTitle: text('published_title'),
  publishedContent: text('published_content'),
  publishedTags: text('published_tags'),
  publishedCategories: text('published_categories'),
  publishedExcerpt: text('published_excerpt'),
}, (table) => ({
  // Composite unique index: slug must be unique within each project
  projectSlugIdx: uniqueIndex('posts_project_slug_idx').on(table.projectId, table.slug),
}));

// Media table - stores metadata for images and other media
export const media = sqliteTable('media', {
  projectId: text('project_id').notNull(),
  id: text('id').primaryKey(),
  filename: text('filename').notNull(),
  originalName: text('original_name').notNull(),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  width: integer('width'),
  height: integer('height'),
  title: text('title'),
  alt: text('alt'),
  caption: text('caption'),
  author: text('author'),
  filePath: text('file_path').notNull(),
  sidecarPath: text('sidecar_path').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  checksum: text('checksum'),
  tags: text('tags'), // JSON array stored as text
});

// App settings - stores application configuration
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// Generated file hashes - tracks html/xml output content hashes to skip unchanged writes
export const generatedFileHashes = sqliteTable('generated_file_hashes', {
  projectId: text('project_id').notNull(),
  relativePath: text('relative_path').notNull(),
  contentHash: text('content_hash').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  projectPathIdx: uniqueIndex('generated_file_hashes_project_path_idx').on(table.projectId, table.relativePath),
}));

// Post links - tracks internal links between posts
export const postLinks = sqliteTable('post_links', {
  id: text('id').primaryKey(),
  sourcePostId: text('source_post_id').notNull(), // Post containing the link
  targetPostId: text('target_post_id').notNull(), // Post being linked to
  linkText: text('link_text'), // The text of the link
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// Post-Media links - tracks which media files are linked to which posts
export const postMedia = sqliteTable('post_media', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  postId: text('post_id').notNull(),
  mediaId: text('media_id').notNull(),
  sortOrder: integer('sort_order').notNull().default(0), // For ordering media within a post
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  // Composite unique index: a media can only be linked once to a post
  postMediaIdx: uniqueIndex('post_media_post_media_idx').on(table.postId, table.mediaId),
}));

// Tags table - stores tag metadata with optional colors
export const tags = sqliteTable('tags', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  name: text('name').notNull(),
  color: text('color'), // Optional hex color like #ff0000
  postTemplateSlug: text('post_template_slug'), // Optional user template override for posts with this tag
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  // Composite unique index: tag name must be unique within each project
  projectNameIdx: uniqueIndex('tags_project_name_idx').on(table.projectId, table.name),
}));

// Chat conversations table - stores AI chat sessions
export const chatConversations = sqliteTable('chat_conversations', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  model: text('model'), // Model used for this conversation
  copilotSessionId: text('copilot_session_id'), // Legacy, no longer used
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// Chat messages table - stores messages within conversations
export const chatMessages = sqliteTable('chat_messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  conversationId: text('conversation_id').notNull(),
  role: text('role', { enum: ['system', 'user', 'assistant', 'tool'] }).notNull(),
  content: text('content'),
  toolCallId: text('tool_call_id'), // For tool responses
  toolCalls: text('tool_calls'), // JSON array of tool calls
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// Import definitions table - stores WXR import configurations
export const importDefinitions = sqliteTable('import_definitions', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  name: text('name').notNull(),
  wxrFilePath: text('wxr_file_path'),
  uploadsFolderPath: text('uploads_folder_path'),
  lastAnalysisResult: text('last_analysis_result'), // JSON text of ImportAnalysisReport
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// Scripts table - stores metadata for Python scripts persisted in scripts/*.py
export const scripts = sqliteTable('scripts', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  kind: text('kind', { enum: ['macro', 'utility', 'transform'] }).notNull().default('utility'),
  entrypoint: text('entrypoint').notNull().default('render'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  version: integer('version').notNull().default(1),
  filePath: text('file_path').notNull(),
  // Draft lifecycle columns (added in 0007)
  status: text('status', { enum: ['draft', 'published'] }).notNull().default('published'),
  content: text('content'), // draft body; NULL when on-disk (published)
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  // Composite unique index: slug must be unique within each project
  projectSlugIdx: uniqueIndex('scripts_project_slug_idx').on(table.projectId, table.slug),
}));

// Templates table - stores metadata for Liquid templates persisted in templates/*.liquid
export const templates = sqliteTable('templates', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  kind: text('kind', { enum: ['post', 'list', 'not-found', 'partial'] }).notNull().default('post'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  version: integer('version').notNull().default(1),
  filePath: text('file_path').notNull(),
  // Draft lifecycle columns (added in 0007)
  status: text('status', { enum: ['draft', 'published'] }).notNull().default('published'),
  content: text('content'), // draft body; NULL when on-disk (published)
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  // Composite unique index: slug must be unique within each project
  projectSlugIdx: uniqueIndex('templates_project_slug_idx').on(table.projectId, table.slug),
}));

// DB notifications table - CLI writes a row after every mutation; app's NotificationWatcher
// queries for seenAt IS NULL AND fromCli = 1, invalidates engine caches, emits IPC events.
export const dbNotifications = sqliteTable('db_notifications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  entity: text('entity').notNull(), // 'post' | 'media' | 'script' | 'template'
  entityId: text('entity_id').notNull(),
  action: text('action').notNull(), // 'created' | 'updated' | 'deleted'
  fromCli: integer('from_cli').notNull().default(1), // 1 = written by CLI; reserved for future app→CLI
  seenAt: integer('seen_at'), // NULL = unprocessed by app
  createdAt: integer('created_at').notNull(),
});

// ── Model Catalog ──
// Normalised tables from models.dev API.
// Refreshed on user action via conditional GET (ETag). Survives offline use.

// Provider table — one row per models.dev top-level provider
export const modelCatalogProviders = sqliteTable('ai_providers', {
  id: text('id').primaryKey(),                  // provider key (e.g. 'opencode', 'mistral')
  name: text('name').notNull(),                 // display name (e.g. 'OpenCode Zen')
  env: text('env'),                             // JSON array of env var names
  npm: text('npm'),                             // primary npm package
  api: text('api'),                             // API base URL
  doc: text('doc'),                             // documentation URL
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// Model table — one row per (provider, modelId) pair
export const modelCatalog = sqliteTable('ai_models', {
  provider: text('provider').notNull(),         // FK → ai_providers.id
  modelId: text('model_id').notNull(),
  name: text('name').notNull(),                 // display name (e.g. 'Claude Sonnet 4.5')
  family: text('family'),                       // model family (e.g. 'claude-sonnet')
  attachment: integer('attachment', { mode: 'boolean' }).default(false),
  reasoning: integer('reasoning', { mode: 'boolean' }).default(false),
  toolCall: integer('tool_call', { mode: 'boolean' }).default(false),
  structuredOutput: integer('structured_output', { mode: 'boolean' }).default(false),
  temperature: integer('temperature', { mode: 'boolean' }).default(false),
  knowledge: text('knowledge'),                 // knowledge cutoff (e.g. '2025-03-31')
  releaseDate: text('release_date'),
  lastUpdatedDate: text('last_updated_date'),
  openWeights: integer('open_weights', { mode: 'boolean' }).default(false),
  inputPrice: real('input_price'),              // USD per 1M input tokens
  outputPrice: real('output_price'),            // USD per 1M output tokens
  cacheReadPrice: real('cache_read_price'),
  cacheWritePrice: real('cache_write_price'),
  contextWindow: integer('context_window'),     // max context tokens
  maxInputTokens: integer('max_input_tokens'),
  maxOutputTokens: integer('max_output_tokens'),
  interleaved: text('interleaved'),             // JSON object (e.g. '{"field":"reasoning_content"}')
  status: text('status'),                       // e.g. 'deprecated'
  providerNpm: text('provider_npm'),            // per-model npm override
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.provider, table.modelId] }),
}));

// Modality junction table — each row is one (direction, modality) tag for a model
// e.g. ('opencode', 'claude-sonnet-4', 'input', 'image')
export const modelCatalogModalities = sqliteTable('ai_model_modalities', {
  provider: text('provider').notNull(),
  modelId: text('model_id').notNull(),
  direction: text('direction').notNull(),       // 'input' | 'output'
  modality: text('modality').notNull(),         // 'text' | 'image' | 'pdf' | 'audio' | 'video'
}, (table) => ({
  pk: primaryKey({ columns: [table.provider, table.modelId, table.direction, table.modality] }),
}));

// HTTP cache metadata (ETag for conditional GET)
export const modelCatalogMeta = sqliteTable('ai_catalog_meta', {
  key: text('key').primaryKey(), // 'etag' | 'lastFetchedAt'
  value: text('value').notNull(),
});

// Types for TypeScript
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;
export type Media = typeof media.$inferSelect;
export type NewMedia = typeof media.$inferInsert;
export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;
export type GeneratedFileHash = typeof generatedFileHashes.$inferSelect;
export type NewGeneratedFileHash = typeof generatedFileHashes.$inferInsert;
export type PostLink = typeof postLinks.$inferSelect;
export type NewPostLink = typeof postLinks.$inferInsert;
export type PostMediaLink = typeof postMedia.$inferSelect;
export type NewPostMediaLink = typeof postMedia.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
export type ChatConversation = typeof chatConversations.$inferSelect;
export type NewChatConversation = typeof chatConversations.$inferInsert;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;
export type ImportDefinition = typeof importDefinitions.$inferSelect;
export type NewImportDefinition = typeof importDefinitions.$inferInsert;
export type Script = typeof scripts.$inferSelect;
export type NewScript = typeof scripts.$inferInsert;
export type Template = typeof templates.$inferSelect;
export type NewTemplate = typeof templates.$inferInsert;
export type DbNotification = typeof dbNotifications.$inferSelect;
export type NewDbNotification = typeof dbNotifications.$inferInsert;
export type ModelCatalogProviderEntry = typeof modelCatalogProviders.$inferSelect;
export type NewModelCatalogProviderEntry = typeof modelCatalogProviders.$inferInsert;
export type ModelCatalogEntry = typeof modelCatalog.$inferSelect;
export type NewModelCatalogEntry = typeof modelCatalog.$inferInsert;
export type ModelCatalogModalityEntry = typeof modelCatalogModalities.$inferSelect;
export type NewModelCatalogModalityEntry = typeof modelCatalogModalities.$inferInsert;
export type ModelCatalogMetaEntry = typeof modelCatalogMeta.$inferSelect;
export type NewModelCatalogMetaEntry = typeof modelCatalogMeta.$inferInsert;
