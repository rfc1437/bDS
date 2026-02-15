import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import { eq, and, asc, sql, like } from 'drizzle-orm';
import { getDatabase } from '../database';
import { tags, posts } from '../database/schema';
import { taskManager } from './TaskManager';
import { getPostEngine } from './PostEngine';

/**
 * Tag data stored in the database
 */
export interface TagData {
  id: string;
  projectId: string;
  name: string;
  color?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Tag with post count for tag cloud display
 */
export interface TagWithCount {
  name: string;
  color: string | null;
  count: number;
}

/**
 * Input for creating a new tag
 */
export interface CreateTagInput {
  name: string;
  color?: string;
}

/**
 * Input for updating a tag
 */
export interface UpdateTagInput {
  name?: string;
  color?: string | null;
}

/**
 * Result of tag deletion
 */
export interface DeleteTagResult {
  success: boolean;
  postsUpdated: number;
}

/**
 * Result of merging tags
 */
export interface MergeTagsResult {
  success: boolean;
  postsUpdated: number;
  tagsDeleted: number;
  targetTag: string;
}

/**
 * Result of renaming a tag
 */
export interface RenameTagResult {
  success: boolean;
  postsUpdated: number;
  oldName: string;
  newName: string;
}

/**
 * Result of syncing tags from posts
 */
export interface SyncTagsResult {
  discovered: number;
  added: string[];
}

// Singleton instance
let tagEngineInstance: TagEngine | null = null;

/**
 * Get the singleton TagEngine instance
 */
export function getTagEngine(): TagEngine {
  if (!tagEngineInstance) {
    tagEngineInstance = new TagEngine();
  }
  return tagEngineInstance;
}

/**
 * Validate hex color format
 */
function isValidHexColor(color: string): boolean {
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(color);
}

/**
 * Portable tag format for filesystem serialization.
 * Only stores name and optional color - no internal IDs.
 */
interface SerializedTag {
  name: string;
  color?: string;
}

/**
 * TagEngine manages tag metadata and operations.
 * 
 * Tags are stored in a dedicated tags table with optional colors.
 * This engine handles:
 * - CRUD operations on tags
 * - Mass operations (merge, rename) that run as background tasks
 * - Syncing tags discovered from posts
 */
export class TagEngine extends EventEmitter {
  private currentProjectId: string = 'default';
  private dataDir: string | null = null; // Custom data directory (null = use internal userData)

  constructor() {
    super();
  }

  private getDb() {
    return getDatabase().getLocal();
  }

  // For JSON operations that Drizzle doesn't support natively
  private getClient() {
    return getDatabase().getLocalClient();
  }

  private async getTagRowOrThrow(tagId: string): Promise<typeof tags.$inferSelect> {
    const db = this.getDb();

    const tagRows = await db
      .select()
      .from(tags)
      .where(and(
        eq(tags.id, tagId),
        eq(tags.projectId, this.currentProjectId)
      ));

    if (tagRows.length === 0) {
      throw new Error('Tag not found');
    }

    return tagRows[0];
  }

  private async queryPostsContainingTag(tagName: string): Promise<Array<{ postId: string; postTags: string[] }>> {
    const client = this.getClient();
    if (!client) {
      throw new Error('Database not initialized');
    }

    const postsResult = await client.execute({
      sql: `SELECT id, tags FROM posts WHERE project_id = ? AND tags LIKE ?`,
      args: [this.currentProjectId, `%"${tagName}"%`],
    });

    return postsResult.rows
      .map((row: any) => ({
        postId: row.id as string,
        postTags: JSON.parse(row.tags || '[]') as string[],
      }))
      .filter((row) => row.postTags.includes(tagName));
  }

  private async updatePostTagsAndSync(postId: string, updatedTags: string[]): Promise<void> {
    const db = this.getDb();

    await db
      .update(posts)
      .set({
        tags: JSON.stringify(updatedTags),
        updatedAt: new Date(),
      })
      .where(eq(posts.id, postId));

    await getPostEngine().syncPublishedPostFile(postId);
  }

