import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import matter from 'gray-matter';
import { eq, and, desc, gte, lte, like } from 'drizzle-orm';
import { app } from 'electron';
import { getDatabase } from '../database';
import { posts, Post, NewPost, postLinks } from '../database/schema';
import { taskManager, Task } from './TaskManager';

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
  matchSnippet?: string;
  rank?: number;
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

export class PostEngine extends EventEmitter {
  private currentProjectId: string = 'default';

  constructor() {
    super();
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
      console.error(`Failed to read post file: ${filePath}`, error);
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
      title: data.title || 'Untitled',
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

    // Write to filesystem first
    const filePath = await this.writePostFile(post);
    const checksum = this.calculateChecksum(post.content);

    // Then update database
    const dbPost: NewPost = {
      id: post.id,
      projectId: post.projectId,
      title: post.title,
      slug: post.slug,
      excerpt: post.excerpt,
      status: post.status,
      author: post.author,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      publishedAt: post.publishedAt,
      filePath,
      syncStatus: 'pending',
      checksum,
      tags: JSON.stringify(post.tags),
      categories: JSON.stringify(post.categories),
    };

    await db.insert(posts).values(dbPost);

    // Update FTS index
    if (client) {
      await client.execute({
        sql: 'INSERT INTO posts_fts (id, title, content, excerpt, tags, categories) VALUES (?, ?, ?, ?, ?, ?)',
        args: [post.id, post.title, post.content, post.excerpt || '', post.tags.join(' '), post.categories.join(' ')],
      });
    }

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

    const updated: PostData = {
      ...existing,
      ...data,
      id, // Ensure ID doesn't change
      projectId: existing.projectId, // Ensure projectId doesn't change
      updatedAt: new Date(),
    };

    // Handle slug change - need to rename file
    const postsDir = this.getPostsDir();
    if (data.slug && data.slug !== existing.slug) {
      const oldPath = path.join(postsDir, `${existing.slug}.md`);
      try {
        await fs.unlink(oldPath);
      } catch {
        // Old file might not exist
      }
    }

    const filePath = await this.writePostFile(updated);
    const checksum = this.calculateChecksum(updated.content);

    await db.update(posts)
      .set({
        title: updated.title,
        slug: updated.slug,
        excerpt: updated.excerpt,
        status: updated.status,
        author: updated.author,
        updatedAt: updated.updatedAt,
        publishedAt: updated.publishedAt,
        filePath,
        syncStatus: 'pending',
        checksum,
        tags: JSON.stringify(updated.tags),
        categories: JSON.stringify(updated.categories),
      })
      .where(eq(posts.id, id));

    // Update FTS index
    if (client) {
      await client.execute({ sql: 'DELETE FROM posts_fts WHERE id = ?', args: [id] });
      await client.execute({
        sql: 'INSERT INTO posts_fts (id, title, content, excerpt, tags, categories) VALUES (?, ?, ?, ?, ?, ?)',
        args: [updated.id, updated.title, updated.content, updated.excerpt || '', updated.tags.join(' '), updated.categories.join(' ')],
      });
    }

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

    // Delete file
    try {
      await fs.unlink(existing.filePath);
    } catch {
      // File might not exist
    }

    // Delete from database
    await db.delete(posts).where(eq(posts.id, id));

    // Delete from FTS index
    if (client) {
      await client.execute({ sql: 'DELETE FROM posts_fts WHERE id = ?', args: [id] });
    }

    this.emit('postDeleted', id);
    return true;
  }

  async getPost(id: string): Promise<PostData | null> {
    const db = getDatabase().getLocal();
    const dbPost = await db.select().from(posts).where(eq(posts.id, id)).get();
    
    if (!dbPost) {
      return null;
    }

    // Read content from file
    const postData = await this.readPostFile(dbPost.filePath);
    
    if (!postData) {
      // File doesn't exist, reconstruct from database
      return {
        id: dbPost.id,
        projectId: dbPost.projectId,
        title: dbPost.title,
        slug: dbPost.slug,
        excerpt: dbPost.excerpt || undefined,
        content: '',
        status: dbPost.status as 'draft' | 'published' | 'archived',
        author: dbPost.author || undefined,
        createdAt: dbPost.createdAt,
        updatedAt: dbPost.updatedAt,
        publishedAt: dbPost.publishedAt || undefined,
        tags: JSON.parse(dbPost.tags || '[]'),
        categories: JSON.parse(dbPost.categories || '[]'),
      };
    }

    return postData;
  }

