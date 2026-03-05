import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import { eq } from 'drizzle-orm';
import { getDatabase } from '../database';
import { posts, projects } from '../database/schema';
import { sanitizePicoTheme, type PicoThemeName } from '../shared/picoThemes';
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
  publicUrl?: string; // Public base URL for the published blog (e.g., https://example.com)
  mainLanguage?: string; // Main language for AI-generated content (ISO code, e.g., 'en', 'de', 'es')
  defaultAuthor?: string; // Default author for new posts and media
  maxPostsPerPage?: number; // Preview/server maximum posts per page (default 50)
  blogmarkCategory?: string; // Category used for externally captured bookmark posts
  pythonRuntimeMode?: 'webworker' | 'main-thread'; // Runtime mode for Python script execution
  picoTheme?: PicoThemeName; // Selected Pico CSS theme for preview/rendering
  categoryMetadata?: Record<string, CategoryMetadata>; // Per-category metadata for UI/rendering
  categorySettings?: Record<string, CategoryRenderSettings>; // Per-category list rendering preferences
  semanticSimilarityEnabled?: boolean; // Enable local ONNX embedding-based semantic similarity
}

export interface CategoryRenderSettings {
  renderInLists: boolean;
  showTitle: boolean;
  postTemplateSlug?: string;
  listTemplateSlug?: string;
}

/**
 * Publishing preferences stored in meta/publishing.json.
 * Contains only non-secret connection details that can be shared among collaborators.
 */
export interface PublishingPreferences {
  sshHost: string;
  sshUser: string;
  sshRemotePath: string;
  sshMode: 'scp' | 'rsync';
}

export interface CategoryMetadata extends CategoryRenderSettings {
  title: string;
}

const DEFAULT_MAX_POSTS_PER_PAGE = 50;
const MIN_MAX_POSTS_PER_PAGE = 1;
const MAX_MAX_POSTS_PER_PAGE = 500;

function sanitizeMaxPostsPerPage(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_MAX_POSTS_PER_PAGE;
  }

  const rounded = Math.floor(numeric);
  if (rounded < MIN_MAX_POSTS_PER_PAGE) {
    return DEFAULT_MAX_POSTS_PER_PAGE;
  }
  if (rounded > MAX_MAX_POSTS_PER_PAGE) {
    return MAX_MAX_POSTS_PER_PAGE;
  }

  return rounded;
}

