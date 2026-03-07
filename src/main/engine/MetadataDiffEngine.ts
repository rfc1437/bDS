/**
 * MetadataDiffEngine
 *
 * Compares metadata between database records and filesystem files for posts and media.
 * Used to detect and resolve differences that may have accumulated due to bugs or
 * manual edits.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { eq, and } from 'drizzle-orm';
import { getDatabase } from '../database';
import { posts, postTranslations, media, scripts, templates } from '../database/schema';
import { readPostFile, PostFileData } from './postFileUtils';
import { readPostTranslationFile } from './postTranslationFileUtils';
import { taskManager } from './TaskManager';
import type { PostEngine } from './PostEngine';
import type { MediaEngine } from './MediaEngine';
import type { ScriptEngine } from './ScriptEngine';
import type { TemplateEngine } from './TemplateEngine';

/**
 * A difference in a specific metadata field
 */
export interface FieldDifference<T = unknown> {
  dbValue: T;
  fileValue: T;
}

// ── Post diff types ──

/**
 * The fields that can have differences for posts
 */
export type DiffField = 'tags' | 'categories' | 'title' | 'excerpt' | 'author' | 'language' | 'translationFor';

/**
 * Metadata differences for a single post
 */
export interface PostMetadataDiff {
  postId: string;
  title: string;
  slug: string;
  variant?: 'post' | 'translation';
  translationLanguage?: string;
  filePath?: string;
  hasDifferences: boolean;
  fileMissing?: boolean;
  differences: Partial<Record<DiffField, FieldDifference>>;
}

/**
 * A group of posts with the same type of difference
 */
export interface DiffGroup {
  field: DiffField;
  label: string;
  posts: Array<{
    postId: string;
    title: string;
    slug: string;
    dbValue: unknown;
    fileValue: unknown;
  }>;
}

/**
 * A file on disk that has no matching database entry
 */
export interface OrphanFile {
  filePath: string;
  slug: string;
  title?: string;
  id?: string;
  variant?: 'post' | 'translation';
  translationFor?: string;
  language?: string;
}

/**
 * Result of scanning all published posts
 */
export interface ScanResult {
  totalScanned: number;
  postsWithDifferences: number;
  differences: PostMetadataDiff[];
  groups: DiffGroup[];
  orphanFiles: OrphanFile[];
}

// ── Media diff types ──

export type MediaDiffField = 'title' | 'alt' | 'caption' | 'author' | 'tags';

export interface MediaMetadataDiff {
  mediaId: string;
  originalName: string;
  filePath?: string;
  hasDifferences: boolean;
  fileMissing?: boolean;
  differences: Partial<Record<MediaDiffField, FieldDifference>>;
}

export interface MediaDiffGroup {
  field: MediaDiffField;
  label: string;
  items: Array<{
    mediaId: string;
    originalName: string;
    dbValue: unknown;
    fileValue: unknown;
  }>;
}

export interface MediaScanResult {
  totalScanned: number;
  itemsWithDifferences: number;
  differences: MediaMetadataDiff[];
  groups: MediaDiffGroup[];
}

// ── Script diff types ──

export type ScriptDiffField = 'title' | 'kind' | 'entrypoint' | 'enabled' | 'version';

export interface ScriptMetadataDiff {
  scriptId: string;
  title: string;
  slug: string;
  filePath?: string;
  hasDifferences: boolean;
  fileMissing?: boolean;
  differences: Partial<Record<ScriptDiffField, FieldDifference>>;
}

export interface ScriptDiffGroup {
  field: ScriptDiffField;
  label: string;
  items: Array<{
    scriptId: string;
    title: string;
    slug: string;
    dbValue: unknown;
    fileValue: unknown;
  }>;
}

export interface ScriptScanResult {
  totalScanned: number;
  itemsWithDifferences: number;
  differences: ScriptMetadataDiff[];
  groups: ScriptDiffGroup[];
}

// ── Template diff types ──

export type TemplateDiffField = 'title' | 'kind' | 'enabled' | 'version';

export interface TemplateMetadataDiff {
  templateId: string;
  title: string;
  slug: string;
  filePath?: string;
  hasDifferences: boolean;
  fileMissing?: boolean;
  differences: Partial<Record<TemplateDiffField, FieldDifference>>;
}

export interface TemplateDiffGroup {
  field: TemplateDiffField;
  label: string;
  items: Array<{
    templateId: string;
    title: string;
    slug: string;
    dbValue: unknown;
    fileValue: unknown;
  }>;
}

export interface TemplateScanResult {
  totalScanned: number;
  itemsWithDifferences: number;
  differences: TemplateMetadataDiff[];
  groups: TemplateDiffGroup[];
}

// ── Combined types ──

/**
 * Statistics about posts/media/scripts/templates tables
 */
export interface TableStats {
  totalPosts: number;
  publishedPosts: number;
  draftPosts: number;
  totalMedia: number;
  totalScripts: number;
  publishedScripts: number;
  totalTemplates: number;
  publishedTemplates: number;
}

/**
 * Entity type for generic operations
 */
export type EntityType = 'post' | 'media' | 'script' | 'template';

export class MetadataDiffEngine extends EventEmitter {
  private currentProjectId = 'default';

  constructor(
    private readonly postEngine?: PostEngine,
    private readonly mediaEngine?: MediaEngine,
    private readonly scriptEngine?: ScriptEngine,
    private readonly templateEngine?: TemplateEngine,
  ) {
    super();
  }

  private async runSyncLoop(
    postIds: string[],
    onProgress: ((percent: number, message: string) => void) | undefined,
    processPost: (postId: string) => Promise<boolean>,
    errorMessage: (postId: string) => string
  ): Promise<{ success: number; failed: number }> {
    const total = postIds.length;
    let success = 0;
    let failed = 0;

    for (let i = 0; i < postIds.length; i++) {
      const postId = postIds[i];
      try {
        const processed = await processPost(postId);
        if (processed) {
          success++;
        } else {
          failed++;
        }
      } catch (error) {
        console.error(errorMessage(postId), error);
        failed++;
      }

      // Report progress every 10 posts or on last post
      if (onProgress && (i % 10 === 0 || i === postIds.length - 1)) {
        const percent = Math.round(((i + 1) / total) * 100);
        onProgress(percent, `Synced ${i + 1} of ${total} posts...`);
      }

      // Yield to event loop every 20 posts
      if (i % 20 === 0) {
        await new Promise(resolve => setImmediate(resolve));
      }
    }

    return { success, failed };
  }

  setProjectContext(projectId: string): void {
    this.currentProjectId = projectId;
  }

  getProjectContext(): string {
    return this.currentProjectId;
  }

  private getDb() {
    return getDatabase().getLocal();
  }

  private getClient() {
    return getDatabase().getLocalClient();
  }

