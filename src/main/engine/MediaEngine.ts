import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { getDatabase } from '../database';
import { media, Media, NewMedia } from '../database/schema';
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
}

export class MediaEngine extends EventEmitter {
  private mediaDir: string;

  constructor() {
    super();
    this.mediaDir = getDatabase().getDataPaths().media;
  }

  private calculateChecksum(buffer: Buffer): string {
    return crypto.createHash('md5').update(buffer).digest('hex');
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
    lines.push('---');

    await fs.writeFile(sidecarPath, lines.join('\n'), 'utf-8');
    return sidecarPath;
  }

  private async readSidecarFile(sidecarPath: string): Promise<MediaMetadata | null> {
    try {
      const content = await fs.readFile(sidecarPath, 'utf-8');
      const lines = content.split('\n');
      
      const metadata: Partial<MediaMetadata> = {
        tags: [],
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
            const match = value.match(/\[(.*)\]/);
            if (match) {
              metadata.tags = match[1]
                .split(',')
                .map(t => t.trim().replace(/"/g, ''))
                .filter(t => t.length > 0);
            }
            break;
        }
      }

      if (!metadata.id || !metadata.originalName || !metadata.mimeType) {
        return null;
      }

      return metadata as MediaMetadata;
    } catch (error) {
      console.error(`Failed to read sidecar file: ${sidecarPath}`, error);
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
    const destPath = path.join(this.mediaDir, filename);

    // Copy file to media directory
    await fs.writeFile(destPath, sourceBuffer);

    const mediaData: MediaData = {
      id,
      filename,
      originalName,
      mimeType: metadata?.mimeType || this.getMimeType(originalName),
      size: sourceBuffer.length,
      width: metadata?.width,
      height: metadata?.height,
      alt: metadata?.alt,
      caption: metadata?.caption,
      createdAt: now,
      updatedAt: now,
      tags: metadata?.tags || [],
    };

    const sidecarPath = await this.writeSidecarFile(mediaData, destPath);
    const checksum = this.calculateChecksum(sourceBuffer);

    const dbMedia: NewMedia = {
      id: mediaData.id,
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
      syncStatus: 'pending',
      checksum,
      tags: JSON.stringify(mediaData.tags),
    };

    await db.insert(media).values(dbMedia);

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
        syncStatus: 'pending',
        tags: JSON.stringify(updated.tags),
      })
      .where(eq(media.id, id));

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

    await db.delete(media).where(eq(media.id, id));

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
    const dbMediaList = await db.select().from(media).all();
    
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

  getMediaPath(id: string): string {
    return path.join(this.mediaDir, id);
  }

  async rebuildDatabaseFromFiles(): Promise<void> {
    const task: Task<void> = {
      id: uuidv4(),
      name: 'Rebuild database from media files',
      execute: async (onProgress) => {
        const db = getDatabase().getLocal();
        
        onProgress(0, 'Scanning media directory...');
        
        const files = await fs.readdir(this.mediaDir);
        const metaFiles = files.filter(f => f.endsWith('.meta'));
        
        onProgress(10, `Found ${metaFiles.length} media sidecar files`);
        
        for (let i = 0; i < metaFiles.length; i++) {
          const metaFile = metaFiles[i];
          const sidecarPath = path.join(this.mediaDir, metaFile);
          const mediaFilePath = sidecarPath.replace('.meta', '');
          
          onProgress(10 + (80 * (i / metaFiles.length)), `Processing ${metaFile}...`);
          
          const metadata = await this.readSidecarFile(sidecarPath);
          
          if (metadata) {
            try {
              const stats = await fs.stat(mediaFilePath);
              const buffer = await fs.readFile(mediaFilePath);
              const checksum = this.calculateChecksum(buffer);
              const filename = path.basename(mediaFilePath);

              const existing = await db.select().from(media).where(eq(media.id, metadata.id)).get();
              
              if (existing) {
                await db.update(media)
                  .set({
                    originalName: metadata.originalName,
                    mimeType: metadata.mimeType,
                    size: stats.size,
                    width: metadata.width,
                    height: metadata.height,
                    alt: metadata.alt,
                    caption: metadata.caption,
                    updatedAt: new Date(metadata.updatedAt),
                    checksum,
                    tags: JSON.stringify(metadata.tags),
                  })
                  .where(eq(media.id, metadata.id));
              } else {
                await db.insert(media).values({
                  id: metadata.id,
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
                  syncStatus: 'pending',
                  checksum,
                  tags: JSON.stringify(metadata.tags),
                });
              }
            } catch (error) {
              console.error(`Media file not found for sidecar: ${sidecarPath}`, error);
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
let mediaEngine: MediaEngine | null = null;

export function getMediaEngine(): MediaEngine {
  if (!mediaEngine) {
    mediaEngine = new MediaEngine();
  }
  return mediaEngine;
}
