import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { getDatabase } from '../database';
import { syncLog, posts, media, NewSyncLogEntry } from '../database/schema';
import { taskManager, Task } from './TaskManager';
import { getDropboxSyncEngine } from './DropboxSyncEngine';

export type SyncDirection = 'push' | 'pull' | 'bidirectional';
export type SyncStatus = 'idle' | 'syncing' | 'error';

export interface SyncConfig {
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

// Default timeout for sync operations (30 seconds)
const DEFAULT_SYNC_TIMEOUT = 30000;

export class SyncEngine extends EventEmitter {
  private syncStatus: SyncStatus = 'idle';
  private syncConfig: SyncConfig | null = null;
  private syncIntervalId: NodeJS.Timeout | null = null;
  private syncTimeout: number = DEFAULT_SYNC_TIMEOUT;

  constructor() {
    super();
  }

  getSyncTimeout(): number {
    return this.syncTimeout;
  }

  setSyncTimeout(timeoutMs: number): void {
    this.syncTimeout = timeoutMs;
  }

  getSyncStatus(): SyncStatus {
    return this.syncStatus;
  }

  /**
   * Check if sync is configured. Uses Dropbox configuration status.
   */
  isConfigured(): boolean {
    const dropboxEngine = getDropboxSyncEngine();
    return dropboxEngine.isConfigured();
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

    this.emit('configured', config);
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
   * Full sync: Files via Dropbox.
   * Synchronizes posts and media files to Dropbox for backup and cross-device access.
   */
  async fullSync(direction: SyncDirection = 'bidirectional'): Promise<SyncResult> {
    if (this.syncStatus === 'syncing') {
      return {
        success: false,
        pushed: 0,
        pulled: 0,
        conflicts: 0,
        errors: ['Sync already in progress'],
      };
    }

    const result: SyncResult = {
      success: true,
      pushed: 0,
      pulled: 0,
      conflicts: 0,
      errors: [],
    };

    const dropboxEngine = getDropboxSyncEngine();
    if (!dropboxEngine.isConfigured()) {
      return {
        success: false,
        pushed: 0,
        pulled: 0,
        conflicts: 0,
        errors: ['Dropbox sync not configured'],
      };
    }

    console.log('[SyncEngine] Starting Dropbox file sync...');

    const task: Task<SyncResult> = {
      id: uuidv4(),
      name: `Sync (${direction})`,
      execute: async (onProgress) => {
        this.syncStatus = 'syncing';
        this.emit('syncStarted', direction);

        try {
          onProgress(10, 'Starting Dropbox sync...');
          
          const fileResult = await dropboxEngine.syncAll();
          
          result.dropboxResult = {
            uploaded: fileResult.uploaded,
            downloaded: fileResult.downloaded,
            deleted: fileResult.deleted,
            conflicts: fileResult.conflicts,
            errors: fileResult.errors,
          };

          result.pushed = fileResult.uploaded;
          result.pulled = fileResult.downloaded;
          result.conflicts = fileResult.conflicts;

          if (!fileResult.success) {
            result.success = false;
            result.errors.push(...fileResult.errors.map(e => `Dropbox: ${e}`));
          }

          onProgress(100, 'Sync complete');
          console.log('[SyncEngine] Dropbox sync complete:', {
            uploaded: fileResult.uploaded,
            downloaded: fileResult.downloaded,
            errors: fileResult.errors.length,
          });

          this.syncStatus = 'idle';
          this.emit('syncCompleted', result);

          return result;
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          console.error('[SyncEngine] Sync failed:', errorMsg);
          result.success = false;
          result.errors.push(`Dropbox sync failed: ${errorMsg}`);

          this.syncStatus = 'error';
          this.emit('syncFailed', errorMsg);

          return result;
        }
      },
    };

    try {
      return await taskManager.runTask(task);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[SyncEngine] Task manager error:', errorMsg);
      this.syncStatus = 'error';
      this.emit('syncFailed', errorMsg);
      return {
        success: false,
        pushed: 0,
        pulled: 0,
        conflicts: 0,
        errors: [errorMsg],
      };
    }
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
