/**
 * MetadataDiffEngine
 *
 * Compares metadata between database records and filesystem files for posts and media.
 * Used to detect and resolve differences that may have accumulated due to bugs or
 * manual edits.
 */

import { EventEmitter } from 'events';
import { eq, and } from 'drizzle-orm';
import { getDatabase } from '../database';
import { posts, media } from '../database/schema';
import { readPostFile, PostFileData } from './postFileUtils';
import { taskManager } from './TaskManager';
import type { PostEngine } from './PostEngine';

/**
 * A difference in a specific metadata field
 */
export interface FieldDifference<T = unknown> {
  dbValue: T;
  fileValue: T;
}

/**
 * The fields that can have differences
 */
export type DiffField = 'tags' | 'categories' | 'title' | 'excerpt' | 'author' | 'language';

/**
 * Metadata differences for a single post
 */
export interface PostMetadataDiff {
  postId: string;
  title: string;
  slug: string;
  filePath?: string;
  hasDifferences: boolean;
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
 * Result of scanning all published posts
 */
export interface ScanResult {
  totalScanned: number;
  postsWithDifferences: number;
  differences: PostMetadataDiff[];
  groups: DiffGroup[];
}

/**
 * Statistics about posts/media tables
 */
export interface TableStats {
  totalPosts: number;
  publishedPosts: number;
  draftPosts: number;
  totalMedia: number;
}

export class MetadataDiffEngine extends EventEmitter {
  private currentProjectId = 'default';

  constructor(private readonly postEngine?: PostEngine) {
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
   * Get statistics about the posts and media tables
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

    return {
      totalPosts,
      publishedPosts,
      draftPosts,
      totalMedia,
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
      return null;
    }

    // Skip drafts - they don't have files
    if (!dbPost.filePath || dbPost.status === 'draft') {
      return null;
    }

    // Read file metadata
    const fileData = await readPostFile(dbPost.filePath);
    if (!fileData) {
      // File doesn't exist or can't be read
      return {
        postId: dbPost.id,
        title: dbPost.title,
        slug: dbPost.slug,
        filePath: dbPost.filePath,
        hasDifferences: true,
        differences: {}, // File missing entirely
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
   * Scan all published posts and find metadata differences
   */
  async scanAllPublishedPosts(
    onProgress: (current: number, total: number, message: string) => void
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

    const publishedPosts = result.rows;
    const total = publishedPosts.length;
    const differences: PostMetadataDiff[] = [];

    onProgress(0, total, `Scanning ${total} published posts...`);

    for (let i = 0; i < publishedPosts.length; i++) {
      const row = publishedPosts[i];
      const postId = row.id as string;

      const diff = await this.comparePostMetadata(postId);
      if (diff && diff.hasDifferences) {
        differences.push(diff);
      }

      if ((i + 1) % 10 === 0 || i === total - 1) {
        onProgress(i + 1, total, `Scanned ${i + 1}/${total} posts, found ${differences.length} with differences`);
      }
    }

    // Group the differences
    const groups = this.groupDifferencesByField(differences);

    return {
      totalScanned: total,
      postsWithDifferences: differences.length,
      differences,
      groups,
    };
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
      async (postId) => postEngine.syncPublishedPostFile(postId),
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

        if (!dbPost || !dbPost.filePath) {
          return false;
        }

        // Read file metadata
        const fileData = await readPostFile(dbPost.filePath);
        if (!fileData) {
          return false;
        }

        // Build update object based on field or all fields
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

        // Update database
        await db
          .update(posts)
          .set(updateData)
          .where(eq(posts.id, postId));

        return true;
      },
      (postId) => `[MetadataDiffEngine] Failed to sync post ${postId} to DB:`
    );
  }

  /**
   * Run a full scan as a background task
   */
  async runScanTask(): Promise<ScanResult> {
    return taskManager.runTask({
      id: `metadata-diff-scan-${Date.now()}`,
      name: 'Scanning for metadata differences',
      execute: async (onProgress) => {
        return this.scanAllPublishedPosts((current, total, message) => {
          const percent = total > 0 ? (current / total) * 100 : 0;
          onProgress(percent, message);
        });
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
}


