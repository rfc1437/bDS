import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { eq, and } from 'drizzle-orm';
import { getDatabase } from '../database';
import { syncLog, posts, media, NewSyncLogEntry } from '../database/schema';
import { taskManager, Task } from './TaskManager';
import { getPostEngine } from './PostEngine';
import { getMediaEngine } from './MediaEngine';
import { getDropboxSyncEngine } from './DropboxSyncEngine';

export type SyncDirection = 'push' | 'pull' | 'bidirectional';
export type SyncStatus = 'idle' | 'syncing' | 'error';

export interface SyncConfig {
  tursoUrl: string;
  tursoAuthToken: string;
  autoSync: boolean;
  syncInterval: number; // in minutes
}

export interface SyncResult {
  success: boolean;
  pushed: number;
  pulled: number;
  conflicts: number;
  errors: string[];
  dropboxResult?: {
    uploaded: number;
    downloaded: number;
    deleted: number;
    conflicts: number;
    errors: string[];
  };
}

export class SyncEngine extends EventEmitter {
  private syncStatus: SyncStatus = 'idle';
  private syncConfig: SyncConfig | null = null;
  private syncIntervalId: NodeJS.Timeout | null = null;

  constructor() {
    super();
  }

  getSyncStatus(): SyncStatus {
    return this.syncStatus;
  }

  isConfigured(): boolean {
    return this.syncConfig !== null && 
           !!this.syncConfig.tursoUrl && 
           !!this.syncConfig.tursoAuthToken;
  }

  async configure(config: SyncConfig): Promise<void> {
    this.syncConfig = config;
    
    // Stop existing auto-sync
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }

    // Start auto-sync if enabled
    if (config.autoSync && config.syncInterval > 0) {
      this.syncIntervalId = setInterval(
        () => this.fullSync('bidirectional'),
        config.syncInterval * 60 * 1000
      );
    }

    // Initialize remote database connection with the provided credentials
    const db = getDatabase();
    await db.initializeRemote({
      tursoUrl: config.tursoUrl,
      tursoAuthToken: config.tursoAuthToken,
    });

