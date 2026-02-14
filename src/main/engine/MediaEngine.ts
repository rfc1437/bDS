import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { eq, and, gte, lte, lt, desc } from 'drizzle-orm';
import { app } from 'electron';
import { getDatabase } from '../database';
import { media, Media, NewMedia, postMedia } from '../database/schema';
import { stemText, stemQuery, SupportedLanguage } from './stemmer';

// Thumbnail sizes
const THUMBNAIL_SIZES = {
  small: { width: 150, height: 150 },
  medium: { width: 400, height: 400 },
  large: { width: 800, height: 800 },
} as const;

type ThumbnailSize = keyof typeof THUMBNAIL_SIZES;
import { taskManager, Task } from './TaskManager';

export interface MediaData {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  alt?: string;
  caption?: string;
  createdAt: Date;
  updatedAt: Date;
  tags: string[];
  linkedPostIds?: string[]; // Posts this media is linked to
}

export interface MediaMetadata {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  alt?: string;
  caption?: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  linkedPostIds?: string[]; // Posts this media is linked to (persisted in sidecar)
}

export interface MediaFilter {
  tags?: string[];
  startDate?: Date;
  endDate?: Date;
  year?: number;
  month?: number;
}

export interface MediaSearchResult {
  id: string;
  originalName: string;
  caption?: string;
  mimeType: string;
  createdAt: Date;
}

export class MediaEngine extends EventEmitter {
  private currentProjectId: string = 'default';
  private dataDir: string | null = null;      // For media files (may be external)
  private internalDir: string | null = null;   // For thumbnails (always local)
  private searchLanguage: SupportedLanguage = 'english';

  constructor() {
    super();
  }

  /**
   * Set the language used for full-text search stemming.
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
   * Update the FTS index for a media item.
   * Stores stemmed content from original_name, alt, caption, and tags.
   */
  private async updateFTSIndex(item: {
    id: string;
    projectId: string;
    originalName: string;
    alt?: string;
    caption?: string;
    tags: string[];
  }): Promise<void> {
    const client = getDatabase().getLocalClient();
    if (!client) return;

    // Delete existing entry
    await client.execute({ sql: 'DELETE FROM media_fts WHERE id = ?', args: [item.id] });

    // Combine all searchable fields and stem them
    const allText = [
      item.originalName,
      item.alt || '',
      item.caption || '',
      item.tags.join(' '),
    ].join(' ');

    const stemmedContent = stemText(allText, this.searchLanguage);

    // Insert with id, project_id, and stemmed content
    await client.execute({
      sql: 'INSERT INTO media_fts (id, project_id, content) VALUES (?, ?, ?)',
      args: [item.id, item.projectId, stemmedContent],
    });
  }

  /**
   * Delete a media item from the FTS index.
   */
  private async deleteFTSIndex(id: string): Promise<void> {
    const client = getDatabase().getLocalClient();
    if (!client) return;
    await client.execute({ sql: 'DELETE FROM media_fts WHERE id = ?', args: [id] });
  }