function sanitizePublicUrl(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizePublishingPreferences(prefs: PublishingPreferences): PublishingPreferences {
  return {
    sshHost: String(prefs.sshHost ?? '').trim(),
    sshUser: String(prefs.sshUser ?? '').trim(),
    sshRemotePath: String(prefs.sshRemotePath ?? '').trim(),
    sshMode: prefs.sshMode === 'rsync' ? 'rsync' : 'scp',
  };
}

function sanitizeCategoryTitle(value: unknown, fallback: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : fallback;
}

type RawCategoryMetadataInput = Record<string, CategoryMetadata | CategoryRenderSettings>;

function normalizeProjectMetadata(metadata: ProjectMetadata): ProjectMetadata {
  const maxPostsPerPage = sanitizeMaxPostsPerPage(metadata.maxPostsPerPage);
  const publicUrl = sanitizePublicUrl(metadata.publicUrl);
  const blogmarkCategory = typeof metadata.blogmarkCategory === 'string'
    ? normalizeNonEmptyTaxonomyTerm(metadata.blogmarkCategory) ?? undefined
    : undefined;
  const pythonRuntimeMode = metadata.pythonRuntimeMode === 'main-thread' ? 'main-thread' : 'webworker';
  const picoTheme = sanitizePicoTheme(metadata.picoTheme);
  const categoryMetadata = normalizeCategoryMetadata(metadata.categoryMetadata ?? metadata.categorySettings);
  return {
    ...metadata,
    publicUrl,
    maxPostsPerPage,
    blogmarkCategory,
    pythonRuntimeMode,
    picoTheme,
    categoryMetadata,
    categorySettings: undefined,
  };
}

/**
 * Default categories for new projects (from VISION.md)
 */
export const DEFAULT_CATEGORIES = ['article', 'picture', 'aside', 'page'];

export function getDefaultCategorySettings(): Record<string, CategoryRenderSettings> {
  const defaults = getDefaultCategoryMetadata();
  return Object.fromEntries(
    Object.entries(defaults).map(([category, value]) => [
      category,
      { renderInLists: value.renderInLists, showTitle: value.showTitle },
    ]),
  );
}

export function getDefaultCategoryMetadata(): Record<string, CategoryMetadata> {
  return {
    article: { renderInLists: true, showTitle: true, title: 'article' },
    picture: { renderInLists: true, showTitle: true, title: 'picture' },
    aside: { renderInLists: true, showTitle: false, title: 'aside' },
    page: { renderInLists: false, showTitle: true, title: 'page' },
  };
}

function normalizeCategoryMetadata(value: unknown): Record<string, CategoryMetadata> {
  const defaults = getDefaultCategoryMetadata();
  if (!value || typeof value !== 'object') {
    return defaults;
  }

  const normalized: Record<string, CategoryMetadata> = { ...defaults };
  for (const [rawCategory, rawSettings] of Object.entries(value as RawCategoryMetadataInput)) {
    const category = normalizeTaxonomyTerm(rawCategory);
    if (!category || !rawSettings || typeof rawSettings !== 'object') {
      continue;
    }

    const settings = rawSettings as unknown as {
      renderInLists?: unknown;
      showTitle?: unknown;
      title?: unknown;
    };
    normalized[category] = {
      renderInLists: settings.renderInLists !== false,
      showTitle: settings.showTitle !== false,
      title: sanitizeCategoryTitle(settings.title, category),
      postTemplateSlug: typeof (settings as any).postTemplateSlug === 'string' ? (settings as any).postTemplateSlug : undefined,
      listTemplateSlug: typeof (settings as any).listTemplateSlug === 'string' ? (settings as any).listTemplateSlug : undefined,
    };
  }

  return normalized;
}

function normalizeCategorySettings(value: unknown): Record<string, CategoryRenderSettings> {
  const metadata = normalizeCategoryMetadata(value);
  return Object.fromEntries(
    Object.entries(metadata).map(([category, data]) => [
      category,
      {
        renderInLists: data.renderInLists,
        showTitle: data.showTitle,
        postTemplateSlug: data.postTemplateSlug,
        listTemplateSlug: data.listTemplateSlug,
      },
    ]),
  );
}

function isJsonParseError(error: unknown): boolean {
  return error instanceof SyntaxError;
}

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
  private publishingPreferences: PublishingPreferences | null = null;
  private initialized: boolean = false;
  private startupSyncPromise: Promise<void> | null = null;

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

  private getCategoryMetadataFilePath(): string {
    return path.join(this.getMetaDir(), 'category-meta.json');
  }

  private getPublishingPreferencesFilePath(): string {
    return path.join(this.getMetaDir(), 'publishing.json');
  }

  setProjectContext(projectId: string, dataDir?: string): void {
    const nextDataDir = dataDir || null;
    if (this.currentProjectId === projectId && this.dataDir === nextDataDir) {
      return;
    }

    this.currentProjectId = projectId;
    this.dataDir = nextDataDir;
    // Reset in-memory cache when project changes
    this.tags.clear();
    this.categories.clear();
    this.projectMetadata = null;
    this.publishingPreferences = null;
    this.initialized = false;
    this.startupSyncPromise = null;
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
    this.projectMetadata = normalizeProjectMetadata({ ...metadata });
    this.projectMetadata.categoryMetadata = this.ensureCategoryMetadataForKnownCategories(
      this.projectMetadata.categoryMetadata,
    );
    await this.saveProjectMetadata();
    await this.saveCategoryMetadata();
    this.emit('projectMetadataChanged', this.projectMetadata);
  }

  /**
   * Update specific fields of project metadata.
   */
  async updateProjectMetadata(updates: Partial<ProjectMetadata>): Promise<void> {
    const normalizedUpdates: Partial<ProjectMetadata> = { ...updates };
    if (updates.maxPostsPerPage !== undefined) {
      normalizedUpdates.maxPostsPerPage = sanitizeMaxPostsPerPage(updates.maxPostsPerPage);
    }
    if (updates.picoTheme !== undefined) {
      normalizedUpdates.picoTheme = sanitizePicoTheme(updates.picoTheme);
    }

    if (updates.categoryMetadata !== undefined || updates.categorySettings !== undefined) {
      normalizedUpdates.categoryMetadata = normalizeCategoryMetadata(
        updates.categoryMetadata ?? updates.categorySettings,
      );
      normalizedUpdates.categorySettings = undefined;
    }

    if (!this.projectMetadata) {
      this.projectMetadata = normalizeProjectMetadata({
        name: normalizedUpdates.name || '',
        description: normalizedUpdates.description,
        dataPath: normalizedUpdates.dataPath,
        publicUrl: normalizedUpdates.publicUrl,
        mainLanguage: normalizedUpdates.mainLanguage,
        defaultAuthor: normalizedUpdates.defaultAuthor,
        maxPostsPerPage: normalizedUpdates.maxPostsPerPage,
        blogmarkCategory: normalizedUpdates.blogmarkCategory,
        pythonRuntimeMode: normalizedUpdates.pythonRuntimeMode,
        picoTheme: normalizedUpdates.picoTheme,
        categoryMetadata: normalizedUpdates.categoryMetadata,
        semanticSimilarityEnabled: normalizedUpdates.semanticSimilarityEnabled,
      });
    } else {
      this.projectMetadata = normalizeProjectMetadata({
        ...this.projectMetadata,
        ...normalizedUpdates,
      });
    }
    this.projectMetadata.categoryMetadata = this.ensureCategoryMetadataForKnownCategories(
      this.projectMetadata.categoryMetadata,
    );
    await this.saveProjectMetadata();
    await this.saveCategoryMetadata();
    this.emit('projectMetadataChanged', this.projectMetadata);
  }

  // ── Publishing Preferences ───────────────────────────────────────────

  /**
   * Get publishing preferences for the current project.
   */
  async getPublishingPreferences(): Promise<PublishingPreferences | null> {
    return this.publishingPreferences;
  }

  /**
   * Set publishing preferences for the current project.
   * Persists to meta/publishing.json so they can be shared across collaborators.
   */
  async setPublishingPreferences(prefs: PublishingPreferences): Promise<void> {
    this.publishingPreferences = normalizePublishingPreferences(prefs);
    await this.savePublishingPreferences();
    this.emit('publishingPreferencesChanged', this.publishingPreferences);
  }

  /**
   * Clear publishing preferences for the current project.
   * Removes meta/publishing.json.
   */
  async clearPublishingPreferences(): Promise<void> {
    this.publishingPreferences = null;
    try {
      const filePath = this.getPublishingPreferencesFilePath();
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[MetaEngine] Failed to delete publishing preferences:', error);
        throw error;
      }
    }
    this.emit('publishingPreferencesChanged', null);
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
      const currentMetadata = this.projectMetadata;
      if (currentMetadata) {
        const currentCategoryMetadata = normalizeCategoryMetadata(currentMetadata.categoryMetadata ?? currentMetadata.categorySettings);
        if (!currentCategoryMetadata[normalizedCategory]) {
          currentCategoryMetadata[normalizedCategory] = {
            renderInLists: true,
            showTitle: true,
            title: normalizedCategory,
          };
          this.projectMetadata = normalizeProjectMetadata({
            ...currentMetadata,
            categoryMetadata: currentCategoryMetadata,
          });
          await this.saveProjectMetadata();
          await this.saveCategoryMetadata();
        }
      }
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
      const currentMetadata = this.projectMetadata;
      const currentCategoryMetadata = currentMetadata
        ? normalizeCategoryMetadata(currentMetadata.categoryMetadata ?? currentMetadata.categorySettings)
        : null;
      if (currentMetadata && currentCategoryMetadata?.[normalizedCategory]) {
        const nextCategoryMetadata = { ...currentCategoryMetadata };
        delete nextCategoryMetadata[normalizedCategory];
        this.projectMetadata = normalizeProjectMetadata({
          ...currentMetadata,
          categoryMetadata: nextCategoryMetadata,
        });
        await this.saveProjectMetadata();
        await this.saveCategoryMetadata();
      }
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
      await this.writeJsonFileAtomically(filePath, Array.from(this.categories).sort());
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
      const {
        dataPath: _dataPath,
        categoryMetadata: _categoryMetadata,
        categorySettings: _categorySettings,
        ...persistedMetadata
      } = this.projectMetadata || {};
      await this.writeJsonFileAtomically(filePath, persistedMetadata);
    } catch (error) {
      console.error('[MetaEngine] Failed to save project metadata:', error);
      throw error;
    }
  }

  /**
   * Save category metadata to the filesystem.
   */
  async saveCategoryMetadata(): Promise<void> {
    try {
      await this.ensureMetaDirExists();
      const filePath = this.getCategoryMetadataFilePath();
      const metadata = this.ensureCategoryMetadataForKnownCategories(
        this.projectMetadata?.categoryMetadata,
      );
      await this.writeJsonFileAtomically(filePath, metadata);
    } catch (error) {
      console.error('[MetaEngine] Failed to save category metadata:', error);
      throw error;
    }
  }

  /**
   * Save publishing preferences to the filesystem.
   */
  private async savePublishingPreferences(): Promise<void> {
    if (!this.publishingPreferences) {
      return;
    }
    try {
      await this.ensureMetaDirExists();
      const filePath = this.getPublishingPreferencesFilePath();
      await this.writeJsonFileAtomically(filePath, this.publishingPreferences);
    } catch (error) {
      console.error('[MetaEngine] Failed to save publishing preferences:', error);
      throw error;
    }
  }

  /**
   * Load publishing preferences from the filesystem.
   */
  private async loadPublishingPreferences(): Promise<void> {
    try {
      const filePath = this.getPublishingPreferencesFilePath();
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content) as PublishingPreferences;
      this.publishingPreferences = normalizePublishingPreferences(parsed);
    } catch (error) {
      if (isJsonParseError(error)) {
        console.warn('[MetaEngine] Failed to parse publishing preferences JSON, using null:', error);
        this.publishingPreferences = null;
        return;
      }
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[MetaEngine] Failed to load publishing preferences:', error);
        throw error;
      }
      // File doesn't exist, that's OK
      this.publishingPreferences = null;
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
      this.projectMetadata = normalizeProjectMetadata(parsed);
    } catch (error) {
      if (isJsonParseError(error)) {
        console.warn('[MetaEngine] Failed to parse project metadata JSON, using null metadata:', error);
        this.projectMetadata = null;
        return;
      }
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[MetaEngine] Failed to load project metadata:', error);
        throw error;
      }
      // File doesn't exist, that's OK
      this.projectMetadata = null;
    }
  }

  /**
   * Load category metadata from the filesystem.
   */
  async loadCategoryMetadata(): Promise<Record<string, CategoryMetadata> | null> {
    try {
      const filePath = this.getCategoryMetadataFilePath();
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content) as Record<string, unknown>;
      return normalizeCategoryMetadata(parsed);
    } catch (error) {
      if (isJsonParseError(error)) {
        console.warn('[MetaEngine] Failed to parse category metadata JSON, using default metadata merge:', error);
        return null;
      }
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[MetaEngine] Failed to load category metadata:', error);
        throw error;
      }
      return null;
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
      if (isJsonParseError(error)) {
        console.warn('[MetaEngine] Failed to parse categories JSON, treating as empty and rebuilding from DB/defaults:', error);
        this.categories.clear();
        return;
      }
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

  private async writeJsonFileAtomically(filePath: string, value: unknown): Promise<void> {
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const content = JSON.stringify(value, null, 2);

    await fs.writeFile(tempPath, content, 'utf-8');

    try {
      await fs.rename(tempPath, filePath);
    } catch (error) {
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors.
      }
      throw error;
    }
  }

  private ensureCategoryMetadataForKnownCategories(
    categoryMetadata: Record<string, CategoryMetadata> | undefined,
  ): Record<string, CategoryMetadata> {
    const merged = normalizeCategoryMetadata(categoryMetadata);

    for (const category of this.categories) {
      if (!merged[category]) {
        merged[category] = {
          renderInLists: true,
          showTitle: true,
          title: category,
        };
      } else if (!merged[category].title || merged[category].title.trim().length === 0) {
        merged[category].title = category;
      }
    }

    return merged;
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
    if (this.initialized) {
      return;
    }

    if (this.startupSyncPromise) {
      await this.startupSyncPromise;
      return;
    }

    this.startupSyncPromise = this.performSyncOnStartup();
    try {
      await this.startupSyncPromise;
    } finally {
      this.startupSyncPromise = null;
    }
  }

  private async performSyncOnStartup(): Promise<void> {
    console.log(`[MetaEngine] Syncing metadata for project: ${this.currentProjectId}`);
    
    await this.ensureMetaDirExists();
    
    const categoriesFilePath = this.getCategoriesFilePath();
    const projectMetadataFilePath = this.getProjectMetadataFilePath();
    const categoryMetadataFilePath = this.getCategoryMetadataFilePath();
    
    const categoriesFileExists = await this.fileExists(categoriesFilePath);
    const projectMetadataFileExists = await this.fileExists(projectMetadataFilePath);
    const categoryMetadataFileExists = await this.fileExists(categoryMetadataFilePath);
    
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
      if (!this.projectMetadata) {
        const projectData = await this.fetchProjectFromDatabase();
        if (!projectData) {
          throw new Error(`Project not found in database: ${this.currentProjectId}`);
        }
        this.projectMetadata = {
          name: projectData.name,
          description: projectData.description || undefined,
          maxPostsPerPage: DEFAULT_MAX_POSTS_PER_PAGE,
        };
        await this.saveProjectMetadata();
      }
      if (this.projectMetadata?.dataPath !== undefined) {
        const { dataPath: _dataPath, ...metadataWithoutDataPath } = this.projectMetadata;
        this.projectMetadata = metadataWithoutDataPath;
        await this.saveProjectMetadata();
        console.log('[MetaEngine] Removed deprecated dataPath from project.json');
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
        maxPostsPerPage: DEFAULT_MAX_POSTS_PER_PAGE,
      };
      await this.saveProjectMetadata();
    }

    if (this.projectMetadata) {
      const legacyCategoryMetadata = normalizeCategoryMetadata(
        this.projectMetadata.categoryMetadata ?? this.projectMetadata.categorySettings,
      );
      const fileCategoryMetadata = categoryMetadataFileExists
        ? await this.loadCategoryMetadata()
        : null;
      const mergedCategoryMetadata = this.ensureCategoryMetadataForKnownCategories(
        fileCategoryMetadata ?? legacyCategoryMetadata,
      );

      this.projectMetadata = normalizeProjectMetadata({
        ...this.projectMetadata,
        categoryMetadata: mergedCategoryMetadata,
      });

      await this.saveProjectMetadata();
      await this.saveCategoryMetadata();
    }

    // Handle publishing preferences (load from file if it exists)
    await this.loadPublishingPreferences();
    
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

