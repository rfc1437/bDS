import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { getDatabase } from '../database';
import { syncLog, posts, media, NewSyncLogEntry } from '../database/schema';

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

  /**
   * Check if sync is configured.
   * Currently returns false as cloud sync is not implemented.
   */
  isConfigured(): boolean {
    return false;
  }

  async configure(config: SyncConfig): Promise<void> {
    this.syncConfig = config;
    
    // Stop existing auto-sync
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }

    // Auto-sync is disabled as cloud sync is not implemented
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
   * Sync alias for fullSync for backward compatibility
   */
  async sync(direction: SyncDirection = 'bidirectional'): Promise<SyncResult> {
    return this.fullSync(direction);
  }

  /**
   * Full sync is not currently implemented.
   * Returns a result indicating sync is not configured.
   */
  async fullSync(_direction: SyncDirection = 'bidirectional'): Promise<SyncResult> {
    return {
      success: false,
      pushed: 0,
      pulled: 0,
      conflicts: 0,
      errors: ['Cloud sync not configured'],
    };
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
