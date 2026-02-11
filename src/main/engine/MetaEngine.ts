import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import { eq } from 'drizzle-orm';
import { getDatabase } from '../database';
import { posts } from '../database/schema';

/**
 * MetaEngine manages project metadata like available tags and categories.
 * 
 * It keeps metadata in sync between:
 * - The database (derived from posts)
 * - The filesystem (meta/tags.json, meta/categories.json)
 * 
 * This enables offline-first operation where all metadata is available
 * from the local filesystem per project.
 */
export class MetaEngine extends EventEmitter {
  private currentProjectId: string = 'default';
  private tags: Set<string> = new Set();
  private categories: Set<string> = new Set();
  private initialized: boolean = false;

  constructor() {
    super();
  }

  /**
   * Get the meta directory path for the current project.
   * Format: {userData}/projects/{projectId}/meta/
   */
  getMetaDir(): string {
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, 'projects', this.currentProjectId, 'meta');
  }

  private getTagsFilePath(): string {
    return path.join(this.getMetaDir(), 'tags.json');
  }

  private getCategoriesFilePath(): string {
    return path.join(this.getMetaDir(), 'categories.json');
  }

  setProjectContext(projectId: string): void {
    this.currentProjectId = projectId;
    // Reset in-memory cache when project changes
    this.tags.clear();
    this.categories.clear();
    this.initialized = false;
  }

  getProjectContext(): string {
    return this.currentProjectId;
  }

  /**
   * Get all available tags.
   */
  async getTags(): Promise<string[]> {
    return Array.from(this.tags).sort();
  }

  /**
   * Get all available categories.
   */
  async getCategories(): Promise<string[]> {
    return Array.from(this.categories).sort();
  }

  /**
   * Add a new tag to the available tags list.
   */
  async addTag(tag: string): Promise<void> {
    const normalizedTag = tag.trim().toLowerCase();
    if (normalizedTag && !this.tags.has(normalizedTag)) {
      this.tags.add(normalizedTag);
      this.emit('tagsChanged', await this.getTags());
      await this.saveTags();
    }
  }

  /**
   * Remove a tag from the available tags list.
   */
  async removeTag(tag: string): Promise<void> {
    const normalizedTag = tag.trim().toLowerCase();
    if (this.tags.delete(normalizedTag)) {
      this.emit('tagsChanged', await this.getTags());
      await this.saveTags();
    }
  }

  /**
   * Add a new category to the available categories list.
   */
  async addCategory(category: string): Promise<void> {
    const normalizedCategory = category.trim().toLowerCase();
    if (normalizedCategory && !this.categories.has(normalizedCategory)) {
      this.categories.add(normalizedCategory);
      this.emit('categoriesChanged', await this.getCategories());
      await this.saveCategories();
    }
  }

  /**
   * Remove a category from the available categories list.
   */
  async removeCategory(category: string): Promise<void> {
    const normalizedCategory = category.trim().toLowerCase();
    if (this.categories.delete(normalizedCategory)) {
      this.emit('categoriesChanged', await this.getCategories());
      await this.saveCategories();
    }
  }

  /**
   * Save tags to the filesystem.
   */
  async saveTags(): Promise<void> {
    try {
      await this.ensureMetaDirExists();
      const filePath = this.getTagsFilePath();
      const content = JSON.stringify(Array.from(this.tags).sort(), null, 2);
      await fs.writeFile(filePath, content, 'utf-8');
    } catch (error) {
      console.error('[MetaEngine] Failed to save tags:', error);
      throw error;
    }
  }

  /**
   * Save categories to the filesystem.
   */
  async saveCategories(): Promise<void> {
    try {
      await this.ensureMetaDirExists();
      const filePath = this.getCategoriesFilePath();
      const content = JSON.stringify(Array.from(this.categories).sort(), null, 2);
      await fs.writeFile(filePath, content, 'utf-8');
    } catch (error) {
      console.error('[MetaEngine] Failed to save categories:', error);
      throw error;
    }
  }

  /**
   * Load tags from the filesystem.
   */
  async loadTags(): Promise<void> {
    try {
      const filePath = this.getTagsFilePath();
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content) as string[];
      this.tags.clear();
      for (const tag of parsed) {
        this.tags.add(tag.trim().toLowerCase());
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[MetaEngine] Failed to load tags:', error);
        throw error;
      }
      // File doesn't exist, that's OK
    }
  }

  /**
   * Load categories from the filesystem.
   */
  async loadCategories(): Promise<void> {
    try {
      const filePath = this.getCategoriesFilePath();
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content) as string[];
      this.categories.clear();
      for (const cat of parsed) {
        this.categories.add(cat.trim().toLowerCase());
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[MetaEngine] Failed to load categories:', error);
        throw error;
      }
      // File doesn't exist, that's OK
    }
  }

  /**
   * Collect all unique tags from posts in the database.
   */
  async collectTagsFromPosts(): Promise<string[]> {
    const db = getDatabase().getLocal();
    const dbPosts = await db
      .select({ tags: posts.tags })
      .from(posts)
      .where(eq(posts.projectId, this.currentProjectId))
      .all();

    const allTags = new Set<string>();
    for (const row of dbPosts) {
      if (row.tags) {
        try {
          const parsed: string[] = JSON.parse(row.tags);
          for (const tag of parsed) {
            allTags.add(tag.trim().toLowerCase());
          }
        } catch {
          // Invalid JSON, skip
        }
      }
    }

    return Array.from(allTags).sort();
  }

  /**
   * Collect all unique categories from posts in the database.
   */
  async collectCategoriesFromPosts(): Promise<string[]> {
    const db = getDatabase().getLocal();
    const dbPosts = await db
      .select({ categories: posts.categories })
      .from(posts)
      .where(eq(posts.projectId, this.currentProjectId))
      .all();

    const allCategories = new Set<string>();
    for (const row of dbPosts) {
      if (row.categories) {
        try {
          const parsed: string[] = JSON.parse(row.categories);
          for (const cat of parsed) {
            allCategories.add(cat.trim().toLowerCase());
          }
        } catch {
          // Invalid JSON, skip
        }
      }
    }

    return Array.from(allCategories).sort();
  }

  /**
   * Ensure the meta directory exists.
   */
  private async ensureMetaDirExists(): Promise<void> {
    const metaDir = this.getMetaDir();
    try {
      await fs.access(metaDir);
    } catch {
      await fs.mkdir(metaDir, { recursive: true });
    }
  }

  /**
   * Check if a file exists.
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Sync tags and categories on startup.
   * 
   * Logic:
   * 1. If files don't exist: export from database (posts) to files
   * 2. If files exist: read from files, merge with database, save any changes
   */
  async syncOnStartup(): Promise<void> {
    console.log(`[MetaEngine] Syncing metadata for project: ${this.currentProjectId}`);
    
    await this.ensureMetaDirExists();
    
    const tagsFilePath = this.getTagsFilePath();
    const categoriesFilePath = this.getCategoriesFilePath();
    
    const tagsFileExists = await this.fileExists(tagsFilePath);
    const categoriesFileExists = await this.fileExists(categoriesFilePath);
    
    // Collect tags/categories from database (posts)
    const dbTags = await this.collectTagsFromPosts();
    const dbCategories = await this.collectCategoriesFromPosts();
    
    // Handle tags
    if (tagsFileExists) {
      // Load from file
      await this.loadTags();
      const fileTags = new Set(this.tags);
      
      // Merge: add any tags from DB that aren't in file
      let changed = false;
      for (const tag of dbTags) {
        if (!fileTags.has(tag)) {
          this.tags.add(tag);
          changed = true;
        }
      }
      
      // Save if there were changes
      if (changed) {
        await this.saveTags();
      }
    } else {
      // No file exists, create from database
      this.tags.clear();
      for (const tag of dbTags) {
        this.tags.add(tag);
      }
      await this.saveTags();
    }
    
    // Handle categories
    if (categoriesFileExists) {
      // Load from file
      await this.loadCategories();
      const fileCategories = new Set(this.categories);
      
      // Merge: add any categories from DB that aren't in file
      let changed = false;
      for (const cat of dbCategories) {
        if (!fileCategories.has(cat)) {
          this.categories.add(cat);
          changed = true;
        }
      }
      
      // Save if there were changes
      if (changed) {
        await this.saveCategories();
      }
    } else {
      // No file exists, create from database
      this.categories.clear();
      for (const cat of dbCategories) {
        this.categories.add(cat);
      }
      await this.saveCategories();
    }
    
    this.initialized = true;
    console.log(`[MetaEngine] Sync complete. Tags: ${this.tags.size}, Categories: ${this.categories.size}`);
  }

  /**
   * Check if the engine has been initialized (synced on startup).
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

// Singleton instance
let metaEngineInstance: MetaEngine | null = null;

export function getMetaEngine(): MetaEngine {
  if (!metaEngineInstance) {
    metaEngineInstance = new MetaEngine();
  }
  return metaEngineInstance;
}