  private getDefaultBaseDir(): string {
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, 'projects', this.currentProjectId);
  }

  private getDataDir(): string {
    return this.dataDir || this.getDefaultBaseDir();
  }

  private getInternalDir(): string {
    return this.internalDir || this.getDefaultBaseDir();
  }

  private getMediaBaseDir(): string {
    return path.join(this.getDataDir(), 'media');
  }

  private getMediaDir(): string {
    // Kept for backwards compatibility - returns base media directory
    return this.getMediaBaseDir();
  }

  /**
   * Get the date-based directory for media based on its creation date.
   * Format: media/YYYY/MM/
   */
  private getMediaDirForDate(date: Date): string {
    const baseDir = this.getMediaBaseDir();
    const year = date.getFullYear().toString();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    return path.join(baseDir, year, month);
  }

  /**
   * Get the full path for a media file based on id, extension, and date.
   * Returns: media/YYYY/MM/{id}.{ext}
   */
  getMediaPathForDate(id: string, ext: string, date: Date): string {
    const dir = this.getMediaDirForDate(date);
    const extension = ext.startsWith('.') ? ext : `.${ext}`;
    return path.join(dir, `${id}${extension}`);
  }

  setProjectContext(projectId: string, dataDir?: string, internalDir?: string): void {
    this.currentProjectId = projectId;
    this.dataDir = dataDir || null;
    this.internalDir = internalDir || null;
    console.log(`[MediaEngine] setProjectContext: projectId=${projectId}, dataDir=${this.dataDir}, internalDir=${this.internalDir}`);
  }

  getProjectContext(): string {
    return this.currentProjectId;
  }

  private calculateChecksum(buffer: Buffer): string {
    return crypto.createHash('md5').update(buffer).digest('hex');
  }

  /**
   * Get the thumbnails directory for the current project
   */
  private getThumbnailsDir(): string {
    return path.join(this.getInternalDir(), 'thumbnails');
  }

  /**
   * Generate thumbnails for an image file
   */
  async generateThumbnails(mediaId: string, sourcePath: string): Promise<Record<ThumbnailSize, string>> {
    const thumbnailsDir = this.getThumbnailsDir();
    await fs.mkdir(thumbnailsDir, { recursive: true });

    const thumbnails: Record<ThumbnailSize, string> = {} as Record<ThumbnailSize, string>;

    try {
      // Dynamic import of sharp (it's a native module)
      const sharp = (await import('sharp')).default;

      for (const [size, dimensions] of Object.entries(THUMBNAIL_SIZES) as [ThumbnailSize, { width: number; height: number }][]) {
        const thumbnailPath = path.join(thumbnailsDir, `${mediaId}-${size}.webp`);

        await sharp(sourcePath)
          .resize(dimensions.width, dimensions.height, {
            fit: 'inside',
            withoutEnlargement: true,
          })
          .webp({ quality: 80 })
          .toFile(thumbnailPath);

        thumbnails[size] = thumbnailPath;
      }

      this.emit('thumbnailsGenerated', { mediaId, thumbnails });
    } catch (error) {
      console.error('Failed to generate thumbnails:', error);
      // Return empty thumbnails on error - non-critical failure
    }

    return thumbnails;
  }

  /**
   * Get existing thumbnail paths for a media item
   */
  async getThumbnailPaths(mediaId: string): Promise<Record<ThumbnailSize, string | null>> {
    const thumbnailsDir = this.getThumbnailsDir();
    const result: Record<ThumbnailSize, string | null> = {
      small: null,
      medium: null,
      large: null,
    };

    for (const size of Object.keys(THUMBNAIL_SIZES) as ThumbnailSize[]) {
      const thumbnailPath = path.join(thumbnailsDir, `${mediaId}-${size}.webp`);
      try {
        await fs.access(thumbnailPath);
        result[size] = thumbnailPath;
      } catch {
        // Thumbnail doesn't exist
      }
    }

    return result;
  }

  /**
   * Get thumbnail as base64 data URL for renderer
   */
  async getThumbnailDataUrl(mediaId: string, size: ThumbnailSize = 'small'): Promise<string | null> {
    const thumbnailsDir = this.getThumbnailsDir();
    const thumbnailPath = path.join(thumbnailsDir, `${mediaId}-${size}.webp`);

    try {
      const data = await fs.readFile(thumbnailPath);
      return `data:image/webp;base64,${data.toString('base64')}`;
    } catch {
      return null;
    }
  }

  /**
   * Delete thumbnails for a media item
   */
  private async deleteThumbnails(mediaId: string): Promise<void> {
    const thumbnailsDir = this.getThumbnailsDir();

    for (const size of Object.keys(THUMBNAIL_SIZES) as ThumbnailSize[]) {
      const thumbnailPath = path.join(thumbnailsDir, `${mediaId}-${size}.webp`);
      try {
        await fs.unlink(thumbnailPath);
      } catch {
        // Thumbnail doesn't exist, ignore
      }
    }
  }

  private async writeSidecarFile(mediaData: MediaData, mediaPath: string): Promise<string> {
    const sidecarPath = `${mediaPath}.meta`;
    
    const metadata: MediaMetadata = {
      id: mediaData.id,
      originalName: mediaData.originalName,
      mimeType: mediaData.mimeType,
      size: mediaData.size,
      width: mediaData.width,
      height: mediaData.height,
      alt: mediaData.alt,
      caption: mediaData.caption,
      createdAt: mediaData.createdAt.toISOString(),
      updatedAt: mediaData.updatedAt.toISOString(),
      tags: mediaData.tags,
      linkedPostIds: mediaData.linkedPostIds,
    };

    // Write YAML-like format consistent with posts
    const lines = [
      '---',
      `id: ${metadata.id}`,
      `originalName: "${metadata.originalName}"`,
      `mimeType: ${metadata.mimeType}`,
      `size: ${metadata.size}`,
    ];

    if (metadata.width) lines.push(`width: ${metadata.width}`);
    if (metadata.height) lines.push(`height: ${metadata.height}`);
    if (metadata.alt) lines.push(`alt: "${metadata.alt}"`);
    if (metadata.caption) lines.push(`caption: "${metadata.caption}"`);
    
    lines.push(`createdAt: ${metadata.createdAt}`);
    lines.push(`updatedAt: ${metadata.updatedAt}`);
    lines.push(`tags: [${metadata.tags.map(t => `"${t}"`).join(', ')}]`);
    if (metadata.linkedPostIds && metadata.linkedPostIds.length > 0) {
      lines.push(`linkedPostIds: [${metadata.linkedPostIds.map(id => `"${id}"`).join(', ')}]`);
    }
    lines.push('---');

    await fs.writeFile(sidecarPath, lines.join('\n'), 'utf-8');
    return sidecarPath;
  }

  private async readSidecarFile(sidecarPath: string): Promise<MediaMetadata | null> {
    try {
      // Check if file exists first to avoid noisy errors
      try {
        await fs.access(sidecarPath);
      } catch {
        // File doesn't exist - this is expected when DB has stale paths
        return null;
      }

      const content = await fs.readFile(sidecarPath, 'utf-8');
      const lines = content.split('\n');
      
      const metadata: Partial<MediaMetadata> = {
        tags: [],
        linkedPostIds: [],
      };

      for (const line of lines) {
        if (line === '---') continue;
        
        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) continue;
        
        const key = line.substring(0, colonIndex).trim();
        let value = line.substring(colonIndex + 1).trim();
        
        // Remove quotes
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        }

        switch (key) {
          case 'id':
            metadata.id = value;
            break;
          case 'originalName':
            metadata.originalName = value;
            break;
          case 'mimeType':
            metadata.mimeType = value;
            break;
          case 'size':
            metadata.size = parseInt(value, 10);
            break;
          case 'width':
            metadata.width = parseInt(value, 10);
            break;
          case 'height':
            metadata.height = parseInt(value, 10);
            break;
          case 'alt':
            metadata.alt = value;
            break;
          case 'caption':
            metadata.caption = value;
            break;
          case 'createdAt':
            metadata.createdAt = value;
            break;
          case 'updatedAt':
            metadata.updatedAt = value;
            break;
          case 'tags':
            // Parse array format: ["tag1", "tag2"]
            const tagsMatch = value.match(/\[(.*)\]/);
            if (tagsMatch) {
              metadata.tags = tagsMatch[1]
                .split(',')
                .map(t => t.trim().replace(/"/g, ''))
                .filter(t => t.length > 0);
            }
            break;
          case 'linkedPostIds':
            // Parse array format: ["postId1", "postId2"]
            const postIdsMatch = value.match(/\[(.*)\]/);
            if (postIdsMatch) {
              metadata.linkedPostIds = postIdsMatch[1]
                .split(',')
                .map(id => id.trim().replace(/"/g, ''))
                .filter(id => id.length > 0);
            }
            break;
        }
      }

      if (!metadata.id || !metadata.originalName || !metadata.mimeType) {
        return null;
      }

      return metadata as MediaMetadata;
    } catch (error) {
      console.error(`Failed to parse sidecar file: ${sidecarPath}`, error);
      return null;
    }
  }

  private getMimeType(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.bmp': 'image/bmp',
      '.ico': 'image/x-icon',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  async importMedia(sourcePath: string, metadata?: Partial<MediaData>): Promise<MediaData> {
    const db = getDatabase().getLocal();
    const id = uuidv4();
    const now = new Date();
    
    const sourceBuffer = await fs.readFile(sourcePath);
    const originalName = path.basename(sourcePath);
    const ext = path.extname(originalName);
    const filename = `${id}${ext}`;
    
    // Use date-based directory structure (media/YYYY/MM/)
    const mediaDir = this.getMediaDirForDate(now);
    await fs.mkdir(mediaDir, { recursive: true });
    const destPath = path.join(mediaDir, filename);

    // Copy file to media directory
    await fs.copyFile(sourcePath, destPath);

    const mimeType = metadata?.mimeType || this.getMimeType(originalName);
    let width = metadata?.width;
    let height = metadata?.height;

    // Get image dimensions using sharp if it's an image
    if (mimeType.startsWith('image/') && !mimeType.includes('svg')) {
      try {
        const sharp = (await import('sharp')).default;
        const imageMetadata = await sharp(destPath).metadata();
        width = imageMetadata.width;
        height = imageMetadata.height;
      } catch (error) {
        console.error('Failed to get image dimensions:', error);
      }
    }

    const mediaData: MediaData = {
      id,
      filename,
      originalName,
      mimeType,
      size: sourceBuffer.length,
      width,
      height,
      alt: metadata?.alt,
      caption: metadata?.caption,
      createdAt: now,
      updatedAt: now,
      tags: metadata?.tags || [],
    };

    const sidecarPath = await this.writeSidecarFile(mediaData, destPath);
    const checksum = this.calculateChecksum(sourceBuffer);

    // Generate thumbnails for images (async, non-blocking)
    if (mimeType.startsWith('image/') && !mimeType.includes('svg')) {
      this.generateThumbnails(id, destPath).catch(err => {
        console.error('Failed to generate thumbnails:', err);
      });
    }

    const dbMedia: NewMedia = {
      id: mediaData.id,
      projectId: this.currentProjectId,
      filename: mediaData.filename,
      originalName: mediaData.originalName,
      mimeType: mediaData.mimeType,
      size: mediaData.size,
      width: mediaData.width,
      height: mediaData.height,
      alt: mediaData.alt,
      caption: mediaData.caption,
      filePath: destPath,
      sidecarPath,
      createdAt: mediaData.createdAt,
      updatedAt: mediaData.updatedAt,
      checksum,
      tags: JSON.stringify(mediaData.tags),
    };

    await db.insert(media).values(dbMedia);

    // Update FTS index
    await this.updateFTSIndex({
      id: mediaData.id,
      projectId: this.currentProjectId,
      originalName: mediaData.originalName,
      alt: mediaData.alt,
      caption: mediaData.caption,
      tags: mediaData.tags,
    });

    this.emit('mediaImported', mediaData);
    return mediaData;
  }

  async updateMedia(id: string, data: Partial<MediaData>): Promise<MediaData | null> {
    const db = getDatabase().getLocal();
    const existing = await this.getMedia(id);
    
    if (!existing) {
      return null;
    }

    const updated: MediaData = {
      ...existing,
      ...data,
      id, // Ensure ID doesn't change
      updatedAt: new Date(),
    };

    const dbMedia = await db.select().from(media).where(eq(media.id, id)).get();
    if (!dbMedia) return null;

    await this.writeSidecarFile(updated, dbMedia.filePath);

    await db.update(media)
      .set({
        alt: updated.alt,
        caption: updated.caption,
        updatedAt: updated.updatedAt,
        tags: JSON.stringify(updated.tags),
      })
      .where(eq(media.id, id));

    // Update FTS index
    await this.updateFTSIndex({
      id: updated.id,
      projectId: this.currentProjectId,
      originalName: updated.originalName,
      alt: updated.alt,
      caption: updated.caption,
      tags: updated.tags,
    });

    this.emit('mediaUpdated', updated);
    return updated;
  }

  async deleteMedia(id: string): Promise<boolean> {
    const db = getDatabase().getLocal();
    const existing = await db.select().from(media).where(eq(media.id, id)).get();

    if (!existing) {
      return false;
    }

    // Delete media file
    try {
      await fs.unlink(existing.filePath);
    } catch {
      // File might not exist
    }

    // Delete sidecar file
    try {
      await fs.unlink(existing.sidecarPath);
    } catch {
      // File might not exist
    }

    // Delete thumbnails
    await this.deleteThumbnails(id);

    // Delete post-media links (cascade cleanup)
    const { postMedia } = await import('../database/schema');
    await db.delete(postMedia).where(eq(postMedia.mediaId, id));

    await db.delete(media).where(eq(media.id, id));

    // Delete from FTS index
    await this.deleteFTSIndex(id);

    this.emit('mediaDeleted', id);
    return true;
  }

  async getMedia(id: string): Promise<MediaData | null> {
    const db = getDatabase().getLocal();
    const dbMedia = await db.select().from(media).where(eq(media.id, id)).get();
    
    if (!dbMedia) {
      return null;
    }

    return {
      id: dbMedia.id,
      filename: dbMedia.filename,
      originalName: dbMedia.originalName,
      mimeType: dbMedia.mimeType,
      size: dbMedia.size,
      width: dbMedia.width || undefined,
      height: dbMedia.height || undefined,
      alt: dbMedia.alt || undefined,
      caption: dbMedia.caption || undefined,
      createdAt: dbMedia.createdAt,
      updatedAt: dbMedia.updatedAt,
      tags: JSON.parse(dbMedia.tags || '[]'),
    };
  }

  async getAllMedia(): Promise<MediaData[]> {
    const db = getDatabase().getLocal();
    const dbMediaList = await db
      .select()
      .from(media)
      .where(eq(media.projectId, this.currentProjectId))
      .orderBy(desc(media.createdAt))
      .all();

    return dbMediaList.map(dbMedia => ({
      id: dbMedia.id,
      filename: dbMedia.filename,
      originalName: dbMedia.originalName,
      mimeType: dbMedia.mimeType,
      size: dbMedia.size,
      width: dbMedia.width || undefined,
      height: dbMedia.height || undefined,
      alt: dbMedia.alt || undefined,
      caption: dbMedia.caption || undefined,
      createdAt: dbMedia.createdAt,
      updatedAt: dbMedia.updatedAt,
      tags: JSON.parse(dbMedia.tags || '[]'),
    }));
  }

  async getMediaFiltered(filter: MediaFilter): Promise<MediaData[]> {
    const db = getDatabase().getLocal();
    const conditions = [eq(media.projectId, this.currentProjectId)];

    console.log(`[MediaEngine] getMediaFiltered called with filter:`, JSON.stringify(filter));

    if (filter.startDate) {
      conditions.push(gte(media.createdAt, filter.startDate));
    }

    if (filter.endDate) {
      conditions.push(lte(media.createdAt, filter.endDate));
    }

    if (filter.year !== undefined) {
      // Use UTC dates to avoid timezone issues
      const startOfYear = new Date(Date.UTC(filter.year, 0, 1));
      const endOfYear = new Date(Date.UTC(filter.year + 1, 0, 1));
      console.log(`[MediaEngine] Year filter: ${startOfYear.toISOString()} to ${endOfYear.toISOString()}`);
      conditions.push(gte(media.createdAt, startOfYear));
      conditions.push(lt(media.createdAt, endOfYear));
    }

    if (filter.month !== undefined && filter.year !== undefined) {
      // Use UTC dates to avoid timezone issues
      const startOfMonth = new Date(Date.UTC(filter.year, filter.month, 1));
      const endOfMonth = new Date(Date.UTC(filter.year, filter.month + 1, 1));
      console.log(`[MediaEngine] Month filter: ${startOfMonth.toISOString()} to ${endOfMonth.toISOString()}`);
      conditions.push(gte(media.createdAt, startOfMonth));
      conditions.push(lt(media.createdAt, endOfMonth));
    }

    const dbMediaList = await db
      .select()
      .from(media)
      .where(and(...conditions))
      .orderBy(desc(media.createdAt))
      .all();

    console.log(`[MediaEngine] Query returned ${dbMediaList.length} media items`);

    let result: MediaData[] = [];

    for (const dbMedia of dbMediaList) {
      const mediaData: MediaData = {
        id: dbMedia.id,
        filename: dbMedia.filename,
        originalName: dbMedia.originalName,
        mimeType: dbMedia.mimeType,
        size: dbMedia.size,
        width: dbMedia.width || undefined,
        height: dbMedia.height || undefined,
        alt: dbMedia.alt || undefined,
        caption: dbMedia.caption || undefined,
        createdAt: dbMedia.createdAt,
        updatedAt: dbMedia.updatedAt,
        tags: JSON.parse(dbMedia.tags || '[]'),
      };

      // Client-side filtering for tags (JSON array)
      if (filter.tags && filter.tags.length > 0) {
        const hasAllTags = filter.tags.every(tag => mediaData.tags.includes(tag));
        if (!hasAllTags) continue;
      }

      result.push(mediaData);
    }

    return result;
  }

  async searchMedia(query: string): Promise<MediaSearchResult[]> {
    const client = getDatabase().getLocalClient();
    if (!client) return [];

    try {
      // Stem the query for multilingual matching
      const stemmedQuery = stemQuery(query, this.searchLanguage);
      
      // Search the stemmed content, filtered by project_id for project isolation
      const result = await client.execute({
        sql: `SELECT id FROM media_fts WHERE project_id = ? AND media_fts MATCH ? ORDER BY rank LIMIT 50`,
        args: [this.currentProjectId, stemmedQuery],
      });

      // Fetch actual media data for results
      const db = getDatabase().getLocal();
      const searchResults: MediaSearchResult[] = [];
      
      for (const row of result.rows) {
        const mediaId = row.id as string;
        const item = await db.select().from(media).where(eq(media.id, mediaId)).get();
        if (item) {
          searchResults.push({
            id: item.id,
            originalName: item.originalName,
            caption: item.caption || undefined,
            mimeType: item.mimeType,
            createdAt: item.createdAt,
          });
        }
      }

      return searchResults;
    } catch (error) {
      console.error('Media search failed:', error);
      return [];
    }
  }

  async getMediaByYearMonth(): Promise<{ year: number; month: number; count: number }[]> {
    const allMedia = await this.getAllMedia();
    const counts = new Map<string, { year: number; month: number; count: number }>();

    for (const item of allMedia) {
      const year = item.createdAt.getFullYear();
      const month = item.createdAt.getMonth();
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

  async getAvailableTags(): Promise<string[]> {
    const allMedia = await this.getAllMedia();
    const tags = new Set<string>();
    for (const item of allMedia) {
      for (const tag of item.tags) {
        tags.add(tag);
      }
    }
    return Array.from(tags).sort();
  }

  async getTagsWithCounts(): Promise<{ tag: string; count: number }[]> {
    const db = getDatabase().getLocal();
    const dbMediaList = await db
      .select({ tags: media.tags })
      .from(media)
      .where(eq(media.projectId, this.currentProjectId))
      .all();

    const tagCounts = new Map<string, number>();
    for (const row of dbMediaList) {
      const parsed: string[] = JSON.parse(row.tags || '[]');
      for (const tag of parsed) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }

    return Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  getMediaPath(id: string): string {
    return path.join(this.getMediaDir(), id);
  }

  async rebuildDatabaseFromFiles(): Promise<void> {
    const mediaBaseDir = this.getMediaBaseDir();
    console.log(`[MediaEngine] rebuildDatabaseFromFiles: scanning mediaBaseDir=${mediaBaseDir}`);
    const task: Task<void> = {
      id: uuidv4(),
      name: 'Rebuild database from media files',
      execute: async (onProgress) => {
        const db = getDatabase().getLocal();

        onProgress(0, 'Deleting existing media for project...');

        // Notify UI that rebuild is starting so it can clear the list
        this.emit('rebuildStarted');

        // Delete all media for the current project - clean slate rebuild
        const existingMedia = await db.select({ id: media.id }).from(media).where(eq(media.projectId, this.currentProjectId)).all();
        if (existingMedia.length > 0) {
          await db.delete(media).where(eq(media.projectId, this.currentProjectId));
          console.log(`Deleted ${existingMedia.length} existing media record(s) for project ${this.currentProjectId}`);
        }

        // Also delete all post-media links for the current project
        await db.delete(postMedia).where(eq(postMedia.projectId, this.currentProjectId));
        console.log(`Deleted post-media links for project ${this.currentProjectId}`);

        // Delete all FTS entries for the current project
        const client = getDatabase().getLocalClient();
        if (client) {
          await client.execute({
            sql: 'DELETE FROM media_fts WHERE project_id = ?',
            args: [this.currentProjectId],
          });
          console.log(`Deleted media FTS entries for project ${this.currentProjectId}`);
        }

        onProgress(5, 'Scanning media directory...');

        // Recursively find all .meta files in the media directory tree
        const metaFiles: string[] = [];
        const scanDir = async (dir: string) => {
          try {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
              const fullPath = path.join(dir, entry.name);
              if (entry.isDirectory()) {
                await scanDir(fullPath);
              } else if (entry.name.endsWith('.meta')) {
                metaFiles.push(fullPath);
              }
            }
          } catch {
            // Directory might not exist
          }
        };

        try {
          await fs.mkdir(mediaBaseDir, { recursive: true });
        } catch {
          // Already exists
        }
        await scanDir(mediaBaseDir);

        onProgress(10, `Found ${metaFiles.length} media sidecar files`);

        for (let i = 0; i < metaFiles.length; i++) {
          const sidecarPath = metaFiles[i];
          const mediaFilePath = sidecarPath.replace('.meta', '');
          const metaFileName = path.basename(sidecarPath);

          onProgress(10 + (80 * (i / metaFiles.length)), `Processing ${i + 1}/${metaFiles.length}: ${metaFileName}`);

          const metadata = await this.readSidecarFile(sidecarPath);

          if (metadata) {
            try {
              const stats = await fs.stat(mediaFilePath);
              const buffer = await fs.readFile(mediaFilePath);
              const checksum = this.calculateChecksum(buffer);
              const filename = path.basename(mediaFilePath);

              // Insert fresh - we deleted all records at the start
              await db.insert(media).values({
                id: metadata.id,
                projectId: this.currentProjectId,
                filename,
                originalName: metadata.originalName,
                mimeType: metadata.mimeType,
                size: stats.size,
                width: metadata.width,
                height: metadata.height,
                alt: metadata.alt,
                caption: metadata.caption,
                filePath: mediaFilePath,
                sidecarPath,
                createdAt: new Date(metadata.createdAt),
                updatedAt: new Date(metadata.updatedAt),
                checksum,
                tags: JSON.stringify(metadata.tags),
              });

              // Update FTS index
              await this.updateFTSIndex({
                id: metadata.id,
                projectId: this.currentProjectId,
                originalName: metadata.originalName,
                alt: metadata.alt,
                caption: metadata.caption,
                tags: metadata.tags,
              });

              // Insert post-media links based on linkedPostIds from sidecar
              const linkedPostIds = metadata.linkedPostIds || [];
              for (let j = 0; j < linkedPostIds.length; j++) {
                const postId = linkedPostIds[j];
                await db.insert(postMedia).values({
                  id: uuidv4(),
                  projectId: this.currentProjectId,
                  postId,
                  mediaId: metadata.id,
                  sortOrder: j,
                  createdAt: new Date(),
                });
              }
            } catch (error) {
              console.error(`Media file not found for sidecar: ${sidecarPath}`, error);
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
   * Regenerate missing thumbnails for all image media.
   * Useful for media imported externally without thumbnails.
   */
  async regenerateMissingThumbnails(): Promise<{ processed: number; generated: number; failed: number }> {
    const result = { processed: 0, generated: 0, failed: 0 };

    const task: Task<{ processed: number; generated: number; failed: number }> = {
      id: uuidv4(),
      name: 'Generate missing thumbnails',
      execute: async (onProgress) => {
        const db = getDatabase().getLocal();

        onProgress(0, 'Finding images without thumbnails...');

        // Get all image media for current project
        const allMedia = await db
          .select()
          .from(media)
          .where(eq(media.projectId, this.currentProjectId))
          .all();

        // Filter to images only (not SVG - they don't need thumbnails)
        const imageMedia = allMedia.filter(
          m => m.mimeType.startsWith('image/') && !m.mimeType.includes('svg')
        );

        if (imageMedia.length === 0) {
          onProgress(100, 'No images found');
          return result;
        }

        onProgress(5, `Checking ${imageMedia.length} images...`);

        // Find which ones are missing thumbnails
        const missingThumbnails: typeof imageMedia = [];
        for (const item of imageMedia) {
          const thumbnails = await this.getThumbnailPaths(item.id);
          // Consider missing if any size is missing
          if (!thumbnails.small || !thumbnails.medium || !thumbnails.large) {
            missingThumbnails.push(item);
          }
        }

        if (missingThumbnails.length === 0) {
          onProgress(100, 'All thumbnails exist');
          return result;
        }

        onProgress(10, `Generating thumbnails for ${missingThumbnails.length} images...`);

        for (let i = 0; i < missingThumbnails.length; i++) {
          const item = missingThumbnails[i];
          result.processed++;

          const progress = 10 + (90 * ((i + 1) / missingThumbnails.length));
          onProgress(progress, `Processing ${i + 1}/${missingThumbnails.length}: ${item.originalName}`);

          try {
            // Verify the source file exists
            await fs.access(item.filePath);
            
            const thumbnails = await this.generateThumbnails(item.id, item.filePath);
            
            // Check if thumbnails were actually generated
            if (Object.keys(thumbnails).length > 0) {
              result.generated++;
            } else {
              result.failed++;
            }
          } catch (error) {
            console.error(`Failed to generate thumbnails for ${item.id}:`, error);
            result.failed++;
          }

          // Yield to event loop periodically
          if (i % 5 === 0) {
            await new Promise(resolve => setImmediate(resolve));
          }
        }

        onProgress(100, `Generated ${result.generated} thumbnails, ${result.failed} failed`);
        this.emit('thumbnailsRegenerated', result);
        return result;
      },
    };

    return await taskManager.runTask(task);
  }

  /**
   * Reindex all text for full-text search.
   * Runs as a background task with progress updates.
   * Call this when search algorithms change or to fix search issues.
   */
  async reindexText(): Promise<void> {
    const task: Task<void> = {
      id: uuidv4(),
      name: 'Reindex media search text',
      execute: async (onProgress) => {
        const client = getDatabase().getLocalClient();
        if (!client) {
          throw new Error('Database client not available');
        }

        onProgress(0, 'Clearing existing media search index...');

        // Clear the FTS entries for current project
        await client.execute({
          sql: 'DELETE FROM media_fts WHERE project_id = ?',
          args: [this.currentProjectId],
        });

        onProgress(5, 'Loading media...');

        const allMedia = await this.getAllMedia();
        const total = allMedia.length;

        if (total === 0) {
          onProgress(100, 'No media to index');
          return;
        }

        onProgress(10, `Indexing ${total} media items...`);

        for (let i = 0; i < allMedia.length; i++) {
          const item = allMedia[i];
          await this.updateFTSIndex({
            id: item.id,
            projectId: this.currentProjectId,
            originalName: item.originalName,
            alt: item.alt,
            caption: item.caption,
            tags: item.tags,
          });

          // Update progress (10% to 100%)
          const progress = 10 + Math.round((i + 1) / total * 90);
          if (i % 10 === 0 || i === allMedia.length - 1) {
            onProgress(progress, `Indexed ${i + 1} of ${total} media items`);
          }

          // Yield to event loop periodically
          if (i % 20 === 0) {
            await new Promise(resolve => setImmediate(resolve));
          }
        }

        onProgress(100, `Reindexed ${total} media items`);
        console.log(`Reindexed search text for ${total} media items`);
      },
    };

    await taskManager.runTask(task);
  }
}

// Singleton instance
let mediaEngine: MediaEngine | null = null;

export function getMediaEngine(): MediaEngine {
  if (!mediaEngine) {
    mediaEngine = new MediaEngine();
  }
  return mediaEngine;
}
