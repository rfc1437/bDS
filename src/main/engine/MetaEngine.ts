import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import { eq } from 'drizzle-orm';
import { getDatabase } from '../database';
import { posts, projects } from '../database/schema';
import {
  normalizeTaxonomyTerm,
  normalizeNonEmptyTaxonomyTerm,
  collectNormalizedTermsFromJsonValues,
} from './taxonomyUtils';

/**
 * Project metadata stored in meta/project.json
 */
export interface ProjectMetadata {
  name: string;
  description?: string;
  dataPath?: string; // Custom path for project data
  mainLanguage?: string; // Main language for AI-generated content (ISO code, e.g., 'en', 'de', 'es')
  defaultAuthor?: string; // Default author for new posts and media
}

/**
 * Default categories for new projects (from VISION.md)
 */
export const DEFAULT_CATEGORIES = ['article', 'picture', 'aside', 'page'];

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
  private dataDir: string | null = null; // Custom data directory (null = use internal userData)
  private tags: Set<string> = new Set();
  private categories: Set<string> = new Set();
  private projectMetadata: ProjectMetadata | null = null;
  private initialized: boolean = false;

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
   * Get the meta directory path for the current project.
   * Uses custom dataDir if set, otherwise internal userData.
   */
  getMetaDir(): string {
    return path.join(this.getBaseDir(), 'meta');
  }

  private getCategoriesFilePath(): string {
    return path.join(this.getMetaDir(), 'categories.json');
  }

  private getProjectMetadataFilePath(): string {
    return path.join(this.getMetaDir(), 'project.json');
  }

  setProjectContext(projectId: string, dataDir?: string): void {
    this.currentProjectId = projectId;
    this.dataDir = dataDir || null;
    // Reset in-memory cache when project changes
    this.tags.clear();
    this.categories.clear();
    this.projectMetadata = null;
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
   * Get the project metadata.
   */
  async getProjectMetadata(): Promise<ProjectMetadata | null> {
    return this.projectMetadata;
  }

  /**
   * Set the project metadata (replaces existing).
   */
  async setProjectMetadata(metadata: ProjectMetadata): Promise<void> {
    this.projectMetadata = { ...metadata };
    await this.saveProjectMetadata();
    this.emit('projectMetadataChanged', this.projectMetadata);
  }

  /**
   * Update specific fields of project metadata.
   */
  async updateProjectMetadata(updates: Partial<ProjectMetadata>): Promise<void> {
    if (!this.projectMetadata) {
      this.projectMetadata = {
        name: updates.name || '',
        description: updates.description,
      };
    } else {
      this.projectMetadata = {
        ...this.projectMetadata,
        ...updates,
      };
    }
    await this.saveProjectMetadata();
    this.emit('projectMetadataChanged', this.projectMetadata);
  }

  /**
   * Add a new tag to the available tags list (in-memory only).
   * Note: Tag persistence is handled by TagEngine.
   */
  async addTag(tag: string): Promise<void> {
    const normalizedTag = normalizeTaxonomyTerm(tag);
    if (normalizedTag && !this.tags.has(normalizedTag)) {
      this.tags.add(normalizedTag);
      this.emit('tagsChanged', await this.getTags());
    }
  }

  /**
   * Remove a tag from the available tags list (in-memory only).
   * Note: Tag persistence is handled by TagEngine.
   */
  async removeTag(tag: string): Promise<void> {
    const normalizedTag = normalizeTaxonomyTerm(tag);
    if (this.tags.delete(normalizedTag)) {
      this.emit('tagsChanged', await this.getTags());
    }
  }

  /**
   * Add a new category to the available categories list.
   */
  async addCategory(category: string): Promise<void> {
    const normalizedCategory = normalizeTaxonomyTerm(category);
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
    const normalizedCategory = normalizeTaxonomyTerm(category);
    if (this.categories.delete(normalizedCategory)) {
      this.emit('categoriesChanged', await this.getCategories());
      await this.saveCategories();
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
   * Save project metadata to the filesystem.
   */
  async saveProjectMetadata(): Promise<void> {
    try {
      await this.ensureMetaDirExists();
      const filePath = this.getProjectMetadataFilePath();
      const content = JSON.stringify(this.projectMetadata, null, 2);
      await fs.writeFile(filePath, content, 'utf-8');
    } catch (error) {
      console.error('[MetaEngine] Failed to save project metadata:', error);
      throw error;
    }
  }

  /**
   * Load project metadata from the filesystem.
   */
  async loadProjectMetadata(): Promise<void> {
    try {
      const filePath = this.getProjectMetadataFilePath();
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content) as ProjectMetadata;
      this.projectMetadata = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[MetaEngine] Failed to load project metadata:', error);
        throw error;
      }
      // File doesn't exist, that's OK
      this.projectMetadata = null;
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
        const normalizedCategory = normalizeNonEmptyTaxonomyTerm(cat);
        if (normalizedCategory) {
          this.categories.add(normalizedCategory);
        }
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

    return collectNormalizedTermsFromJsonValues(dbPosts.map((row) => row.tags));
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

    return collectNormalizedTermsFromJsonValues(dbPosts.map((row) => row.categories));
  }

  /**
   * Fetch the current project's data from the database.
   */
  private async fetchProjectFromDatabase(): Promise<{ name: string; description: string | null; dataPath: string | null } | null> {
    const db = getDatabase().getLocal();
    const project = await db
      .select({ name: projects.name, description: projects.description, dataPath: projects.dataPath })
      .from(projects)
      .where(eq(projects.id, this.currentProjectId))
      .get();

    return project || null;
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
   * - Tags: populated from posts (TagEngine handles persistence with colors)
   * - Categories: read from file, merge with database
   * - Project metadata: read from file or create from database
   */
  async syncOnStartup(): Promise<void> {
    console.log(`[MetaEngine] Syncing metadata for project: ${this.currentProjectId}`);
    
    await this.ensureMetaDirExists();
    
    const categoriesFilePath = this.getCategoriesFilePath();
    const projectMetadataFilePath = this.getProjectMetadataFilePath();
    
    const categoriesFileExists = await this.fileExists(categoriesFilePath);
    const projectMetadataFileExists = await this.fileExists(projectMetadataFilePath);
    
    // Collect tags/categories from database (posts)
    const dbTags = await this.collectTagsFromPosts();
    const dbCategories = await this.collectCategoriesFromPosts();
    
    // Handle tags - just populate from posts, TagEngine handles persistence
    this.tags.clear();
    for (const tag of dbTags) {
      this.tags.add(tag);
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
      // No file exists, create from database or use defaults
      this.categories.clear();
      if (dbCategories.length > 0) {
        for (const cat of dbCategories) {
          this.categories.add(cat);
        }
      } else {
        // New project with no posts - use default categories
        for (const cat of DEFAULT_CATEGORIES) {
          this.categories.add(cat);
        }
      }
      await this.saveCategories();
    }
    
    // Handle project metadata
    if (projectMetadataFileExists) {
      await this.loadProjectMetadata();

      // Keep dataPath authoritative in database (selected folder path on create/open).
      // If project.json has a stale dataPath, update project.json from database.
      const projectData = await this.fetchProjectFromDatabase();
      if (!projectData) {
        throw new Error(`Project not found in database: ${this.currentProjectId}`);
      }

      const databaseDataPath = projectData.dataPath || undefined;
      if (this.projectMetadata && this.projectMetadata.dataPath !== databaseDataPath) {
        this.projectMetadata = {
          ...this.projectMetadata,
          dataPath: databaseDataPath,
        };
        await this.saveProjectMetadata();
        console.log(`[MetaEngine] Synced dataPath from database to project.json: ${databaseDataPath || '(default)'}`);
      }
    } else {
      // No file exists, fetch project data from database and create file
      const projectData = await this.fetchProjectFromDatabase();
      if (!projectData) {
        throw new Error(`Project not found in database: ${this.currentProjectId}`);
      }
      this.projectMetadata = {
        name: projectData.name,
        description: projectData.description || undefined,
        dataPath: projectData.dataPath || undefined,
      };
      await this.saveProjectMetadata();
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
