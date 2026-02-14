import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import { getDatabase } from '../database';
import { taskManager } from './TaskManager';

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
    const client = getDatabase().getLocalClient();
    if (!client) return [];

    // Query tags with counts from posts
    // Use a subquery to count posts per tag name
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
    const client = getDatabase().getLocalClient();
    if (!client) throw new Error('Database not initialized');

    const name = input.name.trim().toLowerCase();
    if (!name) {
      throw new Error('Tag name is required');
    }

    // Validate color if provided
    if (input.color && !isValidHexColor(input.color)) {
      throw new Error('Invalid color format. Use hex format like #ff0000 or #f00');
    }

    // Check for duplicate
    const existing = await client.execute({
      sql: 'SELECT id, name FROM tags WHERE project_id = ? AND LOWER(name) = LOWER(?)',
      args: [this.currentProjectId, name],
    });

    if (existing.rows.length > 0) {
      throw new Error(`Tag "${name}" already exists`);
    }

    const now = Date.now();
    const tag: TagData = {
      id: uuidv4(),
      projectId: this.currentProjectId,
      name,
      color: input.color,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };

    await client.execute({
      sql: 'INSERT INTO tags (id, project_id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      args: [tag.id, tag.projectId, tag.name, tag.color || null, now, now],
    });

    this.emit('tagCreated', tag);
    await this.saveTagsToFile();

    return tag;
  }

  /**
   * Update a tag
   */
  async updateTag(id: string, input: UpdateTagInput): Promise<TagData | null> {
    const client = getDatabase().getLocalClient();
    if (!client) return null;

    // Get existing tag
    const existing = await client.execute({
      sql: 'SELECT * FROM tags WHERE id = ? AND project_id = ?',
      args: [id, this.currentProjectId],
    });

    if (existing.rows.length === 0) {
      return null;
    }

    const row = existing.rows[0] as any;

    // Validate color if provided
    if (input.color !== undefined && input.color !== null && !isValidHexColor(input.color)) {
      throw new Error('Invalid color format. Use hex format like #ff0000 or #f00');
    }

    const now = Date.now();
    const updates: string[] = [];
    const args: any[] = [];

    if (input.color !== undefined) {
      updates.push('color = ?');
      args.push(input.color);
    }

    if (updates.length === 0) {
      // No updates
      return this.rowToTagData(row);
    }

    updates.push('updated_at = ?');
    args.push(now);
    args.push(id);
    args.push(this.currentProjectId);

    await client.execute({
      sql: `UPDATE tags SET ${updates.join(', ')} WHERE id = ? AND project_id = ?`,
      args,
    });

    const updatedTag: TagData = {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      color: input.color !== undefined ? input.color || undefined : row.color,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(now),
    };

    this.emit('tagUpdated', updatedTag);
    await this.saveTagsToFile();

    return updatedTag;
  }

  /**
   * Delete a tag and remove it from all posts (runs as background task)
   */
  async deleteTag(id: string): Promise<DeleteTagResult> {
    const client = getDatabase().getLocalClient();
    if (!client) throw new Error('Database not initialized');

    // Get tag
    const tagResult = await client.execute({
      sql: 'SELECT * FROM tags WHERE id = ? AND project_id = ?',
      args: [id, this.currentProjectId],
    });

    if (tagResult.rows.length === 0) {
      throw new Error('Tag not found');
    }

    const tag = tagResult.rows[0] as any;
    const tagName = tag.name as string;

    // Run the deletion as a background task
    return taskManager.runTask({
      id: `delete-tag-${id}-${Date.now()}`,
      name: `Delete tag "${tagName}"`,
      execute: async (onProgress) => {
        onProgress(0, `Finding posts with tag "${tagName}"...`);

        // Find all posts with this tag
        const postsResult = await client.execute({
          sql: `SELECT id, tags FROM posts WHERE project_id = ? AND tags LIKE ?`,
          args: [this.currentProjectId, `%"${tagName}"%`],
        });

        const postsToUpdate = postsResult.rows.filter((row: any) => {
          const tags: string[] = JSON.parse(row.tags || '[]');
          return tags.includes(tagName);
        });

        const total = postsToUpdate.length;
        let updated = 0;

        for (const row of postsToUpdate) {
          const postId = row.id as string;
          const tags: string[] = JSON.parse((row as any).tags || '[]');
          const newTags = tags.filter(t => t !== tagName);

          await client.execute({
            sql: 'UPDATE posts SET tags = ?, updated_at = ? WHERE id = ?',
            args: [JSON.stringify(newTags), Date.now(), postId],
          });

          updated++;
          onProgress((updated / total) * 80, `Updated ${updated}/${total} posts...`);
        }

        onProgress(90, 'Deleting tag...');

        // Delete the tag
        await client.execute({
          sql: 'DELETE FROM tags WHERE id = ? AND project_id = ?',
          args: [id, this.currentProjectId],
        });

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
    const client = getDatabase().getLocalClient();
    if (!client) throw new Error('Database not initialized');

    if (sourceTagIds.length === 0) {
      throw new Error('Source tags are required');
    }

    // Verify all source tags exist
    const sourceTags: any[] = [];
    for (const id of sourceTagIds) {
      const result = await client.execute({
        sql: 'SELECT * FROM tags WHERE id = ? AND project_id = ?',
        args: [id, this.currentProjectId],
      });
      if (result.rows.length > 0) {
        sourceTags.push(result.rows[0]);
      }
    }

    // Verify target tag exists
    const targetResult = await client.execute({
      sql: 'SELECT * FROM tags WHERE id = ? AND project_id = ?',
      args: [targetTagId, this.currentProjectId],
    });

    if (targetResult.rows.length === 0) {
      throw new Error('Target tag not found');
    }

    const targetTag = targetResult.rows[0] as any;
    const targetName = targetTag.name as string;
    const sourceNames = sourceTags.map((t: any) => t.name as string);

    // Run as background task
    return taskManager.runTask({
      id: `merge-tags-${Date.now()}`,
      name: `Merge tags into "${targetName}"`,
      execute: async (onProgress) => {
        onProgress(0, 'Finding posts to update...');

        let totalPostsUpdated = 0;

        // For each source tag, update posts and delete the tag
        for (let i = 0; i < sourceNames.length; i++) {
          const sourceName = sourceNames[i];
          onProgress((i / sourceNames.length) * 80, `Processing tag "${sourceName}"...`);

          // Find posts with this source tag
          const postsResult = await client.execute({
            sql: `SELECT id, tags FROM posts WHERE project_id = ? AND tags LIKE ?`,
            args: [this.currentProjectId, `%"${sourceName}"%`],
          });

          for (const row of postsResult.rows) {
            const postId = row.id as string;
            const tags: string[] = JSON.parse((row as any).tags || '[]');
            
            if (tags.includes(sourceName)) {
              // Remove source tag and add target if not already present
              const newTags = tags.filter(t => t !== sourceName);
              if (!newTags.includes(targetName)) {
                newTags.push(targetName);
              }

              await client.execute({
                sql: 'UPDATE posts SET tags = ?, updated_at = ? WHERE id = ?',
                args: [JSON.stringify(newTags), Date.now(), postId],
              });

              totalPostsUpdated++;
            }
          }
        }

        onProgress(90, 'Deleting source tags...');

        // Delete source tags
        for (const id of sourceTagIds) {
          await client.execute({
            sql: 'DELETE FROM tags WHERE id = ? AND project_id = ?',
            args: [id, this.currentProjectId],
          });
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
    const client = getDatabase().getLocalClient();
    if (!client) throw new Error('Database not initialized');

    newName = newName.trim().toLowerCase();
    if (!newName) {
      throw new Error('New name is required');
    }

    // Get existing tag
    const tagResult = await client.execute({
      sql: 'SELECT * FROM tags WHERE id = ? AND project_id = ?',
      args: [id, this.currentProjectId],
    });

    if (tagResult.rows.length === 0) {
      throw new Error('Tag not found');
    }

    const tag = tagResult.rows[0] as any;
    const oldName = tag.name as string;

    if (oldName === newName) {
      return { success: true, postsUpdated: 0, oldName, newName };
    }

    // Check for duplicate
    const duplicateResult = await client.execute({
      sql: 'SELECT id FROM tags WHERE project_id = ? AND LOWER(name) = LOWER(?) AND id != ?',
      args: [this.currentProjectId, newName, id],
    });

    if (duplicateResult.rows.length > 0) {
      throw new Error(`Tag "${newName}" already exists`);
    }

    // Run as background task
    return taskManager.runTask({
      id: `rename-tag-${id}-${Date.now()}`,
      name: `Rename tag "${oldName}" to "${newName}"`,
      execute: async (onProgress) => {
        onProgress(0, 'Finding posts to update...');

        // Find posts with this tag
        const postsResult = await client.execute({
          sql: `SELECT id, tags FROM posts WHERE project_id = ? AND tags LIKE ?`,
          args: [this.currentProjectId, `%"${oldName}"%`],
        });

        const postsToUpdate = postsResult.rows.filter((row: any) => {
          const tags: string[] = JSON.parse(row.tags || '[]');
          return tags.includes(oldName);
        });

        const total = postsToUpdate.length;
        let updated = 0;

        for (const row of postsToUpdate) {
          const postId = row.id as string;
          const tags: string[] = JSON.parse((row as any).tags || '[]');
          const newTags = tags.map(t => t === oldName ? newName : t);

          await client.execute({
            sql: 'UPDATE posts SET tags = ?, updated_at = ? WHERE id = ?',
            args: [JSON.stringify(newTags), Date.now(), postId],
          });

          updated++;
          onProgress((updated / total) * 80, `Updated ${updated}/${total} posts...`);
        }

        onProgress(90, 'Updating tag record...');

        // Update the tag name
        await client.execute({
          sql: 'UPDATE tags SET name = ?, updated_at = ? WHERE id = ? AND project_id = ?',
          args: [newName, Date.now(), id, this.currentProjectId],
        });

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
    const client = getDatabase().getLocalClient();
    if (!client) return null;

    const result = await client.execute({
      sql: 'SELECT * FROM tags WHERE id = ? AND project_id = ?',
      args: [id, this.currentProjectId],
    });

    if (result.rows.length === 0) {
      return null;
    }

    return this.rowToTagData(result.rows[0] as any);
  }

  /**
   * Get a tag by name (case-insensitive)
   */
  async getTagByName(name: string): Promise<TagData | null> {
    const client = getDatabase().getLocalClient();
    if (!client) return null;

    const result = await client.execute({
      sql: 'SELECT * FROM tags WHERE project_id = ? AND LOWER(name) = LOWER(?)',
      args: [this.currentProjectId, name.trim().toLowerCase()],
    });

    if (result.rows.length === 0) {
      return null;
    }

    return this.rowToTagData(result.rows[0] as any);
  }

  /**
   * Get all tags for the current project
   */
  async getAllTags(): Promise<TagData[]> {
    const client = getDatabase().getLocalClient();
    if (!client) return [];

    const result = await client.execute({
      sql: 'SELECT * FROM tags WHERE project_id = ? ORDER BY name ASC',
      args: [this.currentProjectId],
    });

    return result.rows.map((row: any) => this.rowToTagData(row));
  }

  /**
   * Get post IDs that have a specific tag
   */
  async getPostsWithTag(tagId: string): Promise<string[]> {
    const client = getDatabase().getLocalClient();
    if (!client) return [];

    // First get the tag name
    const tagResult = await client.execute({
      sql: 'SELECT name FROM tags WHERE id = ? AND project_id = ?',
      args: [tagId, this.currentProjectId],
    });

    if (tagResult.rows.length === 0) {
      return [];
    }

    const tagName = (tagResult.rows[0] as any).name as string;

    // Find posts with this tag
    const postsResult = await client.execute({
      sql: `SELECT id, tags FROM posts WHERE project_id = ? AND tags LIKE ?`,
      args: [this.currentProjectId, `%"${tagName}"%`],
    });

    return postsResult.rows
      .filter((row: any) => {
        const tags: string[] = JSON.parse(row.tags || '[]');
        return tags.includes(tagName);
      })
      .map((row: any) => row.id as string);
  }

  /**
   * Sync tags from existing posts - discover tags that exist in posts but not in tags table
   */
  async syncTagsFromPosts(): Promise<SyncTagsResult> {
    const client = getDatabase().getLocalClient();
    if (!client) throw new Error('Database not initialized');

    // Get all tags from posts
    const postsResult = await client.execute({
      sql: 'SELECT tags FROM posts WHERE project_id = ?',
      args: [this.currentProjectId],
    });

    const discoveredTags = new Set<string>();
    for (const row of postsResult.rows) {
      const tags: string[] = JSON.parse((row as any).tags || '[]');
      for (const tag of tags) {
        if (tag.trim()) {
          discoveredTags.add(tag.trim().toLowerCase());
        }
      }
    }

    // Get existing tags
    const existingResult = await client.execute({
      sql: 'SELECT name FROM tags WHERE project_id = ?',
      args: [this.currentProjectId],
    });

    const existingNames = new Set(existingResult.rows.map((row: any) => (row.name as string).toLowerCase()));

    // Find missing tags
    const missingTags = Array.from(discoveredTags).filter(t => !existingNames.has(t));
    const added: string[] = [];

    // Add missing tags
    const now = Date.now();
    for (const tagName of missingTags) {
      await client.execute({
        sql: 'INSERT INTO tags (id, project_id, name, color, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)',
        args: [uuidv4(), this.currentProjectId, tagName, now, now],
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
  private rowToTagData(row: any): TagData {
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      color: row.color || undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Save tags to filesystem in portable format (no internal IDs).
   * Format: [{ name: "tag", color?: "#hex" }, ...]
   */
  private async saveTagsToFile(): Promise<void> {
    try {
      const tags = await this.getAllTags();
      const filePath = this.getTagsFilePath();
      const dir = path.dirname(filePath);

      // Serialize to portable format - only name and optional color
      const serialized: SerializedTag[] = tags.map(tag => {
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

      const client = getDatabase().getLocalClient();
      if (!client) return;

      const now = Date.now();

      for (const tag of rawTags) {
        // Support both portable format { name, color? } and legacy format with id
        const name = (tag.name || '').trim().toLowerCase();
        if (!name) continue;

        const color = tag.color || null;

        // Check if tag with this name already exists
        const existing = await client.execute({
          sql: 'SELECT id FROM tags WHERE project_id = ? AND LOWER(name) = LOWER(?)',
          args: [this.currentProjectId, name],
        });

        if (existing.rows.length === 0) {
          // Create new tag with fresh ID
          await client.execute({
            sql: 'INSERT INTO tags (id, project_id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
            args: [uuidv4(), this.currentProjectId, name, color, now, now],
          });
        } else if (color) {
          // Update color if provided and tag exists
          await client.execute({
            sql: 'UPDATE tags SET color = ?, updated_at = ? WHERE project_id = ? AND LOWER(name) = LOWER(?)',
            args: [color, now, this.currentProjectId, name],
          });
        }
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error('[TagEngine] Failed to load tags from file:', error);
      }
    }
  }
}
