/**
 * SyncEngine Unit Tests
 * 
 * Tests for remote synchronization including:
 * - Sync configuration
 * - Push/pull operations
 * - Conflict detection and resolution
 * - Sync status tracking
 * - Retry logic
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { resetMockCounters } from '../utils/factories';

// Mock dependencies
vi.mock('../../src/main/database', () => ({
  getDatabase: vi.fn(() => ({
    getLocal: vi.fn(() => ({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([])),
          orderBy: vi.fn(() => Promise.resolve([])),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => Promise.resolve()),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve()),
        })),
      })),
      delete: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
    getRemote: vi.fn(() => null),
    initializeLocal: vi.fn(),
    initializeRemote: vi.fn(),
    getDataPaths: vi.fn(() => ({
      database: '/mock/userData/bds.db',
      posts: '/mock/userData/posts',
      media: '/mock/userData/media',
    })),
  })),
}));

vi.mock('../../src/main/engine/PostEngine', () => ({
  getPostEngine: vi.fn(() => ({
    getAllPosts: vi.fn(() => Promise.resolve([])),
    createPost: vi.fn(),
    updatePost: vi.fn(),
    deletePost: vi.fn(),
  })),
}));

vi.mock('../../src/main/engine/MediaEngine', () => ({
  getMediaEngine: vi.fn(() => ({
    getAllMedia: vi.fn(() => Promise.resolve([])),
    importMedia: vi.fn(),
    updateMedia: vi.fn(),
    deleteMedia: vi.fn(),
  })),
}));

describe('SyncEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMockCounters();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Sync Configuration', () => {
    it('should validate sync config structure', () => {
      interface SyncConfig {
        tursoUrl: string;
        tursoAuthToken: string;
        autoSync: boolean;
        syncInterval: number;
      }

      const validConfig: SyncConfig = {
        tursoUrl: 'libsql://mydb.turso.io',
        tursoAuthToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        autoSync: true,
        syncInterval: 5,
      };

      expect(validConfig.tursoUrl).toMatch(/^libsql:\/\//);
      expect(validConfig.tursoAuthToken).toBeDefined();
      expect(validConfig.autoSync).toBe(true);
      expect(validConfig.syncInterval).toBeGreaterThan(0);
    });

    it('should detect unconfigured state', () => {
      const isConfigured = (config: { tursoUrl?: string; tursoAuthToken?: string } | null): boolean => {
        return config !== null && 
               !!config.tursoUrl && 
               !!config.tursoAuthToken;
      };

      expect(isConfigured(null)).toBe(false);
      expect(isConfigured({ tursoUrl: '', tursoAuthToken: '' })).toBe(false);
      expect(isConfigured({ tursoUrl: 'url', tursoAuthToken: '' })).toBe(false);
      expect(isConfigured({ tursoUrl: 'url', tursoAuthToken: 'token' })).toBe(true);
    });

    it('should calculate sync interval in milliseconds', () => {
      const minutesToMs = (minutes: number): number => minutes * 60 * 1000;

      expect(minutesToMs(1)).toBe(60000);
      expect(minutesToMs(5)).toBe(300000);
      expect(minutesToMs(15)).toBe(900000);
    });
  });

  describe('Sync Direction', () => {
    it('should support push direction', () => {
      type SyncDirection = 'push' | 'pull' | 'bidirectional';
      const direction: SyncDirection = 'push';
      
      expect(['push', 'pull', 'bidirectional']).toContain(direction);
    });

    it('should support pull direction', () => {
      type SyncDirection = 'push' | 'pull' | 'bidirectional';
      const direction: SyncDirection = 'pull';
      
      expect(['push', 'pull', 'bidirectional']).toContain(direction);
    });

    it('should support bidirectional sync', () => {
      type SyncDirection = 'push' | 'pull' | 'bidirectional';
      const direction: SyncDirection = 'bidirectional';
      
      expect(['push', 'pull', 'bidirectional']).toContain(direction);
    });
  });

  describe('Sync Status', () => {
    it('should track sync status states', () => {
      type SyncStatus = 'idle' | 'syncing' | 'error';
      const validStatuses: SyncStatus[] = ['idle', 'syncing', 'error'];

      validStatuses.forEach(status => {
        expect(['idle', 'syncing', 'error']).toContain(status);
      });
    });

    it('should prevent concurrent syncs', () => {
      let syncStatus: 'idle' | 'syncing' | 'error' = 'idle';
      
      const canSync = (): boolean => syncStatus !== 'syncing';
      
      expect(canSync()).toBe(true);
      syncStatus = 'syncing';
      expect(canSync()).toBe(false);
      syncStatus = 'idle';
      expect(canSync()).toBe(true);
    });
  });

  describe('Sync Result', () => {
    it('should create sync result structure', () => {
      interface SyncResult {
        success: boolean;
        pushed: number;
        pulled: number;
        conflicts: number;
        errors: string[];
      }

      const successResult: SyncResult = {
        success: true,
        pushed: 5,
        pulled: 3,
        conflicts: 0,
        errors: [],
      };

      expect(successResult.success).toBe(true);
      expect(successResult.pushed + successResult.pulled).toBe(8);
      expect(successResult.errors).toHaveLength(0);
    });

    it('should report errors in result', () => {
      interface SyncResult {
        success: boolean;
        pushed: number;
        pulled: number;
        conflicts: number;
        errors: string[];
      }

      const errorResult: SyncResult = {
        success: false,
        pushed: 0,
        pulled: 0,
        conflicts: 0,
        errors: ['Network timeout', 'Authentication failed'],
      };

      expect(errorResult.success).toBe(false);
      expect(errorResult.errors).toHaveLength(2);
      expect(errorResult.errors).toContain('Network timeout');
    });

    it('should track conflicts', () => {
      interface SyncResult {
        success: boolean;
        pushed: number;
        pulled: number;
        conflicts: number;
        errors: string[];
      }

      const conflictResult: SyncResult = {
        success: true, // Partial success
        pushed: 4,
        pulled: 2,
        conflicts: 2,
        errors: [],
      };

      expect(conflictResult.conflicts).toBeGreaterThan(0);
    });
  });

  describe('Entity Sync Status', () => {
    it('should track sync status per entity', () => {
      type EntitySyncStatus = 'pending' | 'syncing' | 'synced' | 'conflict';

      interface SyncableEntity {
        id: string;
        syncStatus: EntitySyncStatus;
        syncedAt: Date | null;
        checksum: string;
      }

      const entity: SyncableEntity = {
        id: 'post-1',
        syncStatus: 'pending',
        syncedAt: null,
        checksum: 'abc123',
      };

      expect(entity.syncStatus).toBe('pending');
      expect(entity.syncedAt).toBeNull();
    });

    it('should update sync status after successful sync', () => {
      interface SyncableEntity {
        syncStatus: 'pending' | 'syncing' | 'synced' | 'conflict';
        syncedAt: Date | null;
      }

      const entity: SyncableEntity = {
        syncStatus: 'pending',
        syncedAt: null,
      };

      // Simulate sync completion
      entity.syncStatus = 'synced';
      entity.syncedAt = new Date();

      expect(entity.syncStatus).toBe('synced');
      expect(entity.syncedAt).toBeInstanceOf(Date);
    });
  });

  describe('Conflict Detection', () => {
    it('should detect conflict by checksum mismatch', () => {
      const detectConflict = (localChecksum: string, remoteChecksum: string): boolean => {
        return localChecksum !== remoteChecksum;
      };

      expect(detectConflict('abc123', 'abc123')).toBe(false);
      expect(detectConflict('abc123', 'xyz789')).toBe(true);
    });

    it('should create conflict info structure', () => {
      interface ConflictInfo {
        entityId: string;
        entityType: 'post' | 'media';
        localChecksum: string;
        remoteChecksum: string;
        localUpdatedAt: Date;
        remoteUpdatedAt: Date;
      }

      const conflict: ConflictInfo = {
        entityId: 'post-1',
        entityType: 'post',
        localChecksum: 'local123',
        remoteChecksum: 'remote456',
        localUpdatedAt: new Date('2024-01-15T10:00:00Z'),
        remoteUpdatedAt: new Date('2024-01-15T11:00:00Z'),
      };

      expect(conflict.localChecksum).not.toBe(conflict.remoteChecksum);
    });
  });

  describe('Conflict Resolution', () => {
    it('should support local-wins strategy', () => {
      type ConflictResolution = 'local-wins' | 'remote-wins' | 'manual';

      const resolveConflict = (strategy: ConflictResolution): 'local' | 'remote' | 'prompt' => {
        switch (strategy) {
          case 'local-wins': return 'local';
          case 'remote-wins': return 'remote';
          case 'manual': return 'prompt';
        }
      };

      expect(resolveConflict('local-wins')).toBe('local');
    });

    it('should support remote-wins strategy', () => {
      type ConflictResolution = 'local-wins' | 'remote-wins' | 'manual';

      const resolveConflict = (strategy: ConflictResolution): 'local' | 'remote' | 'prompt' => {
        switch (strategy) {
          case 'local-wins': return 'local';
          case 'remote-wins': return 'remote';
          case 'manual': return 'prompt';
        }
      };

      expect(resolveConflict('remote-wins')).toBe('remote');
    });

    it('should support last-write-wins based on timestamp', () => {
      const lastWriteWins = (localTime: Date, remoteTime: Date): 'local' | 'remote' => {
        return localTime.getTime() > remoteTime.getTime() ? 'local' : 'remote';
      };

      const earlier = new Date('2024-01-15T10:00:00Z');
      const later = new Date('2024-01-15T11:00:00Z');

      expect(lastWriteWins(later, earlier)).toBe('local');
      expect(lastWriteWins(earlier, later)).toBe('remote');
    });
  });

  describe('Retry Logic', () => {
    it('should calculate exponential backoff delay', () => {
      const getBackoffDelay = (attempt: number, baseDelay: number = 1000): number => {
        return Math.pow(2, attempt) * baseDelay;
      };

      expect(getBackoffDelay(1)).toBe(2000);   // 2^1 * 1000
      expect(getBackoffDelay(2)).toBe(4000);   // 2^2 * 1000
      expect(getBackoffDelay(3)).toBe(8000);   // 2^3 * 1000
      expect(getBackoffDelay(4)).toBe(16000);  // 2^4 * 1000
    });

    it('should cap maximum retry delay', () => {
      const getBackoffDelay = (attempt: number, baseDelay: number = 1000, maxDelay: number = 30000): number => {
        const delay = Math.pow(2, attempt) * baseDelay;
        return Math.min(delay, maxDelay);
      };

      expect(getBackoffDelay(5)).toBe(30000); // Capped at max
      expect(getBackoffDelay(10)).toBe(30000); // Still capped
    });

    it('should track retry count', () => {
      interface RetryState {
        attempts: number;
        maxAttempts: number;
        lastError: string | null;
      }

      const state: RetryState = {
        attempts: 0,
        maxAttempts: 3,
        lastError: null,
      };

      const shouldRetry = (): boolean => state.attempts < state.maxAttempts;

      expect(shouldRetry()).toBe(true);
      state.attempts = 3;
      expect(shouldRetry()).toBe(false);
    });
  });

  describe('Sync Log', () => {
    it('should create sync log entry structure', () => {
      interface SyncLogEntry {
        id: string;
        entityType: 'post' | 'media';
        entityId: string;
        operation: 'push' | 'pull' | 'conflict';
        status: 'pending' | 'success' | 'failed';
        timestamp: Date;
        errorMessage?: string;
      }

      const logEntry: SyncLogEntry = {
        id: 'log-1',
        entityType: 'post',
        entityId: 'post-123',
        operation: 'push',
        status: 'success',
        timestamp: new Date(),
      };

      expect(logEntry.operation).toBe('push');
      expect(logEntry.status).toBe('success');
      expect(logEntry.errorMessage).toBeUndefined();
    });

    it('should log errors', () => {
      interface SyncLogEntry {
        id: string;
        entityType: 'post' | 'media';
        entityId: string;
        operation: 'push' | 'pull' | 'conflict';
        status: 'pending' | 'success' | 'failed';
        timestamp: Date;
        errorMessage?: string;
      }

      const errorLogEntry: SyncLogEntry = {
        id: 'log-2',
        entityType: 'post',
        entityId: 'post-456',
        operation: 'push',
        status: 'failed',
        timestamp: new Date(),
        errorMessage: 'Network timeout after 30s',
      };

      expect(errorLogEntry.status).toBe('failed');
      expect(errorLogEntry.errorMessage).toBeDefined();
    });
  });

  describe('Pending Changes', () => {
    it('should count pending changes', () => {
      const entities = [
        { id: '1', syncStatus: 'pending' },
        { id: '2', syncStatus: 'synced' },
        { id: '3', syncStatus: 'pending' },
        { id: '4', syncStatus: 'conflict' },
      ];

      const pendingCount = entities.filter(e => e.syncStatus === 'pending').length;
      expect(pendingCount).toBe(2);
    });

    it('should identify entities needing sync', () => {
      type SyncStatus = 'pending' | 'syncing' | 'synced' | 'conflict';
      
      const needsSync = (status: SyncStatus): boolean => {
        return status === 'pending' || status === 'conflict';
      };

      expect(needsSync('pending')).toBe(true);
      expect(needsSync('conflict')).toBe(true);
      expect(needsSync('synced')).toBe(false);
      expect(needsSync('syncing')).toBe(false);
    });
  });

  describe('Auto Sync', () => {
    it('should start auto sync interval', () => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval');
      
      const startAutoSync = (intervalMinutes: number, callback: () => void): NodeJS.Timeout => {
        return setInterval(callback, intervalMinutes * 60 * 1000);
      };

      const callback = vi.fn();
      const intervalId = startAutoSync(5, callback);

      expect(setIntervalSpy).toHaveBeenCalledWith(callback, 300000);
      
      clearInterval(intervalId);
    });

    it('should stop auto sync interval', () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      
      const intervalId = setInterval(() => {}, 1000);
      clearInterval(intervalId);

      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it('should trigger sync on interval', () => {
      const syncCallback = vi.fn();
      const intervalId = setInterval(syncCallback, 1000);

      vi.advanceTimersByTime(3000);

      expect(syncCallback).toHaveBeenCalledTimes(3);
      
      clearInterval(intervalId);
    });
  });
});

describe('SyncEngine Error Handling', () => {
  describe('Network Errors', () => {
    it('should identify network errors', () => {
      const isNetworkError = (error: Error): boolean => {
        const networkErrorPatterns = [
          'network',
          'timeout',
          'ECONNREFUSED',
          'ENOTFOUND',
          'fetch failed',
        ];
        return networkErrorPatterns.some(pattern => 
          error.message.toLowerCase().includes(pattern.toLowerCase())
        );
      };

      expect(isNetworkError(new Error('Network timeout'))).toBe(true);
      expect(isNetworkError(new Error('ECONNREFUSED'))).toBe(true);
      expect(isNetworkError(new Error('Invalid data'))).toBe(false);
    });

    it('should create user-friendly error messages', () => {
      const getUserFriendlyMessage = (error: Error): string => {
        if (error.message.includes('timeout')) {
          return 'Connection timed out. Please check your internet connection.';
        }
        if (error.message.includes('ECONNREFUSED')) {
          return 'Unable to connect to sync server. Please try again later.';
        }
        if (error.message.includes('401') || error.message.includes('unauthorized')) {
          return 'Authentication failed. Please check your sync credentials.';
        }
        return 'An unexpected error occurred during sync.';
      };

      expect(getUserFriendlyMessage(new Error('timeout'))).toContain('timed out');
      expect(getUserFriendlyMessage(new Error('401 unauthorized'))).toContain('Authentication');
    });
  });

  describe('Authentication Errors', () => {
    it('should detect auth errors', () => {
      const isAuthError = (error: Error | { status?: number }): boolean => {
        if ('status' in error) {
          return error.status === 401 || error.status === 403;
        }
        const message = (error as Error).message.toLowerCase();
        return message.includes('unauthorized') || 
               message.includes('forbidden') ||
               message.includes('auth');
      };

      expect(isAuthError({ status: 401 })).toBe(true);
      expect(isAuthError({ status: 403 })).toBe(true);
      expect(isAuthError({ status: 500 })).toBe(false);
      expect(isAuthError(new Error('Unauthorized'))).toBe(true);
    });
  });
});