  /**
   * Get statistics about the posts, media, scripts, and templates tables
   */
  async getTableStats(): Promise<TableStats> {
    const db = this.getDb();
    const client = this.getClient();
    if (!client) throw new Error('Database not initialized');

    // Get post counts
    const allPostsResult = await client.execute({
      sql: `SELECT COUNT(*) as count FROM posts WHERE project_id = ?`,
      args: [this.currentProjectId],
    });
    const totalPosts = Number(allPostsResult.rows[0]?.count ?? 0);

    const publishedResult = await client.execute({
      sql: `SELECT COUNT(*) as count FROM posts WHERE project_id = ? AND status = 'published' AND file_path IS NOT NULL AND file_path != ''`,
      args: [this.currentProjectId],
    });
    const publishedPosts = Number(publishedResult.rows[0]?.count ?? 0);

    const draftResult = await client.execute({
      sql: `SELECT COUNT(*) as count FROM posts WHERE project_id = ? AND status = 'draft'`,
      args: [this.currentProjectId],
    });
    const draftPosts = Number(draftResult.rows[0]?.count ?? 0);

    // Get media count
    const mediaResult = await client.execute({
      sql: `SELECT COUNT(*) as count FROM media WHERE project_id = ?`,
      args: [this.currentProjectId],
    });
    const totalMedia = Number(mediaResult.rows[0]?.count ?? 0);

    // Get script counts
    const allScriptsResult = await client.execute({
      sql: `SELECT COUNT(*) as count FROM scripts WHERE project_id = ?`,
      args: [this.currentProjectId],
    });
    const totalScripts = Number(allScriptsResult.rows[0]?.count ?? 0);

    const publishedScriptsResult = await client.execute({
      sql: `SELECT COUNT(*) as count FROM scripts WHERE project_id = ? AND status = 'published'`,
      args: [this.currentProjectId],
    });
    const publishedScripts = Number(publishedScriptsResult.rows[0]?.count ?? 0);

    // Get template counts
    const allTemplatesResult = await client.execute({
      sql: `SELECT COUNT(*) as count FROM templates WHERE project_id = ?`,
      args: [this.currentProjectId],
    });
    const totalTemplates = Number(allTemplatesResult.rows[0]?.count ?? 0);

    const publishedTemplatesResult = await client.execute({
      sql: `SELECT COUNT(*) as count FROM templates WHERE project_id = ? AND status = 'published'`,
      args: [this.currentProjectId],
    });
    const publishedTemplates = Number(publishedTemplatesResult.rows[0]?.count ?? 0);

    return {
      totalPosts,
      publishedPosts,
      draftPosts,
      totalMedia,
      totalScripts,
      publishedScripts,
      totalTemplates,
      publishedTemplates,
    };
  }

  /**
   * Compare metadata for a single post between database and file
   */
  async comparePostMetadata(postId: string): Promise<PostMetadataDiff | null> {
    const db = this.getDb();

    // Get post from database
    const dbPost = await db
      .select()
      .from(posts)
      .where(and(eq(posts.id, postId), eq(posts.projectId, this.currentProjectId)))
      .get();

    if (!dbPost) {
      const dbTranslation = await db
        .select()
        .from(postTranslations)
        .where(and(eq(postTranslations.id, postId), eq(postTranslations.projectId, this.currentProjectId)))
        .get();

      if (!dbTranslation) {
        return null;
      }

      if (!dbTranslation.filePath || dbTranslation.status === 'draft') {
        return null;
      }

      const sourcePost = await db
        .select()
        .from(posts)
        .where(and(eq(posts.id, dbTranslation.translationFor), eq(posts.projectId, this.currentProjectId)))
        .get();

      const translationSlug = sourcePost?.slug
        ? `${sourcePost.slug}.${dbTranslation.language}`
        : path.basename(dbTranslation.filePath, path.extname(dbTranslation.filePath));
      const translationTitle = `${dbTranslation.title} [${dbTranslation.language}]`;
      const translationFileData = await readPostTranslationFile(dbTranslation.filePath);

      if (!translationFileData) {
        const missingDiffs: Partial<Record<DiffField, FieldDifference>> = {
          translationFor: { dbValue: dbTranslation.translationFor, fileValue: null },
          language: { dbValue: dbTranslation.language, fileValue: null },
          title: { dbValue: dbTranslation.title, fileValue: null },
        };
        if (dbTranslation.excerpt) {
          missingDiffs.excerpt = { dbValue: dbTranslation.excerpt, fileValue: null };
        }

        return {
          postId: dbTranslation.id,
          title: translationTitle,
          slug: translationSlug,
          variant: 'translation',
          translationLanguage: dbTranslation.language,
          filePath: dbTranslation.filePath,
          hasDifferences: true,
          fileMissing: true,
          differences: missingDiffs,
        };
      }

      const translationDiffs: Partial<Record<DiffField, FieldDifference>> = {};

      if (dbTranslation.translationFor !== translationFileData.translationFor) {
        translationDiffs.translationFor = { dbValue: dbTranslation.translationFor, fileValue: translationFileData.translationFor };
      }
      if (dbTranslation.language !== translationFileData.language) {
        translationDiffs.language = { dbValue: dbTranslation.language, fileValue: translationFileData.language };
      }
      if (dbTranslation.title !== translationFileData.title) {
        translationDiffs.title = { dbValue: dbTranslation.title, fileValue: translationFileData.title };
      }
      if ((dbTranslation.excerpt || '') !== (translationFileData.excerpt || '')) {
        translationDiffs.excerpt = { dbValue: dbTranslation.excerpt || '', fileValue: translationFileData.excerpt || '' };
      }

      return {
        postId: dbTranslation.id,
        title: translationTitle,
        slug: translationSlug,
        variant: 'translation',
        translationLanguage: dbTranslation.language,
        filePath: dbTranslation.filePath,
        hasDifferences: Object.keys(translationDiffs).length > 0,
        differences: translationDiffs,
      };
    }

    // Skip drafts - they don't have files
    if (!dbPost.filePath || dbPost.status === 'draft') {
      return null;
    }

    // Read file metadata
    const fileData = await readPostFile(dbPost.filePath);
    if (!fileData) {
      // File doesn't exist or can't be read — show DB values so the UI isn't empty
      const missingDiffs: Partial<Record<DiffField, FieldDifference>> = {};
      const dbTags: string[] = JSON.parse(dbPost.tags || '[]');
      const dbCategories: string[] = JSON.parse(dbPost.categories || '[]');
      if (dbPost.title) missingDiffs.title = { dbValue: dbPost.title, fileValue: null };
      if (dbTags.length > 0) missingDiffs.tags = { dbValue: dbTags, fileValue: null };
      if (dbCategories.length > 0) missingDiffs.categories = { dbValue: dbCategories, fileValue: null };
      if (dbPost.excerpt) missingDiffs.excerpt = { dbValue: dbPost.excerpt, fileValue: null };
      if (dbPost.author) missingDiffs.author = { dbValue: dbPost.author, fileValue: null };
      if (dbPost.language) missingDiffs.language = { dbValue: dbPost.language, fileValue: null };
      return {
        postId: dbPost.id,
        title: dbPost.title,
        slug: dbPost.slug,
        filePath: dbPost.filePath,
        hasDifferences: true,
        fileMissing: true,
        differences: missingDiffs,
      };
    }

    // Compare fields
    const differences: Partial<Record<DiffField, FieldDifference>> = {};

    // Parse JSON arrays from database
    const dbTags: string[] = JSON.parse(dbPost.tags || '[]');
    const dbCategories: string[] = JSON.parse(dbPost.categories || '[]');
    const fileTags = fileData.tags || [];
    const fileCategories = fileData.categories || [];

    // Compare tags (order-independent)
    if (!this.arraysEqual(dbTags, fileTags)) {
      differences.tags = { dbValue: dbTags, fileValue: fileTags };
    }

    // Compare categories (order-independent)
    if (!this.arraysEqual(dbCategories, fileCategories)) {
      differences.categories = { dbValue: dbCategories, fileValue: fileCategories };
    }

    // Compare title
    if (dbPost.title !== fileData.title) {
      differences.title = { dbValue: dbPost.title, fileValue: fileData.title };
    }

    // Compare excerpt
    if ((dbPost.excerpt || '') !== (fileData.excerpt || '')) {
      differences.excerpt = { dbValue: dbPost.excerpt || '', fileValue: fileData.excerpt || '' };
    }

    // Compare author
    if ((dbPost.author || '') !== (fileData.author || '')) {
      differences.author = { dbValue: dbPost.author || '', fileValue: fileData.author || '' };
    }

    // Compare language
    if ((dbPost.language || '') !== (fileData.language || '')) {
      differences.language = { dbValue: dbPost.language || '', fileValue: fileData.language || '' };
    }

    return {
      postId: dbPost.id,
      title: dbPost.title,
      slug: dbPost.slug,
      filePath: dbPost.filePath,
      hasDifferences: Object.keys(differences).length > 0,
      differences,
    };
  }

