import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';

// Projects table - stores blog projects/websites
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description'),
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
  syncStatus: text('sync_status', { enum: ['pending', 'synced', 'conflict'] }).notNull().default('pending'),
  syncedAt: integer('synced_at', { mode: 'timestamp' }),
  checksum: text('checksum'),
  tags: text('tags'), // JSON array stored as text
  categories: text('categories'), // JSON array stored as text
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
  alt: text('alt'),
  caption: text('caption'),
  filePath: text('file_path').notNull(),
  sidecarPath: text('sidecar_path').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  syncStatus: text('sync_status', { enum: ['pending', 'synced', 'conflict'] }).notNull().default('pending'),
  syncedAt: integer('synced_at', { mode: 'timestamp' }),
  checksum: text('checksum'),
  tags: text('tags'), // JSON array stored as text
});

// Sync log - tracks sync operations
export const syncLog = sqliteTable('sync_log', {
  id: text('id').primaryKey(),
  entityType: text('entity_type', { enum: ['post', 'media'] }).notNull(),
  entityId: text('entity_id').notNull(),
  operation: text('operation', { enum: ['create', 'update', 'delete'] }).notNull(),
  status: text('status', { enum: ['pending', 'completed', 'failed'] }).notNull().default('pending'),
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull(),
  errorMessage: text('error_message'),
  retryCount: integer('retry_count').notNull().default(0),
});

// App settings - stores application configuration
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// Post links - tracks internal links between posts
export const postLinks = sqliteTable('post_links', {
  id: text('id').primaryKey(),
  sourcePostId: text('source_post_id').notNull(), // Post containing the link
  targetPostId: text('target_post_id').notNull(), // Post being linked to
  linkText: text('link_text'), // The text of the link
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// Tags table - stores tag metadata with optional colors
export const tags = sqliteTable('tags', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  name: text('name').notNull(),
  color: text('color'), // Optional hex color like #ff0000
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  // Composite unique index: tag name must be unique within each project
  projectNameIdx: uniqueIndex('tags_project_name_idx').on(table.projectId, table.name),
}));

// Types for TypeScript
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;
export type Media = typeof media.$inferSelect;
export type NewMedia = typeof media.$inferInsert;
export type SyncLogEntry = typeof syncLog.$inferSelect;
export type NewSyncLogEntry = typeof syncLog.$inferInsert;
export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;
export type PostLink = typeof postLinks.$inferSelect;
export type NewPostLink = typeof postLinks.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
