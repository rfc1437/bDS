import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import matter from 'gray-matter';
import { eq, and, desc, gte, lte, like, inArray } from 'drizzle-orm';
import { app } from 'electron';
import { getDatabase } from '../database';
import { posts, Post, NewPost, postLinks } from '../database/schema';
import { taskManager, Task } from './TaskManager';
import { stemText, stemQuery, SupportedLanguage } from './stemmer';

export interface PostData {
  id: string;
  projectId: string;
  title: string;
  slug: string;
  excerpt?: string;
  content: string;
  status: 'draft' | 'published' | 'archived';
  author?: string;
  createdAt: Date;
  updatedAt: Date;
  publishedAt?: Date;
  tags: string[];
  categories: string[];
}

export interface PostMetadata {
  id: string;
  projectId: string;
  title: string;
  slug: string;
  excerpt?: string;
  status: 'draft' | 'published' | 'archived';
  author?: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  tags: string[];
  categories: string[];
}

export interface SearchResult {
  id: string;
  title: string;
  slug: string;
  excerpt?: string;
}

export interface PostFilter {
  status?: 'draft' | 'published' | 'archived';
  tags?: string[];
  categories?: string[];
  startDate?: Date;
  endDate?: Date;
  year?: number;
  month?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  hasMore: boolean;
  total: number;
}

export interface PaginationOptions {
  limit?: number;
  offset?: number;
}

export class PostEngine extends EventEmitter {
  private currentProjectId: string = 'default';
  private searchLanguage: SupportedLanguage = 'english';

  constructor() {
    super();
  }

  /**
   * Set the language used for full-text search stemming.
   * Affects both indexing and query processing.
   */
  setSearchLanguage(language: SupportedLanguage): void {
    this.searchLanguage = language;
  }

  /**
   * Get the current search language.
   */
  getSearchLanguage(): SupportedLanguage {
    return this.searchLanguage;
  }

  /**
   * Update the FTS index for a post.
   * Updates the FTS index for a post.
   * Stores the stemmed content (combining title, excerpt, content, tags, categories).
   * Includes project_id for project-scoped search.
   * Only the post ID is returned from searches - actual post data comes from DB/files.
   */
  private async updateFTSIndex(post: {
    id: string;
    projectId: string;
    title: string;
    content: string;
    excerpt?: string;
    tags: string[];
    categories: string[];
  }): Promise<void> {
    const client = getDatabase().getLocalClient();
    if (!client) return;

    // Delete existing entry
    await client.execute({ sql: 'DELETE FROM posts_fts WHERE id = ?', args: [post.id] });

    // Combine all searchable fields and stem them
    const allText = [
      post.title,
      post.excerpt || '',
      post.content,
      post.tags.join(' '),
      post.categories.join(' '),
    ].join(' ');

    const stemmedContent = stemText(allText, this.searchLanguage);

    // Insert with id, project_id, and stemmed content
    await client.execute({
      sql: 'INSERT INTO posts_fts (id, project_id, content) VALUES (?, ?, ?)',
      args: [post.id, post.projectId, stemmedContent],
    });
  }

  /**
   * Delete a post from the FTS index.
   */
  private async deleteFTSIndex(id: string): Promise<void> {
    const client = getDatabase().getLocalClient();
    if (!client) return;
    await client.execute({ sql: 'DELETE FROM posts_fts WHERE id = ?', args: [id] });
  }