  async getAllPosts(): Promise<PostData[]> {
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
      const result = await client.execute({
        sql: `SELECT id, title, excerpt, snippet(posts_fts, 2, '<mark>', '</mark>', '...', 32) as snippet, rank
              FROM posts_fts
              WHERE posts_fts MATCH ?
              ORDER BY rank
              LIMIT 50`,
        args: [query],
      });

      const projectPosts = await this.getAllPosts();
      const projectPostIds = new Set(projectPosts.map(p => p.id));

      return result.rows
        .filter(row => projectPostIds.has(row.id as string))
        .map(row => ({
          id: row.id as string,
          title: row.title as string,
          slug: '', // Will be filled in by caller if needed
          excerpt: row.excerpt as string | undefined,
          matchSnippet: row.snippet as string | undefined,
          rank: row.rank as number | undefined,
        }));
    } catch (error) {
      console.error('Search failed:', error);
      return [];
    }
  }

  async getAvailableTags(): Promise<string[]> {
    const allPosts = await this.getAllPosts();
    const tags = new Set<string>();
    for (const post of allPosts) {
      for (const tag of post.tags) {
        tags.add(tag);
      }
    }
    return Array.from(tags).sort();
  }

  async getAvailableCategories(): Promise<string[]> {
    const allPosts = await this.getAllPosts();
    const categories = new Set<string>();
    for (const post of allPosts) {
      for (const cat of post.categories) {
        categories.add(cat);
      }
    }
    return Array.from(categories).sort();
  }

  async getPostsByYearMonth(): Promise<{ year: number; month: number; count: number }[]> {
    const allPosts = await this.getAllPosts();
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
    const existing = await this.getPost(id);
    
    if (!existing) {
      return null;
    }

    // First update the post with published status
    const result = await this.updatePost(id, {
      status: 'published',
      publishedAt: new Date(),
    });

    if (result) {
      // Save the published snapshot for discard functionality
      await db.update(posts)
        .set({
          publishedTitle: result.title,
          publishedContent: result.content,
          publishedExcerpt: result.excerpt,
          publishedTags: JSON.stringify(result.tags),
          publishedCategories: JSON.stringify(result.categories),
        })
        .where(eq(posts.id, id));
    }

    return result;
  }

  async discardChanges(id: string): Promise<PostData | null> {
    const db = getDatabase().getLocal();
    const dbPost = await db.select().from(posts).where(eq(posts.id, id)).get();
    
    if (!dbPost || !dbPost.publishedContent) {
      // No published version to revert to
      return null;
    }

    // Revert to the published snapshot
    return this.updatePost(id, {
      title: dbPost.publishedTitle || dbPost.title,
      content: dbPost.publishedContent,
      excerpt: dbPost.publishedExcerpt || undefined,
      tags: JSON.parse(dbPost.publishedTags || '[]'),
      categories: JSON.parse(dbPost.publishedCategories || '[]'),
    });
  }

  async hasPublishedVersion(id: string): Promise<boolean> {
    const db = getDatabase().getLocal();
    const dbPost = await db.select().from(posts).where(eq(posts.id, id)).get();
    return !!(dbPost && dbPost.publishedContent);
  }

  async unpublishPost(id: string): Promise<PostData | null> {
    return this.updatePost(id, {
      status: 'draft',
      publishedAt: undefined,
    });
  }

  async rebuildDatabaseFromFiles(): Promise<void> {
    const postsDir = this.getPostsDir();
    const task: Task<void> = {
      id: uuidv4(),
      name: 'Rebuild database from post files',
      execute: async (onProgress) => {
        const db = getDatabase().getLocal();
        const client = getDatabase().getLocalClient();
        
        onProgress(0, 'Scanning posts directory...');
        
        let files: string[] = [];
        try {
          files = await fs.readdir(postsDir);
        } catch {
          // Directory might not exist
          await fs.mkdir(postsDir, { recursive: true });
        }
        const mdFiles = files.filter(f => f.endsWith('.md'));
        
        onProgress(10, `Found ${mdFiles.length} post files`);
        
        for (let i = 0; i < mdFiles.length; i++) {
          const file = mdFiles[i];
          const filePath = path.join(postsDir, file);
          
          onProgress(10 + (80 * (i / mdFiles.length)), `Processing ${file}...`);
          
          const postData = await this.readPostFile(filePath);
          
          if (postData) {
            const existing = await db.select().from(posts).where(eq(posts.id, postData.id)).get();
            const checksum = this.calculateChecksum(postData.content);
            
            if (existing) {
              await db.update(posts)
                .set({
                  title: postData.title,
                  slug: postData.slug,
                  excerpt: postData.excerpt,
                  status: postData.status,
                  author: postData.author,
                  updatedAt: postData.updatedAt,
                  publishedAt: postData.publishedAt,
                  filePath,
                  checksum,
                  tags: JSON.stringify(postData.tags),
                  categories: JSON.stringify(postData.categories),
                })
                .where(eq(posts.id, postData.id));
            } else {
              await db.insert(posts).values({
                id: postData.id,
                projectId: postData.projectId || this.currentProjectId,
                title: postData.title,
                slug: postData.slug,
                excerpt: postData.excerpt,
                status: postData.status,
                author: postData.author,
                createdAt: postData.createdAt,
                updatedAt: postData.updatedAt,
                publishedAt: postData.publishedAt,
                filePath,
                syncStatus: 'pending',
                checksum,
                tags: JSON.stringify(postData.tags),
                categories: JSON.stringify(postData.categories),
              });
            }

            // Update FTS index
            if (client) {
              await client.execute({ sql: 'DELETE FROM posts_fts WHERE id = ?', args: [postData.id] });
              await client.execute({
                sql: 'INSERT INTO posts_fts (id, title, content, excerpt, tags, categories) VALUES (?, ?, ?, ?, ?, ?)',
                args: [postData.id, postData.title, postData.content, postData.excerpt || '', postData.tags.join(' '), postData.categories.join(' ')],
              });
            }
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
    
    // Get all posts
    const allPosts = await db
      .select({ id: posts.id, filePath: posts.filePath })
      .from(posts)
      .where(eq(posts.projectId, this.currentProjectId));
    
    for (const post of allPosts) {
      try {
        const fileContent = await fs.readFile(post.filePath, 'utf-8');
        const { content } = matter(fileContent);
        await this.updatePostLinks(post.id, content);
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