  /**
   * Compare arrays for equality (order-independent)
   */
  private arraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const sortedA = [...a].sort();
    const sortedB = [...b].sort();
    return sortedA.every((val, idx) => val === sortedB[idx]);
  }

  /**
   * Scan all published posts and find metadata differences.
   * When postsBaseDir is provided, also scans the filesystem to detect
   * orphan files that exist on disk but have no matching database entry.
   */
  async scanAllPublishedPosts(
    onProgress: (current: number, total: number, message: string) => void,
    postsBaseDir?: string,
  ): Promise<ScanResult> {
    const client = this.getClient();
    if (!client) throw new Error('Database not initialized');

    // Get all published posts with file paths
    const result = await client.execute({
      sql: `SELECT id, title, slug, file_path, tags, categories, excerpt, author, language 
            FROM posts 
            WHERE project_id = ? 
              AND status = 'published' 
              AND file_path IS NOT NULL 
              AND file_path != ''`,
      args: [this.currentProjectId],
    });

    const translationResult = await client.execute({
      sql: `SELECT id, translation_for, language, title, excerpt, file_path
            FROM post_translations
            WHERE project_id = ?
              AND status = 'published'
              AND file_path IS NOT NULL
              AND file_path != ''`,
      args: [this.currentProjectId],
    });

    const publishedPosts = result.rows;
    const publishedTranslations = translationResult.rows;
    const total = publishedPosts.length + publishedTranslations.length;
    const differences: PostMetadataDiff[] = [];

    onProgress(0, total, `Scanning ${total} published posts...`);

    // Collect known DB file paths for orphan detection
    const knownFilePaths = new Set<string>();

    for (let i = 0; i < publishedPosts.length; i++) {
      const row = publishedPosts[i];
      const postId = row.id as string;
      const filePath = row.file_path as string;
      if (filePath) knownFilePaths.add(filePath);

      const diff = await this.comparePostMetadata(postId);
      if (diff && diff.hasDifferences) {
        differences.push(diff);
      }

      if ((i + 1) % 10 === 0 || i === total - 1) {
        onProgress(i + 1, total, `Scanned ${i + 1}/${total} posts, found ${differences.length} with differences`);
      }
    }

    for (let i = 0; i < publishedTranslations.length; i++) {
      const row = publishedTranslations[i];
      const translationId = row.id as string;
      const filePath = row.file_path as string;
      if (filePath) knownFilePaths.add(filePath);

      const diff = await this.comparePostMetadata(translationId);
      if (diff && diff.hasDifferences) {
        differences.push(diff);
      }

      const processed = publishedPosts.length + i + 1;
      if (processed % 10 === 0 || processed === total) {
        onProgress(processed, total, `Scanned ${processed}/${total} posts, found ${differences.length} with differences`);
      }
    }

    // Also include file_paths from non-published posts so we don't flag them as orphans
    const allPostsResult = await client.execute({
      sql: `SELECT file_path FROM posts WHERE project_id = ? AND file_path IS NOT NULL AND file_path != ''`,
      args: [this.currentProjectId],
    });
    for (const row of allPostsResult.rows) {
      knownFilePaths.add(row.file_path as string);
    }

    const allTranslationsResult = await client.execute({
      sql: `SELECT file_path FROM post_translations WHERE project_id = ? AND file_path IS NOT NULL AND file_path != ''`,
      args: [this.currentProjectId],
    });
    for (const row of allTranslationsResult.rows) {
      knownFilePaths.add(row.file_path as string);
    }

    // Scan filesystem for orphan files
    const orphanFiles = await this.findOrphanFiles(postsBaseDir, knownFilePaths, onProgress, total);

    // Group the differences
    const groups = this.groupDifferencesByField(differences);

    return {
      totalScanned: total,
      postsWithDifferences: differences.length,
      differences,
      groups,
      orphanFiles,
    };
  }

  /**
   * Recursively scan the posts directory for markdown files not present in the database.
   */
  private async findOrphanFiles(
    postsBaseDir: string | undefined,
    knownFilePaths: Set<string>,
    onProgress: (current: number, total: number, message: string) => void,
    scannedSoFar: number,
  ): Promise<OrphanFile[]> {
    if (!postsBaseDir) return [];

    const markdownExtensions = new Set(['.md', '.markdown', '.mdx']);
    const allFiles: string[] = [];

    const scanDir = async (dir: string) => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await scanDir(fullPath);
          } else {
            const extension = path.extname(entry.name).toLowerCase();
            if (markdownExtensions.has(extension)) {
              allFiles.push(fullPath);
            }
          }
        }
      } catch {
        // Directory might not exist
      }
    };

    onProgress(scannedSoFar, scannedSoFar + 1, 'Scanning filesystem for orphan files...');
    await scanDir(postsBaseDir);

    // Filter to files not in the known DB set
    const orphanPaths = allFiles.filter(f => !knownFilePaths.has(f));

    if (orphanPaths.length === 0) return [];

    const orphanFiles: OrphanFile[] = [];
    for (let i = 0; i < orphanPaths.length; i++) {
      const filePath = orphanPaths[i];
      const slug = path.basename(filePath, path.extname(filePath));
      let title: string | undefined;
      let id: string | undefined;
      let variant: 'post' | 'translation' | undefined;
      let translationFor: string | undefined;
      let language: string | undefined;

      // Try to read frontmatter for metadata
      try {
        const translationData = await readPostTranslationFile(filePath);
        if (translationData) {
          title = translationData.title;
          variant = 'translation';
          translationFor = translationData.translationFor;
          language = translationData.language;
        } else {
          const fileData = await readPostFile(filePath);
          if (fileData) {
            title = fileData.title;
            id = fileData.id;
            variant = 'post';
          }
        }
      } catch {
        // Couldn't parse file, still report it as orphan
      }

      orphanFiles.push({ filePath, slug, title, id, variant, translationFor, language });

      if ((i + 1) % 10 === 0 || i === orphanPaths.length - 1) {
        onProgress(scannedSoFar + i + 1, scannedSoFar + orphanPaths.length,
          `Found ${orphanFiles.length} orphan files (${i + 1}/${orphanPaths.length})`);
      }
    }

    return orphanFiles;
  }

  /**
   * Group differences by field type for easier display and bulk actions
   */
  groupDifferencesByField(diffs: PostMetadataDiff[]): DiffGroup[] {
    const groupMap = new Map<DiffField, DiffGroup>();

    const fieldLabels: Record<DiffField, string> = {
      tags: 'Tags',
      categories: 'Categories',
      title: 'Title',
      excerpt: 'Excerpt',
      author: 'Author',
      language: 'Language',
      translationFor: 'Translation Source',
    };

    for (const diff of diffs) {
      for (const [field, fieldDiff] of Object.entries(diff.differences)) {
        const fieldKey = field as DiffField;
        if (!fieldDiff) continue;

        if (!groupMap.has(fieldKey)) {
          groupMap.set(fieldKey, {
            field: fieldKey,
            label: fieldLabels[fieldKey],
            posts: [],
          });
        }

        groupMap.get(fieldKey)!.posts.push({
          postId: diff.postId,
          title: diff.title,
          slug: diff.slug,
          dbValue: fieldDiff.dbValue,
          fileValue: fieldDiff.fileValue,
        });
      }
    }

    return Array.from(groupMap.values()).sort((a, b) => b.posts.length - a.posts.length);
  }

  /**
   * Sync database metadata to files for the given posts
   * (DB -> File: writes current DB metadata to markdown files)
   */
  async syncDbToFile(
    postIds: string[],
    onProgress?: (percent: number, message: string) => void
  ): Promise<{ success: number; failed: number }> {
    const postEngine = this.postEngine;
    if (!postEngine) throw new Error('MetadataDiffEngine: postEngine not injected');
    return this.runSyncLoop(
      postIds,
      onProgress,
      async (postId) => {
        const syncedPost = await postEngine.syncPublishedPostFile(postId);
        if (syncedPost) {
          return true;
        }
        if (typeof postEngine.syncPublishedPostTranslationFile === 'function') {
          return postEngine.syncPublishedPostTranslationFile(postId);
        }
        return false;
      },
      (postId) => `[MetadataDiffEngine] Failed to sync post ${postId} to file:`
    );
  }

  /**
   * Sync file metadata to database for the given posts
   * (File -> DB: reads file metadata and updates DB)
   */
  async syncFileToDb(
    postIds: string[],
    field?: DiffField,
    onProgress?: (percent: number, message: string) => void
  ): Promise<{ success: number; failed: number }> {
    const db = this.getDb();
    return this.runSyncLoop(
      postIds,
      onProgress,
      async (postId) => {
        // Get the post from DB to get file path
        const dbPost = await db
          .select()
          .from(posts)
          .where(and(eq(posts.id, postId), eq(posts.projectId, this.currentProjectId)))
          .get();

        if (dbPost?.filePath) {
          const fileData = await readPostFile(dbPost.filePath);
          if (!fileData) {
            return false;
          }

          const updateData: Record<string, unknown> = {
            updatedAt: new Date(),
          };

          if (!field || field === 'tags') {
            updateData.tags = JSON.stringify(fileData.tags || []);
          }
          if (!field || field === 'categories') {
            updateData.categories = JSON.stringify(fileData.categories || []);
          }
          if (!field || field === 'title') {
            updateData.title = fileData.title;
          }
          if (!field || field === 'excerpt') {
            updateData.excerpt = fileData.excerpt || null;
          }
          if (!field || field === 'author') {
            updateData.author = fileData.author || null;
          }
          if (!field || field === 'language') {
            updateData.language = fileData.language || null;
          }

          await db
            .update(posts)
            .set(updateData)
            .where(eq(posts.id, postId));

          return true;
        }

        const dbTranslation = await db
          .select()
          .from(postTranslations)
          .where(and(eq(postTranslations.id, postId), eq(postTranslations.projectId, this.currentProjectId)))
          .get();

        if (!dbTranslation?.filePath) {
          return false;
        }

        const translationFileData = await readPostTranslationFile(dbTranslation.filePath);
        if (!translationFileData) {
          return false;
        }

        const translationUpdateData: Record<string, unknown> = {
          updatedAt: new Date(),
        };

        if (!field || field === 'translationFor') {
          translationUpdateData.translationFor = translationFileData.translationFor;
        }
        if (!field || field === 'language') {
          translationUpdateData.language = translationFileData.language || null;
        }
        if (!field || field === 'title') {
          translationUpdateData.title = translationFileData.title;
        }
        if (!field || field === 'excerpt') {
          translationUpdateData.excerpt = translationFileData.excerpt || null;
        }

        await db
          .update(postTranslations)
          .set(translationUpdateData)
          .where(eq(postTranslations.id, postId));

        return true;
      },
      (postId) => `[MetadataDiffEngine] Failed to sync post ${postId} to DB:`
    );
  }

  // ── Media comparison ──

  /**
   * Compare metadata for a single media item between database and sidecar file
   */
  async compareMediaMetadata(mediaId: string): Promise<MediaMetadataDiff | null> {
    const db = this.getDb();
    if (!this.mediaEngine) throw new Error('MetadataDiffEngine: mediaEngine not injected');

    const dbMedia = await db
      .select()
      .from(media)
      .where(and(eq(media.id, mediaId), eq(media.projectId, this.currentProjectId)))
      .get();

    if (!dbMedia) return null;

    const sidecarPath = `${dbMedia.filePath}.meta`;
    const sidecar = await this.mediaEngine.readSidecarFile(sidecarPath);
    if (!sidecar) {
      const missingDiffs: Partial<Record<MediaDiffField, FieldDifference>> = {};
      if (dbMedia.title) missingDiffs.title = { dbValue: dbMedia.title, fileValue: null };
      if (dbMedia.alt) missingDiffs.alt = { dbValue: dbMedia.alt, fileValue: null };
      if (dbMedia.caption) missingDiffs.caption = { dbValue: dbMedia.caption, fileValue: null };
      if (dbMedia.author) missingDiffs.author = { dbValue: dbMedia.author, fileValue: null };
      const dbTags: string[] = JSON.parse(dbMedia.tags || '[]');
      if (dbTags.length > 0) missingDiffs.tags = { dbValue: dbTags, fileValue: null };
      return {
        mediaId: dbMedia.id,
        originalName: dbMedia.originalName,
        filePath: dbMedia.filePath,
        hasDifferences: true,
        fileMissing: true,
        differences: missingDiffs,
      };
    }

    const differences: Partial<Record<MediaDiffField, FieldDifference>> = {};

    if ((dbMedia.title || '') !== (sidecar.title || '')) {
      differences.title = { dbValue: dbMedia.title || '', fileValue: sidecar.title || '' };
    }
    if ((dbMedia.alt || '') !== (sidecar.alt || '')) {
      differences.alt = { dbValue: dbMedia.alt || '', fileValue: sidecar.alt || '' };
    }
    if ((dbMedia.caption || '') !== (sidecar.caption || '')) {
      differences.caption = { dbValue: dbMedia.caption || '', fileValue: sidecar.caption || '' };
    }
    if ((dbMedia.author || '') !== (sidecar.author || '')) {
      differences.author = { dbValue: dbMedia.author || '', fileValue: sidecar.author || '' };
    }

    const dbTags: string[] = JSON.parse(dbMedia.tags || '[]');
    const sidecarTags = sidecar.tags || [];
    if (!this.arraysEqual(dbTags, sidecarTags)) {
      differences.tags = { dbValue: dbTags, fileValue: sidecarTags };
    }

    return {
      mediaId: dbMedia.id,
      originalName: dbMedia.originalName,
      filePath: dbMedia.filePath,
      hasDifferences: Object.keys(differences).length > 0,
      differences,
    };
  }

  /**
   * Scan all media and find metadata differences
   */
  async scanAllMedia(
    onProgress: (current: number, total: number, message: string) => void
  ): Promise<MediaScanResult> {
    const client = this.getClient();
    if (!client) throw new Error('Database not initialized');

    const result = await client.execute({
      sql: `SELECT id FROM media WHERE project_id = ?`,
      args: [this.currentProjectId],
    });

    const rows = result.rows;
    const total = rows.length;
    const differences: MediaMetadataDiff[] = [];

    onProgress(0, total, `Scanning ${total} media items...`);

    for (let i = 0; i < rows.length; i++) {
      const mediaId = rows[i].id as string;
      const diff = await this.compareMediaMetadata(mediaId);
      if (diff && diff.hasDifferences) {
        differences.push(diff);
      }
      if ((i + 1) % 10 === 0 || i === total - 1) {
        onProgress(i + 1, total, `Scanned ${i + 1}/${total} media, found ${differences.length} with differences`);
      }
    }

    const groups = this.groupMediaDifferences(differences);

    return {
      totalScanned: total,
      itemsWithDifferences: differences.length,
      differences,
      groups,
    };
  }

  private groupMediaDifferences(diffs: MediaMetadataDiff[]): MediaDiffGroup[] {
    const groupMap = new Map<MediaDiffField, MediaDiffGroup>();
    const fieldLabels: Record<MediaDiffField, string> = {
      title: 'Title',
      alt: 'Alt Text',
      caption: 'Caption',
      author: 'Author',
      tags: 'Tags',
    };

    for (const diff of diffs) {
      for (const [field, fieldDiff] of Object.entries(diff.differences)) {
        const fieldKey = field as MediaDiffField;
        if (!fieldDiff) continue;
        if (!groupMap.has(fieldKey)) {
          groupMap.set(fieldKey, { field: fieldKey, label: fieldLabels[fieldKey], items: [] });
        }
        groupMap.get(fieldKey)!.items.push({
          mediaId: diff.mediaId,
          originalName: diff.originalName,
          dbValue: fieldDiff.dbValue,
          fileValue: fieldDiff.fileValue,
        });
      }
    }

    return Array.from(groupMap.values()).sort((a, b) => b.items.length - a.items.length);
  }

  /**
   * Sync DB metadata to sidecar file for the given media items
   */
  async syncMediaDbToFile(
    mediaIds: string[],
    onProgress?: (percent: number, message: string) => void
  ): Promise<{ success: number; failed: number }> {
    if (!this.mediaEngine) throw new Error('MetadataDiffEngine: mediaEngine not injected');
    const mediaEngine = this.mediaEngine;
    return this.runSyncLoop(
      mediaIds,
      onProgress,
      async (mediaId) => {
        // Re-save the media with its current DB values to regenerate sidecar
        const item = await mediaEngine.getMedia(mediaId);
        if (!item) return false;
        await mediaEngine.updateMedia(mediaId, {
          title: item.title,
          alt: item.alt,
          caption: item.caption,
          author: item.author,
          tags: item.tags,
        });
        return true;
      },
      (id) => `[MetadataDiffEngine] Failed to sync media ${id} to file:`
    );
  }

  /**
   * Sync sidecar metadata to DB for the given media items
   */
  async syncMediaFileToDb(
    mediaIds: string[],
    field?: MediaDiffField,
    onProgress?: (percent: number, message: string) => void
  ): Promise<{ success: number; failed: number }> {
    if (!this.mediaEngine) throw new Error('MetadataDiffEngine: mediaEngine not injected');
    const db = this.getDb();
    const mediaEngine = this.mediaEngine;
    return this.runSyncLoop(
      mediaIds,
      onProgress,
      async (mediaId) => {
        const dbMedia = await db
          .select()
          .from(media)
          .where(and(eq(media.id, mediaId), eq(media.projectId, this.currentProjectId)))
          .get();
        if (!dbMedia) return false;

        const sidecar = await mediaEngine.readSidecarFile(`${dbMedia.filePath}.meta`);
        if (!sidecar) return false;

        const updateData: Record<string, unknown> = { updatedAt: new Date() };

        if (!field || field === 'title') updateData.title = sidecar.title || null;
        if (!field || field === 'alt') updateData.alt = sidecar.alt || null;
        if (!field || field === 'caption') updateData.caption = sidecar.caption || null;
        if (!field || field === 'author') updateData.author = sidecar.author || null;
        if (!field || field === 'tags') updateData.tags = JSON.stringify(sidecar.tags || []);

        await db.update(media).set(updateData).where(eq(media.id, mediaId));
        return true;
      },
      (id) => `[MetadataDiffEngine] Failed to sync media ${id} to DB:`
    );
  }

  // ── Script comparison ──

  /**
   * Compare metadata for a single script between database and file
   */
  async compareScriptMetadata(scriptId: string): Promise<ScriptMetadataDiff | null> {
    const db = this.getDb();
    if (!this.scriptEngine) throw new Error('MetadataDiffEngine: scriptEngine not injected');

    const dbScript = await db
      .select()
      .from(scripts)
      .where(and(eq(scripts.id, scriptId), eq(scripts.projectId, this.currentProjectId)))
      .get();

    if (!dbScript) return null;
    // Skip drafts — they don't have on-disk files
    if (dbScript.status === 'draft') return null;

    const parsed = await this.scriptEngine.readScriptFileWithMetadata(dbScript.filePath);
    if (!parsed) {
      const missingDiffs: Partial<Record<ScriptDiffField, FieldDifference>> = {};
      if (dbScript.title) missingDiffs.title = { dbValue: dbScript.title, fileValue: null };
      if (dbScript.kind) missingDiffs.kind = { dbValue: dbScript.kind, fileValue: null };
      if (dbScript.entrypoint) missingDiffs.entrypoint = { dbValue: dbScript.entrypoint, fileValue: null };
      missingDiffs.enabled = { dbValue: !!dbScript.enabled, fileValue: null };
      if (dbScript.version) missingDiffs.version = { dbValue: dbScript.version, fileValue: null };
      return {
        scriptId: dbScript.id,
        title: dbScript.title,
        slug: dbScript.slug,
        filePath: dbScript.filePath,
        hasDifferences: true,
        fileMissing: true,
        differences: missingDiffs,
      };
    }

    const differences: Partial<Record<ScriptDiffField, FieldDifference>> = {};
    const fm = parsed.metadata;

    if (dbScript.title !== (fm.title || '')) {
      differences.title = { dbValue: dbScript.title, fileValue: fm.title || '' };
    }
    if (dbScript.kind !== (fm.kind || '')) {
      differences.kind = { dbValue: dbScript.kind, fileValue: fm.kind || '' };
    }
    if (dbScript.entrypoint !== (fm.entrypoint || '')) {
      differences.entrypoint = { dbValue: dbScript.entrypoint, fileValue: fm.entrypoint || '' };
    }
    const dbEnabled = !!dbScript.enabled;
    const fileEnabled = !!fm.enabled;
    if (dbEnabled !== fileEnabled) {
      differences.enabled = { dbValue: dbEnabled, fileValue: fileEnabled };
    }
    if (dbScript.version !== (fm.version ?? 0)) {
      differences.version = { dbValue: dbScript.version, fileValue: fm.version ?? 0 };
    }

    return {
      scriptId: dbScript.id,
      title: dbScript.title,
      slug: dbScript.slug,
      filePath: dbScript.filePath,
      hasDifferences: Object.keys(differences).length > 0,
      differences,
    };
  }

  /**
   * Scan all published scripts and find metadata differences
   */
  async scanAllScripts(
    onProgress: (current: number, total: number, message: string) => void
  ): Promise<ScriptScanResult> {
    const client = this.getClient();
    if (!client) throw new Error('Database not initialized');

    const result = await client.execute({
      sql: `SELECT id FROM scripts WHERE project_id = ? AND status = 'published'`,
      args: [this.currentProjectId],
    });

    const rows = result.rows;
    const total = rows.length;
    const differences: ScriptMetadataDiff[] = [];

    onProgress(0, total, `Scanning ${total} scripts...`);

    for (let i = 0; i < rows.length; i++) {
      const scriptId = rows[i].id as string;
      const diff = await this.compareScriptMetadata(scriptId);
      if (diff && diff.hasDifferences) {
        differences.push(diff);
      }
      if ((i + 1) % 10 === 0 || i === total - 1) {
        onProgress(i + 1, total, `Scanned ${i + 1}/${total} scripts, found ${differences.length} with differences`);
      }
    }

    const groups = this.groupScriptDifferences(differences);

    return {
      totalScanned: total,
      itemsWithDifferences: differences.length,
      differences,
      groups,
    };
  }

  private groupScriptDifferences(diffs: ScriptMetadataDiff[]): ScriptDiffGroup[] {
    const groupMap = new Map<ScriptDiffField, ScriptDiffGroup>();
    const fieldLabels: Record<ScriptDiffField, string> = {
      title: 'Title',
      kind: 'Kind',
      entrypoint: 'Entrypoint',
      enabled: 'Enabled',
      version: 'Version',
    };

    for (const diff of diffs) {
      for (const [field, fieldDiff] of Object.entries(diff.differences)) {
        const fieldKey = field as ScriptDiffField;
        if (!fieldDiff) continue;
        if (!groupMap.has(fieldKey)) {
          groupMap.set(fieldKey, { field: fieldKey, label: fieldLabels[fieldKey], items: [] });
        }
        groupMap.get(fieldKey)!.items.push({
          scriptId: diff.scriptId,
          title: diff.title,
          slug: diff.slug,
          dbValue: fieldDiff.dbValue,
          fileValue: fieldDiff.fileValue,
        });
      }
    }

    return Array.from(groupMap.values()).sort((a, b) => b.items.length - a.items.length);
  }

  /**
   * Sync DB metadata to file for given scripts (re-serialises the file frontmatter)
   */
  async syncScriptDbToFile(
    scriptIds: string[],
    onProgress?: (percent: number, message: string) => void
  ): Promise<{ success: number; failed: number }> {
    if (!this.scriptEngine) throw new Error('MetadataDiffEngine: scriptEngine not injected');
    const scriptEngine = this.scriptEngine;
    return this.runSyncLoop(
      scriptIds,
      onProgress,
      async (scriptId) => {
        // Trigger an updateScript with no actual changes — this re-serialises the file
        const item = await scriptEngine.getScript(scriptId);
        if (!item) return false;
        await scriptEngine.updateScript(scriptId, { title: item.title });
        return true;
      },
      (id) => `[MetadataDiffEngine] Failed to sync script ${id} to file:`
    );
  }

  /**
   * Sync file metadata to DB for given scripts
   */
  async syncScriptFileToDb(
    scriptIds: string[],
    field?: ScriptDiffField,
    onProgress?: (percent: number, message: string) => void
  ): Promise<{ success: number; failed: number }> {
    if (!this.scriptEngine) throw new Error('MetadataDiffEngine: scriptEngine not injected');
    const db = this.getDb();
    const scriptEngine = this.scriptEngine;
    return this.runSyncLoop(
      scriptIds,
      onProgress,
      async (scriptId) => {
        const dbScript = await db
          .select()
          .from(scripts)
          .where(and(eq(scripts.id, scriptId), eq(scripts.projectId, this.currentProjectId)))
          .get();
        if (!dbScript) return false;

        const parsed = await scriptEngine.readScriptFileWithMetadata(dbScript.filePath);
        if (!parsed) return false;
        const fm = parsed.metadata;

        const updateData: Record<string, unknown> = { updatedAt: new Date() };

        if (!field || field === 'title') updateData.title = fm.title || dbScript.title;
        if (!field || field === 'kind') updateData.kind = fm.kind || dbScript.kind;
        if (!field || field === 'entrypoint') updateData.entrypoint = fm.entrypoint || dbScript.entrypoint;
        if (!field || field === 'enabled') {
          updateData.enabled = !!fm.enabled;
        }
        if (!field || field === 'version') updateData.version = fm.version ?? dbScript.version;

        await db.update(scripts).set(updateData).where(eq(scripts.id, scriptId));
        return true;
      },
      (id) => `[MetadataDiffEngine] Failed to sync script ${id} to DB:`
    );
  }

  // ── Template comparison ──

  /**
   * Compare metadata for a single template between database and file
   */
  async compareTemplateMetadata(templateId: string): Promise<TemplateMetadataDiff | null> {
    const db = this.getDb();
    if (!this.templateEngine) throw new Error('MetadataDiffEngine: templateEngine not injected');

    const dbTemplate = await db
      .select()
      .from(templates)
      .where(and(eq(templates.id, templateId), eq(templates.projectId, this.currentProjectId)))
      .get();

    if (!dbTemplate) return null;
    if (dbTemplate.status === 'draft') return null;

    const parsed = await this.templateEngine.readTemplateFileWithMetadata(dbTemplate.filePath);
    if (!parsed) {
      const missingDiffs: Partial<Record<TemplateDiffField, FieldDifference>> = {};
      if (dbTemplate.title) missingDiffs.title = { dbValue: dbTemplate.title, fileValue: null };
      if (dbTemplate.kind) missingDiffs.kind = { dbValue: dbTemplate.kind, fileValue: null };
      missingDiffs.enabled = { dbValue: !!dbTemplate.enabled, fileValue: null };
      if (dbTemplate.version) missingDiffs.version = { dbValue: dbTemplate.version, fileValue: null };
      return {
        templateId: dbTemplate.id,
        title: dbTemplate.title,
        slug: dbTemplate.slug,
        filePath: dbTemplate.filePath,
        hasDifferences: true,
        fileMissing: true,
        differences: missingDiffs,
      };
    }

    const differences: Partial<Record<TemplateDiffField, FieldDifference>> = {};
    const fm = parsed.metadata;

    if (dbTemplate.title !== (fm.title || '')) {
      differences.title = { dbValue: dbTemplate.title, fileValue: fm.title || '' };
    }
    if (dbTemplate.kind !== (fm.kind || '')) {
      differences.kind = { dbValue: dbTemplate.kind, fileValue: fm.kind || '' };
    }
    const dbEnabled = !!dbTemplate.enabled;
    const fileEnabled = !!fm.enabled;
    if (dbEnabled !== fileEnabled) {
      differences.enabled = { dbValue: dbEnabled, fileValue: fileEnabled };
    }
    if (dbTemplate.version !== (fm.version ?? 0)) {
      differences.version = { dbValue: dbTemplate.version, fileValue: fm.version ?? 0 };
    }

    return {
      templateId: dbTemplate.id,
      title: dbTemplate.title,
      slug: dbTemplate.slug,
      filePath: dbTemplate.filePath,
      hasDifferences: Object.keys(differences).length > 0,
      differences,
    };
  }

  /**
   * Scan all published templates and find metadata differences
   */
  async scanAllTemplates(
    onProgress: (current: number, total: number, message: string) => void
  ): Promise<TemplateScanResult> {
    const client = this.getClient();
    if (!client) throw new Error('Database not initialized');

    const result = await client.execute({
      sql: `SELECT id FROM templates WHERE project_id = ? AND status = 'published'`,
      args: [this.currentProjectId],
    });

    const rows = result.rows;
    const total = rows.length;
    const differences: TemplateMetadataDiff[] = [];

    onProgress(0, total, `Scanning ${total} templates...`);

    for (let i = 0; i < rows.length; i++) {
      const templateId = rows[i].id as string;
      const diff = await this.compareTemplateMetadata(templateId);
      if (diff && diff.hasDifferences) {
        differences.push(diff);
      }
      if ((i + 1) % 10 === 0 || i === total - 1) {
        onProgress(i + 1, total, `Scanned ${i + 1}/${total} templates, found ${differences.length} with differences`);
      }
    }

    const groups = this.groupTemplateDifferences(differences);

    return {
      totalScanned: total,
      itemsWithDifferences: differences.length,
      differences,
      groups,
    };
  }

  private groupTemplateDifferences(diffs: TemplateMetadataDiff[]): TemplateDiffGroup[] {
    const groupMap = new Map<TemplateDiffField, TemplateDiffGroup>();
    const fieldLabels: Record<TemplateDiffField, string> = {
      title: 'Title',
      kind: 'Kind',
      enabled: 'Enabled',
      version: 'Version',
    };

    for (const diff of diffs) {
      for (const [field, fieldDiff] of Object.entries(diff.differences)) {
        const fieldKey = field as TemplateDiffField;
        if (!fieldDiff) continue;
        if (!groupMap.has(fieldKey)) {
          groupMap.set(fieldKey, { field: fieldKey, label: fieldLabels[fieldKey], items: [] });
        }
        groupMap.get(fieldKey)!.items.push({
          templateId: diff.templateId,
          title: diff.title,
          slug: diff.slug,
          dbValue: fieldDiff.dbValue,
          fileValue: fieldDiff.fileValue,
        });
      }
    }

    return Array.from(groupMap.values()).sort((a, b) => b.items.length - a.items.length);
  }

  /**
   * Sync DB metadata to file for given templates
   */
  async syncTemplateDbToFile(
    templateIds: string[],
    onProgress?: (percent: number, message: string) => void
  ): Promise<{ success: number; failed: number }> {
    if (!this.templateEngine) throw new Error('MetadataDiffEngine: templateEngine not injected');
    const templateEngine = this.templateEngine;
    return this.runSyncLoop(
      templateIds,
      onProgress,
      async (templateId) => {
        const item = await templateEngine.getTemplate(templateId);
        if (!item) return false;
        await templateEngine.updateTemplate(templateId, { title: item.title });
        return true;
      },
      (id) => `[MetadataDiffEngine] Failed to sync template ${id} to file:`
    );
  }

  /**
   * Sync file metadata to DB for given templates
   */
  async syncTemplateFileToDb(
    templateIds: string[],
    field?: TemplateDiffField,
    onProgress?: (percent: number, message: string) => void
  ): Promise<{ success: number; failed: number }> {
    if (!this.templateEngine) throw new Error('MetadataDiffEngine: templateEngine not injected');
    const db = this.getDb();
    const templateEngine = this.templateEngine;
    return this.runSyncLoop(
      templateIds,
      onProgress,
      async (templateId) => {
        const dbTemplate = await db
          .select()
          .from(templates)
          .where(and(eq(templates.id, templateId), eq(templates.projectId, this.currentProjectId)))
          .get();
        if (!dbTemplate) return false;

        const parsed = await templateEngine.readTemplateFileWithMetadata(dbTemplate.filePath);
        if (!parsed) return false;
        const fm = parsed.metadata;

        const updateData: Record<string, unknown> = { updatedAt: new Date() };

        if (!field || field === 'title') updateData.title = fm.title || dbTemplate.title;
        if (!field || field === 'kind') updateData.kind = fm.kind || dbTemplate.kind;
        if (!field || field === 'enabled') {
          updateData.enabled = !!fm.enabled;
        }
        if (!field || field === 'version') updateData.version = fm.version ?? dbTemplate.version;

        await db.update(templates).set(updateData).where(eq(templates.id, templateId));
        return true;
      },
      (id) => `[MetadataDiffEngine] Failed to sync template ${id} to DB:`
    );
  }

  // ── Task wrappers ──

  /**
   * Run a full scan as a background task
   */
  async runScanTask(postsBaseDir?: string): Promise<ScanResult> {
    return taskManager.runTask({
      id: `metadata-diff-scan-${Date.now()}`,
      name: 'Scanning for metadata differences',
      execute: async (onProgress) => {
        return this.scanAllPublishedPosts((current, total, message) => {
          const percent = total > 0 ? (current / total) * 100 : 0;
          onProgress(percent, message);
        }, postsBaseDir);
      },
    });
  }

  /**
   * Run sync DB to File as a background task
   */
  async runSyncDbToFileTask(postIds: string[], groupLabel: string): Promise<{ success: number; failed: number }> {
    return taskManager.runTask({
      id: `metadata-sync-db-to-file-${Date.now()}`,
      name: `Syncing ${groupLabel} from DB to files`,
      execute: async (onProgress) => {
        const result = await this.syncDbToFile(postIds, onProgress);
        onProgress(100, `Completed: ${result.success} synced, ${result.failed} failed`);
        return result;
      },
    });
  }

  /**
   * Run sync File to DB as a background task
   */
  async runSyncFileToDbTask(postIds: string[], field: DiffField, groupLabel: string): Promise<{ success: number; failed: number }> {
    return taskManager.runTask({
      id: `metadata-sync-file-to-db-${Date.now()}`,
      name: `Syncing ${groupLabel} from files to DB`,
      execute: async (onProgress) => {
        const result = await this.syncFileToDb(postIds, field, onProgress);
        onProgress(100, `Completed: ${result.success} synced, ${result.failed} failed`);
        return result;
      },
    });
  }

  // ── Media task wrappers ──

  async runMediaScanTask(): Promise<MediaScanResult> {
    return taskManager.runTask({
      id: `metadata-media-scan-${Date.now()}`,
      name: 'Scanning for media metadata differences',
      execute: async (onProgress) => {
        return this.scanAllMedia((current, total, message) => {
          const percent = total > 0 ? (current / total) * 100 : 0;
          onProgress(percent, message);
        });
      },
    });
  }

  async runMediaSyncDbToFileTask(mediaIds: string[], groupLabel: string): Promise<{ success: number; failed: number }> {
    return taskManager.runTask({
      id: `metadata-media-sync-db-to-file-${Date.now()}`,
      name: `Syncing media ${groupLabel} from DB to files`,
      execute: async (onProgress) => {
        const result = await this.syncMediaDbToFile(mediaIds, onProgress);
        onProgress(100, `Completed: ${result.success} synced, ${result.failed} failed`);
        return result;
      },
    });
  }

  async runMediaSyncFileToDbTask(mediaIds: string[], field: MediaDiffField, groupLabel: string): Promise<{ success: number; failed: number }> {
    return taskManager.runTask({
      id: `metadata-media-sync-file-to-db-${Date.now()}`,
      name: `Syncing media ${groupLabel} from files to DB`,
      execute: async (onProgress) => {
        const result = await this.syncMediaFileToDb(mediaIds, field, onProgress);
        onProgress(100, `Completed: ${result.success} synced, ${result.failed} failed`);
        return result;
      },
    });
  }

  // ── Script task wrappers ──

  async runScriptScanTask(): Promise<ScriptScanResult> {
    return taskManager.runTask({
      id: `metadata-script-scan-${Date.now()}`,
      name: 'Scanning for script metadata differences',
      execute: async (onProgress) => {
        return this.scanAllScripts((current, total, message) => {
          const percent = total > 0 ? (current / total) * 100 : 0;
          onProgress(percent, message);
        });
      },
    });
  }

  async runScriptSyncDbToFileTask(scriptIds: string[], groupLabel: string): Promise<{ success: number; failed: number }> {
    return taskManager.runTask({
      id: `metadata-script-sync-db-to-file-${Date.now()}`,
      name: `Syncing script ${groupLabel} from DB to files`,
      execute: async (onProgress) => {
        const result = await this.syncScriptDbToFile(scriptIds, onProgress);
        onProgress(100, `Completed: ${result.success} synced, ${result.failed} failed`);
        return result;
      },
    });
  }

  async runScriptSyncFileToDbTask(scriptIds: string[], field: ScriptDiffField, groupLabel: string): Promise<{ success: number; failed: number }> {
    return taskManager.runTask({
      id: `metadata-script-sync-file-to-db-${Date.now()}`,
      name: `Syncing script ${groupLabel} from files to DB`,
      execute: async (onProgress) => {
        const result = await this.syncScriptFileToDb(scriptIds, field, onProgress);
        onProgress(100, `Completed: ${result.success} synced, ${result.failed} failed`);
        return result;
      },
    });
  }

  // ── Template task wrappers ──

  async runTemplateScanTask(): Promise<TemplateScanResult> {
    return taskManager.runTask({
      id: `metadata-template-scan-${Date.now()}`,
      name: 'Scanning for template metadata differences',
      execute: async (onProgress) => {
        return this.scanAllTemplates((current, total, message) => {
          const percent = total > 0 ? (current / total) * 100 : 0;
          onProgress(percent, message);
        });
      },
    });
  }

  async runTemplateSyncDbToFileTask(templateIds: string[], groupLabel: string): Promise<{ success: number; failed: number }> {
    return taskManager.runTask({
      id: `metadata-template-sync-db-to-file-${Date.now()}`,
      name: `Syncing template ${groupLabel} from DB to files`,
      execute: async (onProgress) => {
        const result = await this.syncTemplateDbToFile(templateIds, onProgress);
        onProgress(100, `Completed: ${result.success} synced, ${result.failed} failed`);
        return result;
      },
    });
  }

  async runTemplateSyncFileToDbTask(templateIds: string[], field: TemplateDiffField, groupLabel: string): Promise<{ success: number; failed: number }> {
    return taskManager.runTask({
      id: `metadata-template-sync-file-to-db-${Date.now()}`,
      name: `Syncing template ${groupLabel} from files to DB`,
      execute: async (onProgress) => {
        const result = await this.syncTemplateFileToDb(templateIds, field, onProgress);
        onProgress(100, `Completed: ${result.success} synced, ${result.failed} failed`);
        return result;
      },
    });
  }

  // ── Orphan file import ──

  /**
   * Import orphan files (on disk with no DB entry) into the database as published posts.
   */
  async importOrphanFiles(
    filePaths: string[],
    onProgress?: (current: number, total: number, message: string) => void,
  ): Promise<{ success: number; failed: number }> {
    const postEngine = this.postEngine;
    if (!postEngine) throw new Error('MetadataDiffEngine: postEngine not injected');

    let success = 0;
    let failed = 0;
    const total = filePaths.length;

    for (let i = 0; i < filePaths.length; i++) {
      try {
        const translationData = await readPostTranslationFile(filePaths[i]);
        const imported = translationData && typeof postEngine.importOrphanTranslationFile === 'function'
          ? await postEngine.importOrphanTranslationFile(filePaths[i])
          : await postEngine.importOrphanFile(filePaths[i]);
        if (imported) {
          success++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }

      if (onProgress && ((i + 1) % 5 === 0 || i === total - 1)) {
        onProgress(i + 1, total, `Imported ${success}/${i + 1} orphan files`);
      }
    }

    return { success, failed };
  }

  async runImportOrphanFilesTask(filePaths: string[]): Promise<{ success: number; failed: number }> {
    return taskManager.runTask({
      id: `metadata-import-orphans-${Date.now()}`,
      name: `Importing ${filePaths.length} orphan files into database`,
      execute: async (onProgress) => {
        const result = await this.importOrphanFiles(filePaths, (current, total, message) => {
          const percent = total > 0 ? (current / total) * 100 : 0;
          onProgress(percent, message);
        });
        onProgress(100, `Completed: ${result.success} imported, ${result.failed} failed`);
        return result;
      },
    });
  }
}