  private getPostsBaseDir(): string {
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, 'projects', this.currentProjectId, 'posts');
  }

  private getPostsDir(): string {
    // Kept for backwards compatibility - returns base posts directory
    return this.getPostsBaseDir();
  }

  /**
   * Get the date-based directory for a post based on its creation date.
   * Format: posts/YYYY/MM/
   */
  private getPostsDirForDate(date: Date): string {
    const baseDir = this.getPostsBaseDir();
    const year = date.getFullYear().toString();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    return path.join(baseDir, year, month);
  }

  /**
   * Get the full path for a post file based on slug and date.
   * Returns: posts/YYYY/MM/{slug}.md
   */
  getPostPath(slug: string, date: Date): string {
    const dir = this.getPostsDirForDate(date);
    return path.join(dir, `${slug}.md`);
  }

  setProjectContext(projectId: string): void {
    this.currentProjectId = projectId;
  }

  getProjectContext(): string {
    return this.currentProjectId;
  }

  private generateSlug(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  /**
   * Check if a slug is available (not used by any existing post)
   * @param slug The slug to check
   * @param excludePostId Optional post ID to exclude (for updates)
   */
  async isSlugAvailable(slug: string, excludePostId?: string): Promise<boolean> {
    const db = getDatabase().getLocal();
    const existing = await db
      .select({ id: posts.id })
      .from(posts)
      .where(and(
        eq(posts.slug, slug),
        eq(posts.projectId, this.currentProjectId)
      ))
      .get();
    
    if (!existing) return true;
    if (excludePostId && existing.id === excludePostId) return true;
    return false;
  }

  /**
   * Generate a unique slug based on a title
   * If the slug already exists, appends -2, -3, etc.
   */
  async generateUniqueSlug(title: string, excludePostId?: string): Promise<string> {
    const baseSlug = this.generateSlug(title || 'untitled');
    
    if (await this.isSlugAvailable(baseSlug, excludePostId)) {
      return baseSlug;
    }

    // Find next available number
    let counter = 2;
    while (counter < 1000) {
      const candidateSlug = `${baseSlug}-${counter}`;
      if (await this.isSlugAvailable(candidateSlug, excludePostId)) {
        return candidateSlug;
      }
      counter++;
    }

    // Fallback: add timestamp
    return `${baseSlug}-${Date.now()}`;
  }

  private calculateChecksum(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex');
  }

  private async writePostFile(post: PostData): Promise<string> {
    const metadata: Record<string, unknown> = {
      id: post.id,
      projectId: post.projectId,
      title: post.title,
      slug: post.slug,
      status: post.status,
      createdAt: post.createdAt.toISOString(),
      updatedAt: post.updatedAt.toISOString(),
      tags: post.tags,
      categories: post.categories,
    };

    // Only add optional fields if they have values (gray-matter can't serialize undefined)
    if (post.excerpt) metadata.excerpt = post.excerpt;
    if (post.author) metadata.author = post.author;
    if (post.publishedAt) metadata.publishedAt = post.publishedAt.toISOString();

    // Use date-based directory structure (posts/YYYY/MM/)
    const postsDir = this.getPostsDirForDate(post.createdAt);
    await fs.mkdir(postsDir, { recursive: true });
    
    const fileContent = matter.stringify(post.content, metadata);
    const filePath = path.join(postsDir, `${post.slug}.md`);
    
    await fs.writeFile(filePath, fileContent, 'utf-8');
    return filePath;
  }

  private async readPostFile(filePath: string): Promise<PostData | null> {
    try {
      // Check if file exists first to avoid noisy errors
      try {
        await fs.access(filePath);
      } catch {
        // File doesn't exist - this is expected when DB has stale paths
        return null;
      }

      const content = await fs.readFile(filePath, 'utf-8');
      const { data, content: body } = matter(content);
      const metadata = data as PostMetadata;

      return {
        id: metadata.id,
        projectId: metadata.projectId || this.currentProjectId,
        title: metadata.title,
        slug: metadata.slug,
        excerpt: metadata.excerpt,
        content: body,
        status: metadata.status,
        author: metadata.author,
        createdAt: new Date(metadata.createdAt),
        updatedAt: new Date(metadata.updatedAt),
        publishedAt: metadata.publishedAt ? new Date(metadata.publishedAt) : undefined,
        tags: metadata.tags || [],
        categories: metadata.categories || [],
      };
    } catch (error) {
      console.error(`Failed to parse post file: ${filePath}`, error);
      return null;
    }
  }

  async createPost(data: Partial<PostData>): Promise<PostData> {
    const db = getDatabase().getLocal();
    const client = getDatabase().getLocalClient();
    const now = new Date();
    const id = uuidv4();
    
    // Use provided slug or generate a unique one from title
    const slug = data.slug 
      ? (await this.isSlugAvailable(data.slug) ? data.slug : await this.generateUniqueSlug(data.title || 'untitled'))
      : await this.generateUniqueSlug(data.title || 'untitled');

    const post: PostData = {
      id,
      projectId: data.projectId || this.currentProjectId,
      title: data.title ?? '',
      slug,
      excerpt: data.excerpt,
      content: data.content || '',
      status: data.status || 'draft',
      author: data.author,
      createdAt: now,
      updatedAt: now,
      publishedAt: data.publishedAt,
      tags: data.tags || [],
      categories: data.categories || [],
    };

    const checksum = this.calculateChecksum(post.content);

    // Draft content lives in the database only — no file written
    const dbPost: NewPost = {
      id: post.id,
      projectId: post.projectId,
      title: post.title,
      slug: post.slug,
      excerpt: post.excerpt,
      content: post.content,
      status: post.status,
      author: post.author,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      publishedAt: post.publishedAt,
      filePath: '',
      syncStatus: 'pending',
      checksum,
      tags: JSON.stringify(post.tags),
      categories: JSON.stringify(post.categories),
    };

    await db.insert(posts).values(dbPost);

    // Update FTS index
    await this.updateFTSIndex(post);

    this.emit('postCreated', post);
    return post;
  }

  async updatePost(id: string, data: Partial<PostData>): Promise<PostData | null> {
    const db = getDatabase().getLocal();
    const client = getDatabase().getLocalClient();
    const existing = await this.getPost(id);
    
    if (!existing) {
      return null;
    }

    // If post is currently published and content/metadata is changing,
    // automatically transition to draft status (content moves from file to DB)
    const isContentOrMetadataChange = data.content !== undefined ||
                                       data.title !== undefined ||
                                       data.tags !== undefined ||
                                       data.categories !== undefined ||
                                       data.excerpt !== undefined;

    let newStatus = data.status || existing.status;
    if (existing.status === 'published' && isContentOrMetadataChange && !data.status) {
      newStatus = 'draft';
    }

    // Auto-update slug when title changes, but only if post was never published
    let newSlug = data.slug ?? existing.slug;
    console.log('[updatePost] Slug update check:', {
      'data.title': data.title,
      'existing.title': existing.title,
      'existing.publishedAt': existing.publishedAt,
      'titleDefined': data.title !== undefined,
      'titleChanged': data.title !== existing.title,
      'neverPublished': !existing.publishedAt,
      'shouldUpdateSlug': data.title !== undefined && data.title !== existing.title && !existing.publishedAt,
    });
    if (data.title !== undefined && data.title !== existing.title && !existing.publishedAt) {
      newSlug = await this.generateUniqueSlug(data.title || 'untitled', id);
      console.log('[updatePost] Generated new slug:', newSlug);
    }

    const updated: PostData = {
      ...existing,
      ...data,
      id, // Ensure ID doesn't change
      projectId: existing.projectId, // Ensure projectId doesn't change
      slug: newSlug,
      status: newStatus as 'draft' | 'published' | 'archived',
      updatedAt: new Date(),
    };

    const checksum = this.calculateChecksum(updated.content);

    // All updates go to DB only — no file writes
    await db.update(posts)
      .set({
        title: updated.title,
        slug: updated.slug,
        excerpt: updated.excerpt,
        content: updated.content,
        status: updated.status,
        author: updated.author,
        updatedAt: updated.updatedAt,
        publishedAt: updated.publishedAt,
        syncStatus: 'pending',
        checksum,
        tags: JSON.stringify(updated.tags),
        categories: JSON.stringify(updated.categories),
      })
      .where(eq(posts.id, id));

    // Update FTS index
    await this.updateFTSIndex(updated);

    // Update post links if content changed
    if (data.content) {
      await this.updatePostLinks(id, updated.content);
    }

    this.emit('postUpdated', updated);
    return updated;
  }

  async deletePost(id: string): Promise<boolean> {
    const db = getDatabase().getLocal();
    const client = getDatabase().getLocalClient();
    const existing = await db.select().from(posts).where(eq(posts.id, id)).get();
    
    if (!existing) {
      return false;
    }

    // Only delete file if the post was published (has a file on disk)
    if (existing.filePath) {
      try {
        await fs.unlink(existing.filePath);
      } catch {
        // File might not exist
      }
    }

    // Delete post links
    await db.delete(postLinks).where(eq(postLinks.sourcePostId, id));
    await db.delete(postLinks).where(eq(postLinks.targetPostId, id));

    // Delete from database
    await db.delete(posts).where(eq(posts.id, id));

    // Delete from FTS index
    await this.deleteFTSIndex(id);

    this.emit('postDeleted', id);
    return true;
  }

  /**
   * Build a PostData object from a DB row, using the given body content.
   */
  private dbRowToPostData(dbPost: Post, body: string): PostData {
    return {
      id: dbPost.id,
      projectId: dbPost.projectId,
      title: dbPost.title,
      slug: dbPost.slug,
      excerpt: dbPost.excerpt || undefined,
      content: body,
      status: dbPost.status as 'draft' | 'published' | 'archived',
      author: dbPost.author || undefined,
      createdAt: dbPost.createdAt,
      updatedAt: dbPost.updatedAt,
      publishedAt: dbPost.publishedAt || undefined,
      tags: JSON.parse(dbPost.tags || '[]'),
      categories: JSON.parse(dbPost.categories || '[]'),
    };
  }

  async getPost(id: string): Promise<PostData | null> {
    const db = getDatabase().getLocal();
    const dbPost = await db.select().from(posts).where(eq(posts.id, id)).get();
    
    if (!dbPost) {
      return null;
    }

    // Draft content lives in the DB
    if (dbPost.content) {
      return this.dbRowToPostData(dbPost, dbPost.content);
    }

    // Published content lives in the filesystem
    if (dbPost.filePath) {
      const fileData = await this.readPostFile(dbPost.filePath);
      if (fileData) {
        return this.dbRowToPostData(dbPost, fileData.content);
      }
    }

    // Fallback: no content available
    return this.dbRowToPostData(dbPost, '');
  }

  async getAllPosts(options?: PaginationOptions): Promise<PaginatedResult<PostData>> {
    const db = getDatabase().getLocal();
    const limit = options?.limit ?? 500;
    const offset = options?.offset ?? 0;

    // Get total count for hasMore calculation
    const countResult = await db
      .select({ count: posts.id })
      .from(posts)
      .where(eq(posts.projectId, this.currentProjectId))
      .all();
    const total = countResult.length;

    const dbPosts = await db
      .select()
      .from(posts)
      .where(eq(posts.projectId, this.currentProjectId))
      .orderBy(desc(posts.createdAt))
      .limit(limit)
      .offset(offset)
      .all();
    
    const items: PostData[] = [];
    
    for (const dbPost of dbPosts) {
      const postData = await this.getPost(dbPost.id);
      if (postData) {
        items.push(postData);
      }
    }

    return {
      items,
      hasMore: offset + items.length < total,
      total,
    };
  }

  /**
   * Internal method to get all posts without pagination.
   * Used by methods that need to iterate over all posts (search, tags, categories, etc.)
   */
  private async getAllPostsUnpaginated(): Promise<PostData[]> {
    const db = getDatabase().getLocal();
    const dbPosts = await db
      .select()
      .from(posts)
      .where(eq(posts.projectId, this.currentProjectId))
      .orderBy(desc(posts.createdAt))
      .all();
    
    const result: PostData[] = [];
    
    for (const dbPost of dbPosts) {
      const postData = await this.getPost(dbPost.id);
      if (postData) {
        result.push(postData);
      }
    }

    return result;
  }

  async getPostsByStatus(status: 'draft' | 'published' | 'archived'): Promise<PostData[]> {
    const db = getDatabase().getLocal();
    const dbPosts = await db
      .select()
      .from(posts)
      .where(and(
        eq(posts.projectId, this.currentProjectId),
        eq(posts.status, status)
      ))
      .orderBy(desc(posts.createdAt))
      .all();
    
    const result: PostData[] = [];
    
    for (const dbPost of dbPosts) {
      const postData = await this.getPost(dbPost.id);
      if (postData) {
        result.push(postData);
      }
    }

    return result;
  }

  async getPostsFiltered(filter: PostFilter): Promise<PostData[]> {
    const db = getDatabase().getLocal();
    const conditions = [eq(posts.projectId, this.currentProjectId)];

    if (filter.status) {
      conditions.push(eq(posts.status, filter.status));
    }

    if (filter.startDate) {
      conditions.push(gte(posts.createdAt, filter.startDate));
    }

    if (filter.endDate) {
      conditions.push(lte(posts.createdAt, filter.endDate));
    }

    if (filter.year !== undefined) {
      const startOfYear = new Date(filter.year, 0, 1);
      const endOfYear = new Date(filter.year + 1, 0, 1);
      conditions.push(gte(posts.createdAt, startOfYear));
      conditions.push(lte(posts.createdAt, endOfYear));
    }

    if (filter.month !== undefined && filter.year !== undefined) {
      const startOfMonth = new Date(filter.year, filter.month, 1);
      const endOfMonth = new Date(filter.year, filter.month + 1, 1);
      conditions.push(gte(posts.createdAt, startOfMonth));
      conditions.push(lte(posts.createdAt, endOfMonth));
    }

    const dbPosts = await db
      .select()
      .from(posts)
      .where(and(...conditions))
      .orderBy(desc(posts.createdAt))
      .all();

    let result: PostData[] = [];

    for (const dbPost of dbPosts) {
      const postData = await this.getPost(dbPost.id);
      if (postData) {
        // Client-side filtering for tags/categories (JSON array)
        if (filter.tags && filter.tags.length > 0) {
          const hasAllTags = filter.tags.every(tag => postData.tags.includes(tag));
          if (!hasAllTags) continue;
        }

        if (filter.categories && filter.categories.length > 0) {
          const hasAnyCategory = filter.categories.some(cat => postData.categories.includes(cat));
          if (!hasAnyCategory) continue;
        }

        result.push(postData);
      }
    }

    return result;
  }

  async searchPosts(query: string): Promise<SearchResult[]> {
    const client = getDatabase().getLocalClient();
    if (!client) return [];

    try {
      // Stem the query for multilingual matching
      const stemmedQuery = stemQuery(query, this.searchLanguage);
      
      // Search the stemmed content, filtered by project_id for project isolation
      const result = await client.execute({
        sql: `SELECT id FROM posts_fts WHERE project_id = ? AND posts_fts MATCH ? ORDER BY rank LIMIT 50`,
        args: [this.currentProjectId, stemmedQuery],
      });

      // Fetch actual post data for results
      const db = getDatabase().getLocal();
      const searchResults: SearchResult[] = [];
      
      for (const row of result.rows) {
        const postId = row.id as string;
        const post = await db.select().from(posts).where(eq(posts.id, postId)).get();
        if (post) {
          searchResults.push({
            id: post.id,
            title: post.title,
            slug: post.slug,
            excerpt: post.excerpt ?? undefined,
          });
        }
      }

      return searchResults;
    } catch (error) {
      console.error('Search failed:', error);
      return [];
    }
  }

  async getAvailableTags(): Promise<string[]> {
    const allPosts = await this.getAllPostsUnpaginated();
    const tags = new Set<string>();
    for (const post of allPosts) {
      for (const tag of post.tags) {
        tags.add(tag);
      }
    }
    return Array.from(tags).sort();
  }

  async getAvailableCategories(): Promise<string[]> {
    const allPosts = await this.getAllPostsUnpaginated();
    const categories = new Set<string>();
    for (const post of allPosts) {
      for (const cat of post.categories) {
        categories.add(cat);
      }
    }
    return Array.from(categories).sort();
  }

  async getTagsWithCounts(): Promise<{ tag: string; count: number }[]> {
    const db = getDatabase().getLocal();
    const dbPosts = await db
      .select({ tags: posts.tags })
      .from(posts)
      .where(eq(posts.projectId, this.currentProjectId))
      .all();

    const tagCounts = new Map<string, number>();
    for (const row of dbPosts) {
      const parsed: string[] = JSON.parse(row.tags || '[]');
      for (const tag of parsed) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }

    return Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
  }

  async getCategoriesWithCounts(): Promise<{ category: string; count: number }[]> {
    const db = getDatabase().getLocal();
    const dbPosts = await db
      .select({ categories: posts.categories })
      .from(posts)
      .where(eq(posts.projectId, this.currentProjectId))
      .all();

    const catCounts = new Map<string, number>();
    for (const row of dbPosts) {
      const parsed: string[] = JSON.parse(row.categories || '[]');
      for (const cat of parsed) {
        catCounts.set(cat, (catCounts.get(cat) || 0) + 1);
      }
    }

    return Array.from(catCounts.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
  }

  async getDashboardStats(): Promise<{
    totalPosts: number;
    draftCount: number;
    publishedCount: number;
    archivedCount: number;
  }> {
    const db = getDatabase().getLocal();
    const dbPosts = await db
      .select({ status: posts.status })
      .from(posts)
      .where(eq(posts.projectId, this.currentProjectId))
      .all();

    let draftCount = 0;
    let publishedCount = 0;
    let archivedCount = 0;

    for (const row of dbPosts) {
      switch (row.status) {
        case 'draft': draftCount++; break;
        case 'published': publishedCount++; break;
        case 'archived': archivedCount++; break;
      }
    }

    return {
      totalPosts: dbPosts.length,
      draftCount,
      publishedCount,
      archivedCount,
    };
  }

  async getPostsByYearMonth(): Promise<{ year: number; month: number; count: number }[]> {
    const allPosts = await this.getAllPostsUnpaginated();
    const counts = new Map<string, { year: number; month: number; count: number }>();

    for (const post of allPosts) {
      const year = post.createdAt.getFullYear();
      const month = post.createdAt.getMonth();
      const key = `${year}-${month}`;
      const current = counts.get(key) || { year, month, count: 0 };
      current.count++;
      counts.set(key, current);
    }

    return Array.from(counts.values()).sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      return b.month - a.month;
    });
  }

  async publishPost(id: string): Promise<PostData | null> {
    const db = getDatabase().getLocal();
    const client = getDatabase().getLocalClient();
    const existing = await this.getPost(id);
    
    if (!existing) {
      return null;
    }

    const now = new Date();
    const publishedAt = existing.publishedAt || now;

    const published: PostData = {
      ...existing,
      status: 'published',
      publishedAt,
      updatedAt: now,
    };

    // Write content + metadata to the filesystem
    const newFilePath = await this.writePostFile(published);

    // If there was a previous file with a different path (slug changed), remove it
    const dbPost = await db.select().from(posts).where(eq(posts.id, id)).get();
    if (dbPost && dbPost.filePath && dbPost.filePath !== newFilePath && dbPost.filePath !== '') {
      try {
        await fs.unlink(dbPost.filePath);
      } catch {
        // Old file might not exist
      }
    }

    const checksum = this.calculateChecksum(published.content);

    // Update DB: clear draft content (it lives in the file now), set filePath
    await db.update(posts)
      .set({
        title: published.title,
        slug: published.slug,
        excerpt: published.excerpt,
        content: null,
        status: 'published',
        author: published.author,
        updatedAt: published.updatedAt,
        publishedAt: published.publishedAt,
        filePath: newFilePath,
        syncStatus: 'pending',
        checksum,
        tags: JSON.stringify(published.tags),
        categories: JSON.stringify(published.categories),
      })
      .where(eq(posts.id, id));

    // Update FTS index
    await this.updateFTSIndex(published);

    // Update post links based on published content
    await this.updatePostLinks(id, published.content);

    this.emit('postUpdated', published);
    return published;
  }

  async discardChanges(id: string): Promise<PostData | null> {
    const db = getDatabase().getLocal();
    const client = getDatabase().getLocalClient();
    const dbPost = await db.select().from(posts).where(eq(posts.id, id)).get();
    
    if (!dbPost) {
      return null;
    }

    // Can only discard if there's a published file to revert to
    if (!dbPost.filePath) {
      return null;
    }

    // Read the published version from the filesystem
    const publishedData = await this.readPostFile(dbPost.filePath);
    if (!publishedData) {
      return null;
    }

    const now = new Date();

    // Restore DB metadata from the published file, clear draft content
    await db.update(posts)
      .set({
        title: publishedData.title,
        slug: publishedData.slug,
        excerpt: publishedData.excerpt,
        content: null,
        status: 'published',
        author: publishedData.author,
        updatedAt: now,
        publishedAt: publishedData.publishedAt,
        tags: JSON.stringify(publishedData.tags),
        categories: JSON.stringify(publishedData.categories),
      })
      .where(eq(posts.id, id));

    const reverted: PostData = {
      id: dbPost.id,
      projectId: dbPost.projectId,
      title: publishedData.title,
      slug: publishedData.slug,
      excerpt: publishedData.excerpt,
      content: publishedData.content,
      status: 'published',
      author: publishedData.author,
      createdAt: dbPost.createdAt,
      updatedAt: now,
      publishedAt: publishedData.publishedAt,
      tags: publishedData.tags || [],
      categories: publishedData.categories || [],
    };

    // Update FTS index
    await this.updateFTSIndex(reverted);

    this.emit('postUpdated', reverted);
    return reverted;
  }

  async hasPublishedVersion(id: string): Promise<boolean> {
    const db = getDatabase().getLocal();
    const dbPost = await db.select().from(posts).where(eq(posts.id, id)).get();
    return !!(dbPost && dbPost.filePath && dbPost.filePath !== '');
  }

  /**
   * Rebuild the FTS index for all posts in the current project.
   * Call this after changing the search language or after migration.
   */
  async rebuildFTSIndex(): Promise<void> {
    const client = getDatabase().getLocalClient();
    if (!client) return;

    const allPosts = await this.getAllPostsUnpaginated();
    
    for (const post of allPosts) {
      await this.updateFTSIndex(post);
    }
    
    console.log(`Rebuilt FTS index for ${allPosts.length} posts`);
  }

  /**
   * Reindex all text for full-text search.
   * Runs as a background task with progress updates.
   * Call this when search algorithms change or to fix search issues.
   */
  async reindexText(): Promise<void> {
    const task: Task<void> = {
      id: uuidv4(),
      name: 'Reindex search text',
      execute: async (onProgress) => {
        const client = getDatabase().getLocalClient();
        if (!client) {
          throw new Error('Database client not available');
        }

        onProgress(0, 'Clearing existing search index...');

        // Clear the entire FTS table
        await client.execute('DELETE FROM posts_fts');

        onProgress(5, 'Loading posts...');

        const allPosts = await this.getAllPostsUnpaginated();
        const total = allPosts.length;

        if (total === 0) {
          onProgress(100, 'No posts to index');
          return;
        }

        onProgress(10, `Indexing ${total} posts...`);

        for (let i = 0; i < allPosts.length; i++) {
          const post = allPosts[i];
          await this.updateFTSIndex(post);

          // Update progress (10% to 100%)
          const progress = 10 + Math.round((i + 1) / total * 90);
          if (i % 10 === 0 || i === allPosts.length - 1) {
            onProgress(progress, `Indexed ${i + 1} of ${total} posts`);
          }

          // Yield to event loop periodically
          if (i % 20 === 0) {
            await new Promise(resolve => setImmediate(resolve));
          }
        }

        onProgress(100, `Reindexed ${total} posts`);
        console.log(`Reindexed search text for ${total} posts`);
      },
    };

    await taskManager.runTask(task);
  }

  async rebuildDatabaseFromFiles(): Promise<void> {
    const postsBaseDir = this.getPostsBaseDir();
    const task: Task<void> = {
      id: uuidv4(),
      name: 'Rebuild database from post files',
      execute: async (onProgress) => {
        const db = getDatabase().getLocal();
        const client = getDatabase().getLocalClient();

        onProgress(0, 'Deleting existing posts for project...');

        // Notify UI that rebuild is starting so it can clear the list
        this.emit('rebuildStarted');

        // Delete all posts for the current project - clean slate rebuild
        const existingPosts = await db.select({ id: posts.id }).from(posts).where(eq(posts.projectId, this.currentProjectId)).all();
        if (existingPosts.length > 0) {
          const postIds = existingPosts.map(p => p.id);
          // Delete FTS entries first
          for (const post of existingPosts) {
            await this.deleteFTSIndex(post.id);
          }
          // Delete post links where source or target is in the posts being deleted
          await db.delete(postLinks).where(inArray(postLinks.sourcePostId, postIds));
          await db.delete(postLinks).where(inArray(postLinks.targetPostId, postIds));
          // Delete posts
          await db.delete(posts).where(eq(posts.projectId, this.currentProjectId));
          console.log(`Deleted ${existingPosts.length} existing post(s) for project ${this.currentProjectId}`);
        }

        onProgress(5, 'Scanning posts directory...');

        // Recursively find all .md files in the posts directory tree
        const mdFiles: string[] = [];
        const scanDir = async (dir: string) => {
          try {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
              const fullPath = path.join(dir, entry.name);
              if (entry.isDirectory()) {
                await scanDir(fullPath);
              } else if (entry.name.endsWith('.md')) {
                mdFiles.push(fullPath);
              }
            }
          } catch {
            // Directory might not exist
          }
        };

        try {
          await fs.mkdir(postsBaseDir, { recursive: true });
        } catch {
          // Already exists
        }
        await scanDir(postsBaseDir);

        onProgress(10, `Found ${mdFiles.length} post files`);

        // Track slugs to detect duplicates
        const insertedSlugs = new Map<string, string>(); // slug -> filePath

        for (let i = 0; i < mdFiles.length; i++) {
          const filePath = mdFiles[i];
          const fileName = path.basename(filePath);

          onProgress(10 + (80 * (i / mdFiles.length)), `Processing ${i + 1}/${mdFiles.length}: ${fileName}`);

          const postData = await this.readPostFile(filePath);

          if (postData) {
            try {
              const projectId = postData.projectId || this.currentProjectId;
              const slugKey = `${projectId}:${postData.slug}`;

              // Check for duplicate slugs
              if (insertedSlugs.has(slugKey)) {
                console.error(`Duplicate slug "${postData.slug}" found. File "${filePath}" duplicates "${insertedSlugs.get(slugKey)}". Skipping.`);
                continue;
              }

              const checksum = this.calculateChecksum(postData.content);

              // Insert fresh - we deleted all records at the start
              await db.insert(posts).values({
                id: postData.id,
                projectId,
                title: postData.title,
                slug: postData.slug,
                excerpt: postData.excerpt,
                content: null, // Content lives in the file, not DB
                status: 'published', // Files on disk = published
                author: postData.author,
                createdAt: postData.createdAt,
                updatedAt: postData.updatedAt,
                publishedAt: postData.publishedAt || postData.updatedAt,
                filePath,
                syncStatus: 'pending',
                checksum,
                tags: JSON.stringify(postData.tags),
                categories: JSON.stringify(postData.categories),
              });

              insertedSlugs.set(slugKey, filePath);

              // Update FTS index (use file content for search)
              await this.updateFTSIndex(postData);
            } catch (error: any) {
              // Handle constraint violations and other errors gracefully
              if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                console.error(`Failed to insert post "${postData.title}" from ${filePath}: Unique constraint violation (likely slug conflict)`);
              } else {
                console.error(`Failed to process post from ${filePath}:`, error);
              }
            }
          }

          // Yield to event loop periodically so the window stays responsive
          if (i % 10 === 0) {
            await new Promise(resolve => setImmediate(resolve));
          }
        }

        onProgress(100, 'Database rebuild complete');
        this.emit('databaseRebuilt');
      },
    };

    await taskManager.runTask(task);
  }

  /**
   * Extract internal post links from content (links to other posts in the blog)
   */
  extractInternalLinks(content: string): { slug: string; text: string }[] {
    const links: { slug: string; text: string }[] = [];
    
    // Match markdown links: [text](/posts/slug) or [text](/year/month/slug)
    const markdownLinkRegex = /\[([^\]]+)\]\(\/(?:posts\/)?(?:\d{4}\/\d{2}\/)?([a-z0-9-]+)(?:\.html?)?\)/gi;
    let match;
    while ((match = markdownLinkRegex.exec(content)) !== null) {
      links.push({ text: match[1], slug: match[2] });
    }
    
    // Match HTML links: <a href="/posts/slug">text</a>
    const htmlLinkRegex = /<a[^>]+href=["']\/(?:posts\/)?(?:\d{4}\/\d{2}\/)?([a-z0-9-]+)(?:\.html?)?["'][^>]*>([^<]+)<\/a>/gi;
    while ((match = htmlLinkRegex.exec(content)) !== null) {
      links.push({ text: match[2], slug: match[1] });
    }
    
    return links;
  }

  /**
   * Update post links in the database based on content analysis
   */
  async updatePostLinks(postId: string, content: string): Promise<void> {
    const db = getDatabase().getLocal();
    const extractedLinks = this.extractInternalLinks(content);
    
    // Delete existing links from this post
    await db.delete(postLinks).where(eq(postLinks.sourcePostId, postId));
    
    if (extractedLinks.length === 0) return;
    
    // Get all posts to resolve slugs to IDs
    const allPosts = await db.select({ id: posts.id, slug: posts.slug })
      .from(posts)
      .where(eq(posts.projectId, this.currentProjectId));
    
    const slugToId = new Map(allPosts.map(p => [p.slug, p.id]));
    
    // Insert new links
    for (const link of extractedLinks) {
      const targetId = slugToId.get(link.slug);
      if (targetId && targetId !== postId) {
        await db.insert(postLinks).values({
          id: uuidv4(),
          sourcePostId: postId,
          targetPostId: targetId,
          linkText: link.text,
          createdAt: new Date(),
        });
      }
    }
  }

  /**
   * Get posts that link TO the specified post ("linked by")
   */
  async getLinkedBy(postId: string): Promise<{ id: string; title: string; slug: string }[]> {
    const db = getDatabase().getLocal();
    
    const links = await db
      .select({
        sourcePostId: postLinks.sourcePostId,
        linkText: postLinks.linkText,
      })
      .from(postLinks)
      .where(eq(postLinks.targetPostId, postId));
    
    if (links.length === 0) return [];
    
    const sourceIds = links.map(l => l.sourcePostId);
    const sourcePosts = await db
      .select({ id: posts.id, title: posts.title, slug: posts.slug })
      .from(posts)
      .where(eq(posts.projectId, this.currentProjectId));
    
    return sourcePosts.filter(p => sourceIds.includes(p.id));
  }

  /**
   * Get posts that the specified post links TO ("links to")
   */
  async getLinksTo(postId: string): Promise<{ id: string; title: string; slug: string }[]> {
    const db = getDatabase().getLocal();
    
    const links = await db
      .select({
        targetPostId: postLinks.targetPostId,
        linkText: postLinks.linkText,
      })
      .from(postLinks)
      .where(eq(postLinks.sourcePostId, postId));
    
    if (links.length === 0) return [];
    
    const targetIds = links.map(l => l.targetPostId);
    const targetPosts = await db
      .select({ id: posts.id, title: posts.title, slug: posts.slug })
      .from(posts)
      .where(eq(posts.projectId, this.currentProjectId));
    
    return targetPosts.filter(p => targetIds.includes(p.id));
  }

  /**
   * Rebuild all post links from content analysis
   */
  async rebuildAllPostLinks(): Promise<void> {
    const db = getDatabase().getLocal();
    
    // Clear all existing links
    await db.delete(postLinks);
    
    // Get all posts with content source info
    const allPosts = await db
      .select({ id: posts.id, filePath: posts.filePath, content: posts.content })
      .from(posts)
      .where(eq(posts.projectId, this.currentProjectId));
    
    for (const post of allPosts) {
      try {
        let postContent: string;

        // Draft content is in DB, published content is in file
        if (post.content) {
          postContent = post.content;
        } else if (post.filePath) {
          const fileContent = await fs.readFile(post.filePath, 'utf-8');
          const { content } = matter(fileContent);
          postContent = content;
        } else {
          continue;
        }

        await this.updatePostLinks(post.id, postContent);
      } catch (error) {
        console.error(`Failed to update links for post ${post.id}:`, error);
      }
    }
    
    this.emit('postLinksRebuilt');
  }
}

// Singleton instance
let postEngine: PostEngine | null = null;

export function getPostEngine(): PostEngine {
  if (!postEngine) {
    postEngine = new PostEngine();
  }
  return postEngine;
}