    this.emit('configured', config);
  }

  async sync(direction: SyncDirection = 'bidirectional'): Promise<SyncResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        pushed: 0,
        pulled: 0,
        conflicts: 0,
        errors: ['Sync not configured'],
      };
    }

    if (this.syncStatus === 'syncing') {
      return {
        success: false,
        pushed: 0,
        pulled: 0,
        conflicts: 0,
        errors: ['Sync already in progress'],
      };
    }

    const task: Task<SyncResult> = {
      id: uuidv4(),
      name: `Sync (${direction})`,
      execute: async (onProgress) => {
        this.syncStatus = 'syncing';
        this.emit('syncStarted', direction);

        const result: SyncResult = {
          success: true,
          pushed: 0,
          pulled: 0,
          conflicts: 0,
          errors: [],
        };

        try {
          const db = getDatabase();
          const localDb = db.getLocal();
          const remoteDb = db.getRemote();

          if (!remoteDb) {
            throw new Error('Remote database not initialized');
          }

          onProgress(10, 'Fetching pending changes...');

          if (direction === 'push' || direction === 'bidirectional') {
            // Get pending posts
            const pendingPosts = await localDb
              .select()
              .from(posts)
              .where(eq(posts.syncStatus, 'pending'))
              .all();

            onProgress(20, `Pushing ${pendingPosts.length} posts...`);

            for (const post of pendingPosts) {
              try {
                // Push to remote (simplified - in production would handle conflicts)
                await remoteDb.insert(posts).values(post).onConflictDoUpdate({
                  target: posts.id,
                  set: {
                    title: post.title,
                    slug: post.slug,
                    excerpt: post.excerpt,
                    status: post.status,
                    author: post.author,
                    updatedAt: post.updatedAt,
                    publishedAt: post.publishedAt,
                    checksum: post.checksum,
                    tags: post.tags,
                    categories: post.categories,
                  },
                });

                // Mark as synced locally
                await localDb
                  .update(posts)
                  .set({ syncStatus: 'synced', syncedAt: new Date() })
                  .where(eq(posts.id, post.id));

                result.pushed++;
              } catch (error) {
                const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                result.errors.push(`Failed to push post ${post.id}: ${errorMsg}`);
                
                // Log the error
                await this.logSyncOperation(post.id, 'post', 'update', 'failed', errorMsg);
              }
            }

            // Get pending media
            const pendingMedia = await localDb
              .select()
              .from(media)
              .where(eq(media.syncStatus, 'pending'))
              .all();

            onProgress(50, `Pushing ${pendingMedia.length} media items...`);

            for (const item of pendingMedia) {
              try {
                await remoteDb.insert(media).values(item).onConflictDoUpdate({
                  target: media.id,
                  set: {
                    alt: item.alt,
                    caption: item.caption,
                    updatedAt: item.updatedAt,
                    checksum: item.checksum,
                    tags: item.tags,
                  },
                });

                await localDb
                  .update(media)
                  .set({ syncStatus: 'synced', syncedAt: new Date() })
                  .where(eq(media.id, item.id));

                result.pushed++;
              } catch (error) {
                const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                result.errors.push(`Failed to push media ${item.id}: ${errorMsg}`);
                
                await this.logSyncOperation(item.id, 'media', 'update', 'failed', errorMsg);
              }
            }
          }

          if (direction === 'pull' || direction === 'bidirectional') {
            onProgress(70, 'Pulling remote changes...');
            
            // In a real implementation, we would:
            // 1. Fetch all remote records with syncedAt > local last sync
            // 2. Compare checksums to detect conflicts
            // 3. Apply or merge changes

            // For now, this is a placeholder
            onProgress(90, 'Pull complete');
          }

          onProgress(100, 'Sync complete');
          
          this.syncStatus = 'idle';
          this.emit('syncCompleted', result);
          
          return result;
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          result.success = false;
          result.errors.push(errorMsg);
          
          this.syncStatus = 'error';
          this.emit('syncFailed', errorMsg);
          
          return result;
        }
      },
    };

    return taskManager.runTask(task);
  }

  private async logSyncOperation(
    entityId: string,
    entityType: 'post' | 'media',
    operation: 'create' | 'update' | 'delete',
    status: 'pending' | 'completed' | 'failed',
    errorMessage?: string
  ): Promise<void> {
    const db = getDatabase().getLocal();
    
    const logEntry: NewSyncLogEntry = {
      id: uuidv4(),
      entityType,
      entityId,
      operation,
      status,
      timestamp: new Date(),
      errorMessage,
      retryCount: 0,
    };

    await db.insert(syncLog).values(logEntry);
  }

  async getPendingChangesCount(): Promise<{ posts: number; media: number }> {
    const db = getDatabase().getLocal();
    
    const pendingPosts = await db
      .select()
      .from(posts)
      .where(eq(posts.syncStatus, 'pending'))
      .all();

    const pendingMedia = await db
      .select()
      .from(media)
      .where(eq(media.syncStatus, 'pending'))
      .all();

    return {
      posts: pendingPosts.length,
      media: pendingMedia.length,
    };
  }

  async getSyncLog(limit = 50): Promise<Array<{
    id: string;
    entityType: string;
    entityId: string;
    operation: string;
    status: string;
    timestamp: Date;
    errorMessage?: string;
  }>> {
    const db = getDatabase().getLocal();
    
    const logs = await db
      .select()
      .from(syncLog)
      .orderBy(syncLog.timestamp)
      .limit(limit)
      .all();

    return logs.map(log => ({
      id: log.id,
      entityType: log.entityType,
      entityId: log.entityId,
      operation: log.operation,
      status: log.status,
      timestamp: log.timestamp,
      errorMessage: log.errorMessage || undefined,
    }));
  }

  stopAutoSync(): void {
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
    this.emit('autoSyncStopped');
  }

  /**
   * Full sync: metadata via Turso + files via Dropbox.
   * Coordinates both sync engines for a complete bidirectional sync.
   */
  async fullSync(direction: SyncDirection = 'bidirectional'): Promise<SyncResult> {
    // Run metadata sync (Turso)
    const metadataResult = await this.sync(direction);

    // Run file sync (Dropbox) if configured
    const dropboxEngine = getDropboxSyncEngine();
    if (dropboxEngine.isConfigured()) {
      try {
        const fileResult = await dropboxEngine.syncAll();
        metadataResult.dropboxResult = {
          uploaded: fileResult.uploaded,
          downloaded: fileResult.downloaded,
          deleted: fileResult.deleted,
          conflicts: fileResult.conflicts,
          errors: fileResult.errors,
        };

        if (!fileResult.success) {
          metadataResult.errors.push(
            ...fileResult.errors.map(e => `Dropbox: ${e}`)
          );
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown Dropbox error';
        metadataResult.errors.push(`Dropbox sync failed: ${msg}`);
      }
    }

    return metadataResult;
  }
}

// Singleton instance
let syncEngine: SyncEngine | null = null;

export function getSyncEngine(): SyncEngine {
  if (!syncEngine) {
    syncEngine = new SyncEngine();
  }
  return syncEngine;
}
