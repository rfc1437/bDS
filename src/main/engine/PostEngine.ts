import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import matter from 'gray-matter';
import { eq } from 'drizzle-orm';
import { getDatabase } from '../database';
import { posts, Post, NewPost } from '../database/schema';
import { taskManager, Task } from './TaskManager';

export interface PostData {
  id: string;
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
  id: string;
}

export class PostEngine extends EventEmitter {
  private postsDir: string;

  constructor() {
    super();
    this.postsDir = getDatabase().getDataPaths().posts;
  }

  private generateSlug(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  private calculateChecksum(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex');
  }

  private async writePostFile(post: PostData): Promise<string> {
    const metadata: PostMetadata = {
      id: post.id,
      title: post.title,
      slug: post.slug,
      excerpt: post.excerpt,
      status: post.status,
      author: post.author,
      createdAt: post.createdAt.toISOString(),
      updatedAt: post.updatedAt.toISOString(),
      publishedAt: post.publishedAt?.toISOString(),
      tags: post.tags,
      categories: post.categories,
    };

    const fileContent = matter.stringify(post.content, metadata);
    const filePath = path.join(this.postsDir, `${post.slug}.md`);
    
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
    const now = new Date();
    const id = uuidv4();
    const slug = data.slug || this.generateSlug(data.title || 'untitled');

    const post: PostData = {
      id,
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

    this.emit('postCreated', post);
    return post;
  }

  async updatePost(id: string, data: Partial<PostData>): Promise<PostData | null> {
    const db = getDatabase().getLocal();
    const existing = await this.getPost(id);
    
    if (!existing) {
      return null;
    }

    const updated: PostData = {
      ...existing,
      ...data,
      id, // Ensure ID doesn't change
      updatedAt: new Date(),
    };

    // Handle slug change - need to rename file
    if (data.slug && data.slug !== existing.slug) {
      const oldPath = path.join(this.postsDir, `${existing.slug}.md`);
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

    this.emit('postUpdated', updated);
    return updated;
  }

  async deletePost(id: string): Promise<boolean> {
    const db = getDatabase().getLocal();
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
    const dbPosts = await db.select().from(posts).all();
    
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
    const dbPosts = await db.select().from(posts).where(eq(posts.status, status)).all();
    
    const result: PostData[] = [];
    
    for (const dbPost of dbPosts) {
      const postData = await this.getPost(dbPost.id);
      if (postData) {
        result.push(postData);
      }
    }

    return result;
  }

  async publishPost(id: string): Promise<PostData | null> {
    return this.updatePost(id, {
      status: 'published',
      publishedAt: new Date(),
    });
  }

  async unpublishPost(id: string): Promise<PostData | null> {
    return this.updatePost(id, {
      status: 'draft',
      publishedAt: undefined,
    });
  }

  async rebuildDatabaseFromFiles(): Promise<void> {
    const task: Task<void> = {
      id: uuidv4(),
      name: 'Rebuild database from post files',
      execute: async (onProgress) => {
        const db = getDatabase().getLocal();
        
        onProgress(0, 'Scanning posts directory...');
        
        const files = await fs.readdir(this.postsDir);
        const mdFiles = files.filter(f => f.endsWith('.md'));
        
        onProgress(10, `Found ${mdFiles.length} post files`);
        
        for (let i = 0; i < mdFiles.length; i++) {
          const file = mdFiles[i];
          const filePath = path.join(this.postsDir, file);
          
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
          }
        }
        
        onProgress(100, 'Database rebuild complete');
        this.emit('databaseRebuilt');
      },
    };
    
    await taskManager.runTask(task);
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