  private async updateMatchingPosts(
    tagName: string,
    transform: (postTags: string[]) => string[]
  ): Promise<{ total: number; process: (onEachUpdated: (updated: number, total: number) => void) => Promise<number> }> {
    const rawPostsToUpdate = await this.queryPostsContainingTag(tagName);
    const postsToUpdate = Array.from(
      new Map(rawPostsToUpdate.map((row) => [row.postId, row])).values()
    );
    const total = postsToUpdate.length;

    return {
      total,
      process: async (onEachUpdated) => {
        let updated = 0;

        for (const row of postsToUpdate) {
          const updatedTags = transform(row.postTags);
          await this.updatePostTagsAndSync(row.postId, updatedTags);
          updated++;
          onEachUpdated(updated, total);
        }

        return updated;
      },
    };
  }

  /**
   * Returns the default internal project directory (in userData).
   */
  private getDefaultBaseDir(): string {
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, 'projects', this.currentProjectId);
  }

  /**
   * Returns the base directory for project data.
   * If a custom dataDir is set, uses that; otherwise uses internal userData.
   */
  private getBaseDir(): string {
    return this.dataDir || this.getDefaultBaseDir();
  }

  /**
   * Set the current project context
   */
  setProjectContext(projectId: string, dataDir?: string): void {
    this.currentProjectId = projectId;
    this.dataDir = dataDir || null;
  }

  /**
   * Get the current project context
   */
  getProjectContext(): string {
    return this.currentProjectId;
  }

  /**
   * Get the tags file path for filesystem persistence
   */
  private getTagsFilePath(): string {
    return path.join(this.getBaseDir(), 'meta', 'tags.json');
  }

  /**
   * Get all tags with their post counts for the tag cloud
   */
  async getTagsWithCounts(): Promise<TagWithCount[]> {
    const client = this.getClient();
    if (!client) return [];

    // Query tags with counts from posts - requires raw SQL for JSON operations
    const result = await client.execute({
      sql: `
        SELECT 
          t.name,
          t.color,
          COALESCE(pc.post_count, 0) as post_count
        FROM tags t
        LEFT JOIN (
          SELECT je.value as tag_name, COUNT(DISTINCT p.id) as post_count
          FROM posts p, json_each(p.tags) je
          WHERE p.project_id = ?
          GROUP BY je.value
        ) pc ON LOWER(pc.tag_name) = LOWER(t.name)
        WHERE t.project_id = ?
        ORDER BY post_count DESC, t.name ASC
      `,
      args: [this.currentProjectId, this.currentProjectId],
    });

    return result.rows.map((row: any) => ({
      name: row.name as string,
      color: row.color as string | null,
      count: Number(row.post_count) || 0,
    }));
  }

  /**
   * Create a new tag
   */
  async createTag(input: CreateTagInput): Promise<TagData> {
    const db = this.getDb();

    const name = input.name.trim().toLowerCase();
    if (!name) {
      throw new Error('Tag name is required');
    }

    // Validate color if provided
    if (input.color && !isValidHexColor(input.color)) {
      throw new Error('Invalid color format. Use hex format like #ff0000 or #f00');
    }

    // Check for duplicate using Drizzle
    const existing = await db
      .select({ id: tags.id })
      .from(tags)
      .where(and(
        eq(tags.projectId, this.currentProjectId),
        sql`LOWER(${tags.name}) = LOWER(${name})`
      ));

    if (existing.length > 0) {
      throw new Error(`Tag "${name}" already exists`);
    }

    const now = new Date();
    const tag: TagData = {
      id: uuidv4(),
      projectId: this.currentProjectId,
      name,
      color: input.color,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(tags).values({
      id: tag.id,
      projectId: tag.projectId,
      name: tag.name,
      color: tag.color || null,
      createdAt: now,
      updatedAt: now,
    });

    this.emit('tagCreated', tag);
    await this.saveTagsToFile();

    return tag;
  }

  /**
   * Update a tag
   */
  async updateTag(id: string, input: UpdateTagInput): Promise<TagData | null> {
    const db = this.getDb();

    // Get existing tag
    const existing = await db
      .select()
      .from(tags)
      .where(and(
        eq(tags.id, id),
        eq(tags.projectId, this.currentProjectId)
      ));

    if (existing.length === 0) {
      return null;
    }

    const row = existing[0];

    // Validate color if provided
    if (input.color !== undefined && input.color !== null && !isValidHexColor(input.color)) {
      throw new Error('Invalid color format. Use hex format like #ff0000 or #f00');
    }

    if (input.color === undefined) {
      // No updates
      return this.rowToTagData(row);
    }

    const now = new Date();

    await db
      .update(tags)
      .set({
        color: input.color,
        updatedAt: now,
      })
      .where(and(
        eq(tags.id, id),
        eq(tags.projectId, this.currentProjectId)
      ));

    const updatedTag: TagData = {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      color: input.color !== undefined ? input.color || undefined : row.color || undefined,
      createdAt: row.createdAt,
      updatedAt: now,
    };

    this.emit('tagUpdated', updatedTag);
    await this.saveTagsToFile();

    return updatedTag;
  }

  /**
   * Delete a tag and remove it from all posts (runs as background task)
   */
  async deleteTag(id: string): Promise<DeleteTagResult> {
    const db = this.getDb();
    const tag = await this.getTagRowOrThrow(id);
    const tagName = tag.name;

    // Run the deletion as a background task
    return taskManager.runTask({
      id: `delete-tag-${id}-${Date.now()}`,
      name: `Delete tag "${tagName}"`,
      execute: async (onProgress) => {
        onProgress(0, `Finding posts with tag "${tagName}"...`);

        const updateOperation = await this.updateMatchingPosts(
          tagName,
          (postTags) => postTags.filter((tagEntry) => tagEntry !== tagName)
        );

        const updated = await updateOperation.process((updatedCount, totalCount) => {
          onProgress((updatedCount / totalCount) * 80, `Updated ${updatedCount}/${totalCount} posts...`);
        });

        onProgress(90, 'Deleting tag...');

        // Delete the tag
        await db
          .delete(tags)
          .where(and(
            eq(tags.id, id),
            eq(tags.projectId, this.currentProjectId)
          ));

        onProgress(100, 'Complete');

        this.emit('tagDeleted', id);
        await this.saveTagsToFile();

        return { success: true, postsUpdated: updated };
      },
    });
  }

  /**
   * Merge multiple source tags into a target tag (runs as background task)
   */
  async mergeTags(sourceTagIds: string[], targetTagId: string): Promise<MergeTagsResult> {
    const db = this.getDb();

    if (sourceTagIds.length === 0) {
      throw new Error('Source tags are required');
    }

    // Verify all source tags exist
    const sourceTags: (typeof tags.$inferSelect)[] = [];
    for (const id of sourceTagIds) {
      const rows = await db
        .select()
        .from(tags)
        .where(and(
          eq(tags.id, id),
          eq(tags.projectId, this.currentProjectId)
        ));
      if (rows.length > 0) {
        sourceTags.push(rows[0]);
      }
    }

    // Verify target tag exists
    const targetRows = await db
      .select()
      .from(tags)
      .where(and(
        eq(tags.id, targetTagId),
        eq(tags.projectId, this.currentProjectId)
      ));

    if (targetRows.length === 0) {
      throw new Error('Target tag not found');
    }

    const targetTag = targetRows[0];
    const targetName = targetTag.name;
    const sourceNames = sourceTags.map(t => t.name);

    // Run as background task
    return taskManager.runTask({
      id: `merge-tags-${Date.now()}`,
      name: `Merge tags into "${targetName}"`,
      execute: async (onProgress) => {
        onProgress(0, 'Finding posts to update...');

        const updatedPostTagsById = new Map<string, string[]>();

        // For each source tag, compute final post tags per post ID
        for (let index = 0; index < sourceNames.length; index++) {
          const sourceName = sourceNames[index];
          onProgress((index / sourceNames.length) * 80, `Processing tag "${sourceName}"...`);

          const postsWithSourceTag = await this.queryPostsContainingTag(sourceName);
          for (const row of postsWithSourceTag) {
            const currentTags = updatedPostTagsById.get(row.postId) ?? row.postTags;
            if (!currentTags.includes(sourceName)) {
              continue;
            }

            const transformedTags = currentTags.filter((tagEntry) => tagEntry !== sourceName);
            if (!transformedTags.includes(targetName)) {
              transformedTags.push(targetName);
            }

            updatedPostTagsById.set(row.postId, transformedTags);
          }
        }

        for (const [postId, updatedTags] of updatedPostTagsById.entries()) {
          await this.updatePostTagsAndSync(postId, updatedTags);
        }

        const totalPostsUpdated = updatedPostTagsById.size;

        onProgress(90, 'Deleting source tags...');

        // Delete source tags
        for (const id of sourceTagIds) {
          await db
            .delete(tags)
            .where(and(
              eq(tags.id, id),
              eq(tags.projectId, this.currentProjectId)
            ));
        }

        onProgress(100, 'Complete');

        const result: MergeTagsResult = {
          success: true,
          postsUpdated: totalPostsUpdated,
          tagsDeleted: sourceTagIds.length,
          targetTag: targetName,
        };

        this.emit('tagsMerged', result);
        await this.saveTagsToFile();

        return result;
      },
    });
  }

  /**
   * Rename a tag (runs as background task to update posts)
   */
  async renameTag(id: string, newName: string): Promise<RenameTagResult> {
    const db = this.getDb();

    newName = newName.trim().toLowerCase();
    if (!newName) {
      throw new Error('New name is required');
    }

    // Get existing tag
    const tagRows = await db
      .select()
      .from(tags)
      .where(and(
        eq(tags.id, id),
        eq(tags.projectId, this.currentProjectId)
      ));

    if (tagRows.length === 0) {
      throw new Error('Tag not found');
    }

    const tag = tagRows[0];
    const oldName = tag.name;

    if (oldName === newName) {
      return { success: true, postsUpdated: 0, oldName, newName };
    }

    // Check for duplicate
    const duplicateRows = await db
      .select({ id: tags.id })
      .from(tags)
      .where(and(
        eq(tags.projectId, this.currentProjectId),
        sql`LOWER(${tags.name}) = LOWER(${newName})`,
        sql`${tags.id} != ${id}`
      ));

    if (duplicateRows.length > 0) {
      throw new Error(`Tag "${newName}" already exists`);
    }

    // Run as background task
    return taskManager.runTask({
      id: `rename-tag-${id}-${Date.now()}`,
      name: `Rename tag "${oldName}" to "${newName}"`,
      execute: async (onProgress) => {
        onProgress(0, 'Finding posts to update...');

        const updateOperation = await this.updateMatchingPosts(
          oldName,
          (postTags) => postTags.map((tagEntry) => tagEntry === oldName ? newName : tagEntry)
        );

        const updated = await updateOperation.process((updatedCount, totalCount) => {
          onProgress((updatedCount / totalCount) * 80, `Updated ${updatedCount}/${totalCount} posts...`);
        });

        onProgress(90, 'Updating tag record...');

        // Update the tag name
        await db
          .update(tags)
          .set({
            name: newName,
            updatedAt: new Date(),
          })
          .where(and(
            eq(tags.id, id),
            eq(tags.projectId, this.currentProjectId)
          ));

        onProgress(100, 'Complete');

        const result: RenameTagResult = {
          success: true,
          postsUpdated: updated,
          oldName,
          newName,
        };

        this.emit('tagRenamed', result);
        await this.saveTagsToFile();

        return result;
      },
    });
  }

  /**
   * Get a tag by ID
   */
  async getTag(id: string): Promise<TagData | null> {
    const db = this.getDb();

    const rows = await db
      .select()
      .from(tags)
      .where(and(
        eq(tags.id, id),
        eq(tags.projectId, this.currentProjectId)
      ));

    if (rows.length === 0) {
      return null;
    }

    return this.rowToTagData(rows[0]);
  }

  /**
   * Get a tag by name (case-insensitive)
   */
  async getTagByName(name: string): Promise<TagData | null> {
    const db = this.getDb();
    const normalizedName = name.trim().toLowerCase();

    const rows = await db
      .select()
      .from(tags)
      .where(and(
        eq(tags.projectId, this.currentProjectId),
        sql`LOWER(${tags.name}) = LOWER(${normalizedName})`
      ));

    if (rows.length === 0) {
      return null;
    }

    return this.rowToTagData(rows[0]);
  }

  /**
   * Get all tags for the current project
   */
  async getAllTags(): Promise<TagData[]> {
    const db = this.getDb();

    const rows = await db
      .select()
      .from(tags)
      .where(eq(tags.projectId, this.currentProjectId))
      .orderBy(asc(tags.name));

    return rows.map(row => this.rowToTagData(row));
  }

  /**
   * Get post IDs that have a specific tag
   */
  async getPostsWithTag(tagId: string): Promise<string[]> {
    const db = this.getDb();
    const client = this.getClient();
    if (!client) return [];

    // First get the tag name
    const tagRows = await db
      .select({ name: tags.name })
      .from(tags)
      .where(and(
        eq(tags.id, tagId),
        eq(tags.projectId, this.currentProjectId)
      ));

    if (tagRows.length === 0) {
      return [];
    }

    const tagName = tagRows[0].name;

    // Find posts with this tag - requires raw SQL for JSON
    const postsResult = await client.execute({
      sql: `SELECT id, tags FROM posts WHERE project_id = ? AND tags LIKE ?`,
      args: [this.currentProjectId, `%"${tagName}"%`],
    });

    return postsResult.rows
      .filter((row: any) => {
        const postTags: string[] = JSON.parse(row.tags || '[]');
        return postTags.includes(tagName);
      })
      .map((row: any) => row.id as string);
  }

  /**
   * Sync tags from existing posts - discover tags that exist in posts but not in tags table
   */
  async syncTagsFromPosts(): Promise<SyncTagsResult> {
    const db = this.getDb();

    // Get all tags from posts
    const postRows = await db
      .select({ tags: posts.tags })
      .from(posts)
      .where(eq(posts.projectId, this.currentProjectId));

    const discoveredTags = new Set<string>();
    for (const row of postRows) {
      const postTags: string[] = JSON.parse(row.tags || '[]');
      for (const tag of postTags) {
        if (tag.trim()) {
          discoveredTags.add(tag.trim().toLowerCase());
        }
      }
    }

    // Get existing tags
    const existingRows = await db
      .select({ name: tags.name })
      .from(tags)
      .where(eq(tags.projectId, this.currentProjectId));

    const existingNames = new Set(existingRows.map(row => row.name.toLowerCase()));

    // Find missing tags
    const missingTags = Array.from(discoveredTags).filter(t => !existingNames.has(t));
    const added: string[] = [];

    // Add missing tags
    const now = new Date();
    for (const tagName of missingTags) {
      await db.insert(tags).values({
        id: uuidv4(),
        projectId: this.currentProjectId,
        name: tagName,
        color: null,
        createdAt: now,
        updatedAt: now,
      });
      added.push(tagName);
    }

    if (added.length > 0) {
      this.emit('tagsSynced', { discovered: discoveredTags.size, added });
      await this.saveTagsToFile();
    }

    return {
      discovered: discoveredTags.size,
      added,
    };
  }

  /**
   * Convert database row to TagData
   */
  private rowToTagData(row: typeof tags.$inferSelect): TagData {
    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      color: row.color || undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Save tags to filesystem in portable format (no internal IDs).
   * Format: [{ name: "tag", color?: "#hex" }, ...]
   */
  private async saveTagsToFile(): Promise<void> {
    try {
      const allTags = await this.getAllTags();
      const filePath = this.getTagsFilePath();
      const dir = path.dirname(filePath);

      // Serialize to portable format - only name and optional color
      const serialized: SerializedTag[] = allTags.map(tag => {
        const entry: SerializedTag = { name: tag.name };
        if (tag.color) {
          entry.color = tag.color;
        }
        return entry;
      });

      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(serialized, null, 2), 'utf-8');
    } catch (error) {
      console.error('[TagEngine] Failed to save tags to file:', error);
    }
  }

  /**
   * Load tags from filesystem (for initial sync).
   * Handles both new portable format and legacy format with IDs.
   */
  async loadTagsFromFile(): Promise<void> {
    try {
      const filePath = this.getTagsFilePath();
      const content = await fs.readFile(filePath, 'utf-8');
      const rawTags: any[] = JSON.parse(content);

      const db = this.getDb();
      const now = new Date();

      for (const tag of rawTags) {
        // Support both portable format { name, color? } and legacy format with id
        const name = (tag.name || '').trim().toLowerCase();
        if (!name) continue;

        const color = tag.color || null;

        // Check if tag with this name already exists
        const existing = await db
          .select({ id: tags.id })
          .from(tags)
          .where(and(
            eq(tags.projectId, this.currentProjectId),
            sql`LOWER(${tags.name}) = LOWER(${name})`
          ));

        if (existing.length === 0) {
          // Create new tag with fresh ID
          await db.insert(tags).values({
            id: uuidv4(),
            projectId: this.currentProjectId,
            name,
            color,
            createdAt: now,
            updatedAt: now,
          });
        } else if (color) {
          // Update color if provided and tag exists
          await db
            .update(tags)
            .set({
              color,
              updatedAt: now,
            })
            .where(and(
              eq(tags.projectId, this.currentProjectId),
              sql`LOWER(${tags.name}) = LOWER(${name})`
            ));
        }
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error('[TagEngine] Failed to load tags from file:', error);
      }
    }
  }
}
